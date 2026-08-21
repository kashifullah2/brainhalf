// ---------------------------------------------------------------------------
// Server-side OCR proxy (Cloudflare Pages Function)
//
// Two upstream providers, selected by the caller's *tier* — never by a model
// name, so a signed-in user cannot aim the account's small premium quota at
// their own batch:
//
//   tier "default"    -> the dedicated OCR model (Hunyuan) via its own API.
//                        Runs on every page. Its credential is HUNYUAN_API_KEY.
//   tier "escalation" -> OpenAI. Runs only to re-read a page the default tier
//                        scored low. Its credential is OPENAI_API_KEY and its
//                        daily allowance is far smaller, so it is rate-limited
//                        separately (RULES.ocrEscalation).
//
// Both are OpenAI-compatible chat/completions endpoints, but they are separate
// services with separate keys and are configured independently. The browser
// never holds either credential and never talks to a provider directly — this
// endpoint is the only path to them.
//
// Requires a signed-in session. Every call spends money upstream, so it must
// not be reachable by an anonymous caller. The guard is the same requireSession()
// every other data endpoint uses.
// ---------------------------------------------------------------------------

import { fail, json, type AppEnv } from '../../server/http';
import { authHeaders, requireSession, type Authed } from '../../server/guard';
import {
  RULES,
  enforceRateLimit,
  userIdentity,
} from '../../server/rate-limit';
import {
  buildModelParams,
  capabilitiesFor,
  retryWithoutRejectedParam,
  usedTokens,
} from '../../server/openai-params';

const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_ERROR_DETAIL_CHARS = 500;
const UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * Bounds billed output on the OpenAI tier. Set generously on purpose: the model
 * is asked for a JSON object, and a response cut off at the limit is truncated
 * mid-JSON, which fails to parse and reads to the user as a failed extraction
 * rather than as a budget cap. A `finish_reason` of "length" is logged below.
 */
const MAX_COMPLETION_TOKENS = 8192;

// --- Default tier: the dedicated OCR model (Hunyuan) ------------------------
const DEFAULT_HUNYUAN_BASE_URL = "https://api.futureppo.top/v1";
const DEFAULT_HUNYUAN_MODEL = "hunyuan-ocr";

/**
 * The upstream rejects the default Cloudflare-Workers User-Agent, which is what
 * originally forced a browser-side direct call (and the key leak that came with
 * it). Sending an ordinary browser User-Agent lets the server call it directly.
 * If this ever stops working, the default tier fails server-side — do NOT fix it
 * by reintroducing a browser-direct path; a browser cannot hold a credential.
 */
const HUNYUAN_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// --- Escalation tier: OpenAI -------------------------------------------------
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

/**
 * Model used on the DEFAULT tier only when no Hunyuan key is configured and the
 * proxy falls back to OpenAI. Kept cheap (mini) so the fallback does not burn
 * the small premium allowance.
 */
const DEFAULT_OPENAI_FALLBACK_MODEL = "gpt-4o-mini";

type Tier = 'default' | 'escalation';

interface ChatMessage {
  role: string;
  content: any[];
}

interface OcrRequestBody {
  messages?: ChatMessage[];
  temperature?: number;
  seed?: number;
  /**
   * Whether the caller's prompt asks for a JSON *object*. Only the OpenAI tier
   * uses this (response_format=json_object); the Hunyuan tier ignores it.
   */
  jsonObject?: boolean;
  tier?: string;
}

/**
 * Everything needed to call one provider. The two providers share the
 * chat/completions shape but differ in parameters and headers.
 */
interface Provider {
  name: string;
  baseUrl: string;
  key: string;
  model: string;
  /** Extra headers for the upstream call (e.g. the Hunyuan UA workaround). */
  extraHeaders: Record<string, string>;
  /** Builds the provider-specific request body. */
  buildBody: (body: OcrRequestBody) => Record<string, unknown>;
  /**
   * Whether to run the strip-rejected-param-and-retry loop. Only the OpenAI
   * tier sends the optional parameters that a model might reject by name.
   */
  retryOnReject: boolean;
}

/**
 * Resolves the provider for a tier from the environment, or returns a 503
 * Response if that provider's credential is not configured. An unconfigured
 * provider must fail loudly, never fall back to a credential in source.
 */
