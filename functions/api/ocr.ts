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
import {
  MAX_CUSTOM_PROMPT_CHARS,
  OCR_DOCUMENT_TYPES,
  buildUpstreamRequest,
  isOcrMode,
  type OcrMode,
} from '../../server/ocr-prompts';

/**
 * 20 MB, and it is the binding constraint on PDF size rather than an arbitrary
 * round number: the document arrives base64-encoded inside this JSON body, which
 * costs 1.34x, and raising this is not free -- decoding the body into a JS string
 * and JSON.parsing it are two more copies again, against a 128 MB isolate.
 *
 * src/lib/upload-limits.ts derives the 14 MB PDF cap from this value, and
 * functions/api/storage/upload.ts enforces it before a byte is stored. Change one
 * and change all three.
 */
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
 * it). Sending an ordinary browser User-Agent triggered Cloudflare Bot Fight Mode.
 * Using a custom server User-Agent avoids both issues.
 */
const HUNYUAN_USER_AGENT = "BrainHalf-OCR-Backend/1.0";

// --- Escalation tier: OpenAI -------------------------------------------------
// Defaults live in server/openai-params.ts, shared with the dev proxy in
// vite.config.ts so the two cannot drift.
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_FALLBACK_MODEL,
} from '../../server/openai-params';

type Tier = 'default' | 'escalation';

/**
 * What a caller may send.
 *
 * It used to be a `messages` array, forwarded upstream verbatim -- so this
 * endpoint was general purpose LLM access on the account's budget, reachable by
 * anyone with a session. The caller now names a mode and supplies a document; the
 * prompt is built server-side in server/ocr-prompts.ts from values checked
 * against a fixed list. Nothing in this body reaches the model as instructions.
 */
interface OcrRequestBody {
  tier?: unknown;
  mode?: unknown;
  customPrompt?: unknown;
  document?: {
    contentType?: unknown;
    dataUrl?: unknown;
    filename?: unknown;
  };
  /** Rejected, not ignored. See the check in the handler. */
  messages?: unknown;
}

/** The parts of the upstream call a provider body is assembled from. */
interface UpstreamInput {
  messages: Array<{ role: string; content: unknown[] }>;
  jsonObject: boolean;
}

/**
 * Fixed rather than caller-supplied. Both were read off the request body, which
 * gave a caller two knobs on billed behaviour for no reason -- the prompts want
 * deterministic output, which is what these values are for.
 */
const UPSTREAM_TEMPERATURE = 0;
const UPSTREAM_SEED = 42;

