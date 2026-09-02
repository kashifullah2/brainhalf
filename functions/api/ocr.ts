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
import { executeOcrRequest, type Tier } from '../../server/ocr-provider';
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
const ALLOWED_DOCUMENT_TYPES: ReadonlySet<string> = new Set(OCR_DOCUMENT_TYPES);

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

  // Anything other than the exact string "escalation" is the default tier.
  const tier: Tier = body.tier === 'escalation' ? 'escalation' : 'default';

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
    if (escalationLimited) return escalationLimited;
  }

  const result = await executeOcrRequest(env, tier, {
    messages: upstream.messages,
    jsonObject: upstream.jsonObject
  });

  if (result.type === 'config-error') {
    console.error(`[api/ocr] ${result.message}`);
    return fail(result.message, 503);
  }

  if (result.type === 'success') {
    console.log(
      `[api/ocr] provider=${result.providerName} model=${result.model} tier=${tier} tokens=${result.tokensUsed ?? 'unknown'}`,
    );
    if (result.isTruncated) {
      console.error(
        `[api/ocr] response hit max_completion_tokens; JSON is likely truncated.`,
      );
    }
    return json(result.data, 200, authHeaders(auth));
  }

  if (result.type === 'permanent-error' && result.payloadTooLarge) {
    return tooLarge();
  }

  console.error(
    `[api/ocr] provider=${result.providerName} HTTP ${result.status ?? 'unknown'}: ${result.detail.slice(0, MAX_ERROR_DETAIL_CHARS)}`
  );

  return fail(result.message, 503);
};