function resolveProvider(env: AppEnv, tier: Tier): Provider | Response {
  if (tier === 'escalation') {
    // OPENAI_API_KEY is the explicit name; OCR_API_KEY is accepted as a fallback
    // because that is where the deployment's existing OpenAI key already lives.
    const key = env.OPENAI_API_KEY || env.OCR_API_KEY;
    if (!key) {
      console.error("[api/ocr] No OpenAI key (OPENAI_API_KEY or OCR_API_KEY) is set on this deployment.");
      return fail("OCR escalation is not configured on this deployment.", 503);
    }
    const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    // A model without vision cannot read a document; catch it by name rather
    // than surface an opaque provider 400.
    if (!capabilitiesFor(model).vision) {
      console.error(`[api/ocr] configured OpenAI model ${model} does not support image input.`);
      return fail("OCR is not configured correctly on this deployment.", 503);
    }
    return {
      name: 'openai',
      baseUrl: (env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, ""),
      key,
      model,
      extraHeaders: {},
      // logprobs is what makes confidence scoring real on this tier. The dev
      // proxy in vite.config.ts must send the same, or dev and prod disagree.
      buildBody: (body) => ({
        model,
        messages: body.messages,
        ...buildModelParams(model, {
          temperature: body.temperature ?? 0,
          seed: body.seed ?? 42,
          logprobs: true,
          jsonObject: body.jsonObject === true,
          maxCompletionTokens: MAX_COMPLETION_TOKENS,
        }),
      }),
      retryOnReject: true,
    };
  }

  // Default tier: Hunyuan when configured. Until a Hunyuan key is added, fall
  // back to a cheap OpenAI model so extraction keeps working.
  const hunyuanKey = env.HUNYUAN_API_KEY;
  if (hunyuanKey) {
    const hunyuanModel = env.HUNYUAN_MODEL || DEFAULT_HUNYUAN_MODEL;
    return {
      name: 'hunyuan',
      baseUrl: (env.HUNYUAN_BASE_URL || DEFAULT_HUNYUAN_BASE_URL).replace(/\/$/, ""),
      key: hunyuanKey,
      model: hunyuanModel,
      extraHeaders: { "User-Agent": HUNYUAN_USER_AGENT },
      // The minimal body the Hunyuan endpoint is known to accept. It does not
      // support logprobs / response_format, so confidence on this tier comes
      // from the _overall_confidence value the prompt asks the model to return.
      buildBody: (body) => ({
        model: hunyuanModel,
        messages: body.messages,
        temperature: body.temperature ?? 0,
        seed: body.seed ?? 42,
      }),
      retryOnReject: false,
    };
  }

  // No Hunyuan key yet: fall back to a cheap OpenAI model on the default tier.
  const fallbackKey = env.OPENAI_API_KEY || env.OCR_API_KEY;
  if (fallbackKey) {
    const fallbackModel = DEFAULT_OPENAI_FALLBACK_MODEL;
    if (!capabilitiesFor(fallbackModel).vision) {
      console.error(`[api/ocr] fallback model ${fallbackModel} does not support image input.`);
      return fail("OCR is not configured correctly on this deployment.", 503);
    }
    return {
      name: 'openai',
      baseUrl: (env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(/\/$/, ""),
      key: fallbackKey,
      model: fallbackModel,
      extraHeaders: {},
      buildBody: (body) => ({
        model: fallbackModel,
        messages: body.messages,
        ...buildModelParams(fallbackModel, {
          temperature: body.temperature ?? 0,
          seed: body.seed ?? 42,
          logprobs: true,
          jsonObject: body.jsonObject === true,
          maxCompletionTokens: MAX_COMPLETION_TOKENS,
        }),
      }),
      retryOnReject: true,
    };
  }

  console.error("[api/ocr] Neither HUNYUAN_API_KEY nor an OpenAI key is set on this deployment.");
  return fail("OCR is not configured on this deployment.", 503);
}

export const onRequestPost: PagesFunction<AppEnv> = async (context) => {
  const { request, env } = context;

  // A missing D1 binding is a deployment misconfiguration, not an auth failure.
  // Reporting it as 401 would send the user to the sign-in screen over a problem
  // that no amount of signing in can fix.
  if (!env.DB) {
    console.error("[api/ocr] DB binding is not configured on this deployment.");
    return fail("OCR is not configured on this deployment.", 503);
  }

  let auth: Authed;
  try {
    const session = await requireSession(request, env);
    // A Response here means "not signed in", and never anything else.
    if (session instanceof Response) return session;
    auth = session;
  } catch (error) {
    // The lookup itself failed (D1 unreachable, migrations not applied). Same
    // reasoning as the binding check: that is a 503, not a 401.
    console.error("[api/ocr] session lookup failed:", error);
    return fail("OCR is temporarily unavailable.", 503);
  }

  // content-length is a claim, not a fact: it can be absent on a chunked upload
  // or simply wrong. Check the declared size first as a cheap rejection, then
  // check what actually arrived, before parsing 20 MB of JSON.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail("Document too large.", 413);
  }

  let rawBody: ArrayBuffer;
  try {
    rawBody = await request.arrayBuffer();
  } catch (error) {
    console.error("[api/ocr] could not read the request body:", error);
    return fail("Could not read the request body.", 400);
  }

  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return fail("Document too large.", 413);
  }

  let body: OcrRequestBody;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return fail("Request must include a non-empty `messages` array.", 400);
  }

  // Anything other than the exact string "escalation" is the default tier. A
  // typo or a hostile value costs the caller quality, never premium quota.
  const tier: Tier = body.tier === 'escalation' ? 'escalation' : 'default';

  const provider = resolveProvider(env, tier);
  if (provider instanceof Response) return provider;

  // Per account rather than per IP: past the session check the account is the
  // meaningful identity, and one signed-in user should still not be able to
  // spend without bound. The escalation tier is counted separately and far more
  // tightly, because it draws on a quota an order of magnitude smaller.
  const limited = await enforceRateLimit(
    env,
    'ocr',
    userIdentity(auth.user.id),
    RULES.ocr,
  );
  if (limited) return limited;

  if (tier === 'escalation') {
    const escalationLimited = await enforceRateLimit(
      env,
      'ocr:escalation',
      userIdentity(auth.user.id),
      RULES.ocrEscalation,
    );
    // Not an error for the caller to handle loudly: the client treats a failed
    // escalation as "keep the default-tier result", so hitting this cap degrades
    // quality rather than failing the document.
    if (escalationLimited) return escalationLimited;
  }

  let upstreamBody = provider.buildBody(body);

  // Up to two attempts, but only the OpenAI tier ever uses the second: it is
  // the only one that sends optional parameters a model might reject by name.
  let attemptsRemaining = provider.retryOnReject ? 2 : 1;

  while (attemptsRemaining > 0) {
    attemptsRemaining -= 1;

    try {
      const upstream = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.key}`,
          Accept: "application/json",
          ...provider.extraHeaders,
        },
        body: JSON.stringify(upstreamBody),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (upstream.ok) {
        let data: any;
        try {
          data = await upstream.json();
        } catch (error) {
          console.error("[api/ocr] provider returned 200 with a non-JSON body:", error);
          return fail("The OCR service returned an unreadable response.", 502);
        }

        // Quota accounting. The daily allowances are the binding constraint on
        // this platform, so the real per-page cost has to be observable rather
        // than estimated.
        const tokens = usedTokens(data);
        console.log(
          `[api/ocr] provider=${provider.name} model=${provider.model} tier=${tier} tokens=${tokens ?? 'unknown'}`,
        );

        // A response cut off at the token ceiling is truncated mid-JSON. The
        // client's parser will fail on it and report a failed extraction, which
        // looks identical to a provider outage unless this is logged.
        if (data?.choices?.[0]?.finish_reason === 'length') {
          console.error(
            `[api/ocr] response hit max_completion_tokens (${MAX_COMPLETION_TOKENS}); JSON is likely truncated.`,
          );
        }

        return json(data, 200, authHeaders(auth));
      }

      const detailText = await upstream.text().catch(() => "");
      const detail = detailText.slice(0, MAX_ERROR_DETAIL_CHARS);

      // A 400 naming a parameter is recoverable on the OpenAI tier: strip that
      // field and retry. Hunyuan sends no optional params, so it never retries.
      if (provider.retryOnReject && upstream.status === 400 && attemptsRemaining > 0) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(detailText);
        } catch {
          // Not JSON, so there is no named parameter to act on. Falls through.
        }
        const retry = retryWithoutRejectedParam(upstreamBody, parsed);
        if (retry) {
          console.warn(
            `[api/ocr] ${provider.model} rejected '${retry.removed}'; retrying without it. ` +
              `Update the capability table in server/openai-params.ts.`,
          );
          upstreamBody = retry.body;
          continue;
        }
      }

      console.error(
        `[api/ocr] provider=${provider.name} HTTP ${upstream.status}: ${detail || upstream.statusText}`,
      );

      // The upstream status is NOT forwarded verbatim. A vendor 401 is not the
      // caller's 401: the client's error handler reads 401 as "your session has
      // expired" and signs the user out, so an expired *vendor* key used to log
      // everybody out. A 429 read as the caller's rate limit was equally wrong.
      // Anything that describes our relationship with the provider is a gateway
      // problem, which is what 502 means. This matches the dev proxy in
      // vite.config.ts. 413 is the exception: that one really is about the
      // caller's document.
      const status = upstream.status === 413 ? 413 : 502;

      return json({
        error: `OCR provider returned HTTP ${upstream.status}`,
        details: detail || upstream.statusText,
      }, status);

    } catch (error: any) {
      const reason = error?.message || String(error);
      console.error(`[api/ocr] provider=${provider.name} unreachable: ${reason}`);

      return json({
        error: "Could not reach the OCR service.",
        details: reason.slice(0, MAX_ERROR_DETAIL_CHARS),
      }, 502);
    }
  }

  // Only reachable if the retry loop exhausted its attempts without returning,
  // which would mean a 400 was recoverable twice over. Defensive, not expected.
  console.error("[api/ocr] exhausted upstream attempts without a usable response.");
  return fail("Could not reach the OCR service.", 502);
};