const ALLOWED_DOCUMENT_TYPES: ReadonlySet<string> = new Set(OCR_DOCUMENT_TYPES);

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
  buildBody: (input: UpstreamInput) => Record<string, unknown>;
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
      buildBody: (input) => ({
        model,
        messages: input.messages,
        ...buildModelParams(model, {
          temperature: UPSTREAM_TEMPERATURE,
          seed: UPSTREAM_SEED,
          logprobs: true,
          jsonObject: input.jsonObject,
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
      buildBody: (input) => ({
        model: hunyuanModel,
        messages: input.messages,
        temperature: UPSTREAM_TEMPERATURE,
        seed: UPSTREAM_SEED,
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
      buildBody: (input) => ({
        model: fallbackModel,
        messages: input.messages,
        ...buildModelParams(fallbackModel, {
          temperature: UPSTREAM_TEMPERATURE,
          seed: UPSTREAM_SEED,
          logprobs: true,
          jsonObject: input.jsonObject,
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
  // Names the cause. "Document too large." on its own was indistinguishable from
  // a provider problem, and the file it referred to had already uploaded cleanly.
  const tooLarge = () =>
    fail(
      "This document is too large to extract. PDFs must be under 14 MB, because the whole file is sent to the model.",
      413,
    );

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return tooLarge();
  }

  let rawBody: ArrayBuffer;
  try {
    rawBody = await request.arrayBuffer();
  } catch (error) {
    console.error("[api/ocr] could not read the request body:", error);
    return fail("Could not read the request body.", 400);
  }

  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return tooLarge();
  }

  let body: OcrRequestBody;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  // A `messages` array is refused outright rather than ignored. Accepting one was
  // the whole vulnerability, and a client still sending it is a stale deploy that
  // should fail loudly rather than have its prompt silently replaced.
  if (body.messages !== undefined) {
    return fail(
      "This endpoint no longer accepts a `messages` array. Send { mode, document } instead.",
      400,
    );
  }

  if (!isOcrMode(body.mode)) {
    return fail("Unknown or missing extraction mode.", 400);
  }
  const mode: OcrMode = body.mode;

  // The user's own instructions are the ONE piece of caller text that reaches the
  // model, and only inside the delimited block server/ocr-prompts.ts puts it in.
  const customPrompt =
    typeof body.customPrompt === 'string' && body.customPrompt.trim()
      ? body.customPrompt.trim().slice(0, MAX_CUSTOM_PROMPT_CHARS)
      : undefined;

  const documentInput = body.document;
  if (!documentInput || typeof documentInput !== 'object') {
    return fail("Request must include a `document`.", 400);
  }

  const contentType =
    typeof documentInput.contentType === 'string' ? documentInput.contentType : '';
  if (!ALLOWED_DOCUMENT_TYPES.has(contentType)) {
    return fail(
      `Unsupported document type (${contentType || 'unknown'}). Use JPG, PNG, WEBP, or PDF.`,
      415,
    );
  }

  const dataUrl = typeof documentInput.dataUrl === 'string' ? documentInput.dataUrl : '';
  // Must be inline base64, never a URL. A remote address here would have the
  // provider fetch whatever the caller named, on our credential.
  if (!dataUrl.startsWith(`data:${contentType};base64,`) || dataUrl.length < 32) {
    return fail("`document.dataUrl` must be a base64 data URL matching the declared type.", 400);
  }

  const filename =
    typeof documentInput.filename === 'string'
      ? documentInput.filename.slice(0, 255)
      : 'document';

  // Everything sent upstream is built here, from the values checked above.
  const upstream = buildUpstreamRequest(mode, customPrompt, {
    contentType,
    dataUrl,
    filename,
  });

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

  let upstreamBody = provider.buildBody(upstream);

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
        let data: unknown;
        try {
          data = await upstream.json();
        } catch (error) {
          console.error("[api/ocr] provider returned 200 with a non-JSON body:", error);
          return fail("The OCR service returned an unreadable response.", 503);
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
        const choices = (data as { choices?: Array<{ finish_reason?: unknown }> } | null)?.choices;
        if (choices?.[0]?.finish_reason === 'length') {
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

      // 413 is the one upstream status that really is about the caller's document.
      if (upstream.status === 413) return tooLarge();

      // Neither the vendor's status nor its message is forwarded.
      //
      // The status, because a vendor 401 is not the caller's 401: the client reads
      // 401 as "your session has expired" and signs the user out, so an expired
      // *vendor* key used to log everybody out, and a vendor 429 read as the
      // caller's own rate limit. Anything describing our relationship with the
      // provider is a gateway problem. 503 rather than 502 because Cloudflare Pages
      // replaces a 502 with its own HTML error page, which breaks the JSON contract.
      //
      // The message, because it is the vendor's prose about our account: it has
      // named models, endpoints, quota states and billing conditions. It is logged
      // above, where an operator can read it, and not returned to a browser.
      return fail(
        "The extraction service could not read this document. Try again in a moment.",
        503,
      );

    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Logged, not returned: a transport failure message can carry the upstream
      // hostname and the shape of our egress.
      console.error(
        `[api/ocr] provider=${provider.name} unreachable: ${reason.slice(0, MAX_ERROR_DETAIL_CHARS)}`,
      );

      return fail("Could not reach the extraction service. Try again in a moment.", 503);
    }
  }

  // Only reachable if the retry loop exhausted its attempts without returning,
  // which would mean a 400 was recoverable twice over. Defensive, not expected.
  console.error("[api/ocr] exhausted upstream attempts without a usable response.");
  return fail("Could not reach the OCR service.", 503);
};