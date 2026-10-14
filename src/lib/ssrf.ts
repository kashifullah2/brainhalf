/**
 * Guards the server-side `fetch` used by the agent's `fetch_api` tool.
 *
 * The tool fetches a model-chosen URL derived from a client-supplied prompt. Without
 * a guard that is an open SSRF channel: it can reach the worker's own metadata
 * endpoints, internal services on private ranges, and loopback listeners that are
 * not exposed to the public internet.
 *
 * The guard refuses anything that is not a public, routable address, and then
 * fetches with redirect caps and a size ceiling so a redirect cannot be used to
 * escape the check after the fact.
 *
 * Scope limitation, stated plainly: hostname *literals* are range-checked, but a
 * DNS name is validated by shape only — the guard does not resolve it. So a
 * public name that resolves to a private or loopback address (a rebinding setup,
 * or a domain pointing at a cloud metadata endpoint) is not refused here. On the
 * Cloudflare Workers runtime outbound fetch to RFC1918 and loopback is not
 * routable, which is the real control; in local `wrangler dev` or under Vitest,
 * where loopback *is* reachable, that platform guarantee does not apply. Resolve
 * and pin the address before fetch if this guard ever needs to be a hard
 * guarantee.
 */

/** Maximum bytes read from a tool fetch. The tool only surfaces a short excerpt. */
export const FETCH_MAX_BYTES = 64 * 1024;
/** Maximum response size scanned before the body is truncated. */
export const FETCH_MAX_TEXT = 3000;
/** Never follow more than this many redirects. */
export const FETCH_MAX_REDIRECTS = 3;
/** Wall-clock ceiling on a tool fetch. */
export const FETCH_TIMEOUT_MS = 30 * 1000;

/**
 * True only for a hostname that is shape-valid and not a known-internal name.
 *
 * Scope: this is a *shape* check, not a resolution. IPv4/IPv6 literals are
 * range-checked against private/loopback/link-local ranges; a DNS name is only
 * matched against a regex and a small internal-name blocklist. It does NOT
 * resolve the name, so a public-looking name pointing at a private address is
 * still accepted here — see the file header for the control that covers it.
 */
export function isPublicRoutableHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;

  // Reject anything that is not a DNS name or a bracketed IPv6 literal.
  const ipv6 = host.match(/^\[([0-9a-f:.]+)\]$/i);
  const ip = ipv6 ? ipv6[1] : (isPlainIpv4(host) ? host : null);

  if (ip !== null) {
    return isPublicIp(ip);
  }

  // A DNS name must look like one. This is not a full public-suffix check; it exists
  // so nonsense (e.g. `localhost`, `metadata.google.internal.`) is rejected by shape.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    return false;
  }

  // Well-known internal names that would pass the shape check above.
  const BLOCKED_HOSTS = new Set([
    'localhost',
    'metadata.google.internal',
    'metadata',
    'instance-data',
    'linklocal',
    'kubernetes.default.svc',
    'kubernetes.default.svc.cluster.local',
  ]);
  if (BLOCKED_HOSTS.has(host)) return false;

  return true;
}

/** Matches a dotted-quad IPv4 address and nothing else. */
function isPlainIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^[0-9]{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

/**
 * True for an IPv4/IPv6 address that is not private, loopback, link-local,
 * carrier-grade NAT, multicast, or reserved. Anything ambiguous is refused.
 */
export function isPublicIp(ip: string): boolean {
  const v4 = isPlainIpv4(ip) ? ip : null;
  if (v4) {
    const [a, b] = v4.split('.').map(Number);
    if (a === 0) return false;                                 // 0.0.0.0/8 "this host"
    if (a === 10) return false;                                // private
    if (a === 127) return false;                               // loopback
    if (a === 169 && b === 254) return false;                   // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;          // private
    if (a === 192 && b === 168) return false;                   // private
    if (a === 100 && b >= 64 && b <= 127) return false;         // CGNAT
    if (a >= 224) return false;                                 // multicast / reserved
    return true;
  }

  // IPv6 literal (already stripped of brackets by the caller).
  const addr = ip.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(addr)) return false;
  if (addr.includes('::')) {
    // Reject any compressed form conservatively: expanding it correctly is more
    // error-prone than refusing a range that no legitimate tool fetch needs.
    return false;
  }
  const groups = addr.split(':');
  if (groups.length !== 8) return false;
  const first = parseInt(groups[0], 16);
  if (first === 0) return false;                                // ::/128, ::1
  if ((first & 0xffc0) === 0xfc00) return false;                // unique-local fd00::/8
  if ((first & 0xff00) === 0xfe00) return false;                // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false;                // multicast ff00::/8
  if (first === 0x2001 && parseInt(groups[1], 16) === 0xdb8) return false; // documentation
  return true;
}

/**
 * Validates a fully-formed URL for an outbound tool fetch. Returns the reason it was
 * refused, or null when the URL is safe to request.
 */
export function validateFetchUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'not a valid URL';
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `unsupported protocol "${url.protocol}"`;
  }
  if (url.username || url.password) {
    return 'credentials in the URL are not allowed';
  }
  if (!isPublicRoutableHost(url.hostname)) {
    return `hostname "${url.hostname}" is not a public, routable address`;
  }
  return null;
}

export interface SafeFetchResult {
  status: number;
  data: string;
  url?: string;
  error?: string;
}

/**
 * Performs the guarded fetch for the `fetch_api` tool. Redirects are followed
 * manually so every hop is re-validated — a public URL that redirects to
 * `http://169.254.169.254` is refused at the hop, not allowed by the first check.
 */
export async function safeFetchText(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  options: { timeoutMs?: number } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const initialError = validateFetchUrl(rawUrl);
  if (initialError) {
    return { status: 0, data: '', error: `Refused: ${initialError}` };
  }

  let currentUrl = rawUrl;
  // One wall-clock deadline for the whole redirect chain: each hop only gets
  // the time remaining, so a slow redirect chain cannot multiply the timeout.
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { status: 0, data: '', url: currentUrl, error: `fetch_api exceeded the ${timeoutMs / 1000}s timeout` };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('fetch_api exceeded the timeout')), remaining);
    try {
      const res = await fetchImpl(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'BrainHalf-Preview-Bot/1.0' },
      });

      // A manual-redirect fetch returns a 3xx with a Location header.
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location') as string, currentUrl).toString();
        const hopError = validateFetchUrl(next);
        if (hopError) {
          return { status: res.status, data: '', url: currentUrl, error: `Refused redirect: ${hopError}` };
        }
        if (hop === FETCH_MAX_REDIRECTS) {
          return { status: res.status, data: '', url: currentUrl, error: `Refused: too many redirects` };
        }
        currentUrl = next;
        continue;
      }

      // Read at most FETCH_MAX_BYTES so a hostile endpoint cannot exhaust memory.
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            chunks.push(value);
            if (received >= FETCH_MAX_BYTES) break;
          }
        }
        try { await reader.cancel(); } catch { /* already closed */ }
      }
      const buffer = new Uint8Array(Math.min(received, FETCH_MAX_BYTES));
      let offset = 0;
      for (const chunk of chunks) {
        if (offset >= FETCH_MAX_BYTES) break;
        const copy = chunk.subarray(0, FETCH_MAX_BYTES - offset);
        buffer.set(copy, offset);
        offset += copy.byteLength;
      }
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      return { status: res.status, data: text.slice(0, FETCH_MAX_TEXT), url: currentUrl };
    } catch (e: any) {
      const aborted = controller.signal.aborted;
      return {
        status: 0,
        data: '',
        url: currentUrl,
        error: aborted ? `fetch_api exceeded the ${timeoutMs / 1000}s timeout` : (e?.message || String(e)),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { status: 0, data: '', error: 'Refused: redirect loop' };
}

/**
 * Validates a custom model base URL for storage and use.
 *
 * Stricter than validateFetchUrl — HTTPS is required and raw IP literals are
 * rejected regardless of whether they are public. A domain name is required so
 * the target is human-auditable and admin-approved rather than an arbitrary
 * address. Returns null if safe, or a human-readable reason string if refused.
 */
export function assertSafeCustomModelUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'not a valid URL';
  }
  if (url.protocol !== 'https:') {
    return 'base URL must use HTTPS';
  }
  const host = url.hostname.toLowerCase();
  // Reject raw IPv4 dotted-quad and bracketed IPv6 literals entirely.
  // IP-literal targets are hard to audit and are the primary SSRF vector.
  if (/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(host) || host.startsWith('[')) {
    return 'IP address literals are not allowed; use a domain name';
  }
  if (!isPublicRoutableHost(host)) {
    return `hostname "${host}" is not a public routable address (localhost and private ranges are not allowed)`;
  }
  return null;
}

const KNOWN_PROVIDER_BASE_PATHS: Record<string, string> = {
  'api.openai.com': '/v1',
  'api.deepseek.com': '/v1',
  'api.groq.com': '/openai/v1',
  'openrouter.ai': '/api/v1',
  'generativelanguage.googleapis.com': '/v1beta/openai',
  'api.together.xyz': '/v1',
  'api.fireworks.ai': '/inference/v1',
  'api.mistral.ai': '/v1',
  'api.x.ai': '/v1',
  'api.cohere.com': '/compatibility/v1',
  'api.anthropic.com': '/v1',
  'api.cerebras.ai': '/v1',
  'api.sambanova.ai': '/v1',
  'api.hyperbolic.xyz': '/v1',
};

/**
 * Normalizes a custom model Base URL so common user inputs work out of the box:
 * - Strips accidental trailing `/chat/completions`, `/completions`, or `/messages`
 * - Fills in the standard OpenAI-compatible base path for known provider roots
 * - Removes trailing slashes
 */
export function normalizeCustomModelBaseUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    let pathname = url.pathname.replace(/\/+$/, '');
    pathname = pathname
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/completions$/i, '')
      .replace(/\/messages$/i, '')
      .replace(/\/+$/, '');

    const host = url.hostname.toLowerCase();
    if (!pathname || pathname === '/') {
      const defaultPath = KNOWN_PROVIDER_BASE_PATHS[host];
      if (defaultPath) pathname = defaultPath;
    } else if (host === 'openrouter.ai' && pathname === '/api') {
      pathname = '/api/v1';
    } else if (host === 'api.groq.com' && pathname === '/openai') {
      pathname = '/openai/v1';
    } else if (host === 'generativelanguage.googleapis.com' && (pathname === '/v1beta' || pathname === '/v1')) {
      pathname = '/v1beta/openai';
    }

    url.pathname = pathname || '/';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed
      .replace(/\/+$/, '')
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/+$/, '');
  }
}

export function buildCustomModelHeaders(
  apiKey: string,
  baseUrl: string,
  extraHeaders?: HeadersInit
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream, application/json',
    'Authorization': `Bearer ${apiKey}`,
    'User-Agent': 'BrainHalf/1.0 (+https://brainhalf.com)',
  };
  if (extraHeaders) {
    const entries = extraHeaders instanceof Headers
      ? Array.from(extraHeaders.entries())
      : Array.isArray(extraHeaders)
        ? extraHeaders
        : Object.entries(extraHeaders);
    for (const [k, v] of entries) {
      if (v !== undefined && v !== null) headers[k] = String(v);
    }
  }
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) {
      if (!headers['HTTP-Referer']) headers['HTTP-Referer'] = 'https://brainhalf.com';
      if (!headers['X-Title']) headers['X-Title'] = 'BrainHalf';
    } else if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) {
      if (!headers['x-api-key']) headers['x-api-key'] = apiKey;
      if (!headers['anthropic-version']) headers['anthropic-version'] = '2023-06-01';
    }
  } catch {
    // ignore URL parse error
  }
  return headers;
}

export function extractUpstreamErrorMessage(status: number, rawText: string): string {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    if (status === 503) return 'Upstream model service is temporarily overloaded or warming up — try again in a few seconds or verify the Model ID and Base URL';
    if (status === 502 || status === 504) return 'Upstream model gateway timed out or could not be reached';
    if (status === 401 || status === 403) return 'Authentication failed — check your API key';
    if (status === 404) return 'Endpoint or Model ID not found — verify Base URL and Model ID';
    if (status === 429) return 'Rate limit or quota exceeded on the upstream provider';
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed);
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    const candidate =
      root?.error?.message ||
      root?.error?.detail ||
      (typeof root?.error === 'string' ? root.error : '') ||
      root?.message ||
      root?.detail ||
      root?.error_msg ||
      '';
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim().replace(/\s+/g, ' ').slice(0, 240);
    }
  } catch {
    // Not JSON
  }
  if (/<html|<!doctype|<head|<body/i.test(trimmed)) {
    const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim().replace(/\s+/g, ' ');
    if (title) return `Upstream gateway error (${title.slice(0, 120)})`;
    return `Upstream gateway returned an HTML ${status} error page — verify Base URL or retry shortly`;
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, 240);
}

export function jsonCompletionToSseResponse(json: Record<string, unknown>, status = 200): Response {
  const choices = Array.isArray(json.choices) ? (json.choices as Array<Record<string, any>>) : [];
  const firstChoice = choices[0] || {};
  const msg = firstChoice.message || firstChoice.delta || {};
  let contentText = '';
  if (typeof msg.content === 'string') {
    contentText = msg.content;
  } else if (Array.isArray(msg.content)) {
    contentText = msg.content
      .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  } else if (typeof firstChoice.text === 'string') {
    contentText = firstChoice.text;
  } else if (Array.isArray(json.content)) {
    contentText = (json.content as Array<any>)
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('');
  } else if (typeof json.response === 'string') {
    contentText = json.response;
  }

  const reasoningText = typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '';
  const toolCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc: any, idx: number) => ({
        index: typeof tc?.index === 'number' ? tc.index : idx,
        id: tc?.id || `call_${idx}`,
        type: tc?.type || 'function',
        function: tc?.function || {},
      }))
    : undefined;

  const delta: Record<string, unknown> = { role: 'assistant' };
  if (contentText) delta.content = contentText;
  else if (reasoningText) delta.content = reasoningText;
  else if (!toolCalls) delta.content = '';
  if (toolCalls && toolCalls.length > 0) delta.tool_calls = toolCalls;

  const chunkPayload: Record<string, unknown> = {
    id: json.id || 'chatcmpl-fallback',
    object: 'chat.completion.chunk',
    created: json.created || Math.floor(Date.now() / 1000),
    model: json.model || 'custom',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: firstChoice.finish_reason || (toolCalls?.length ? 'tool_calls' : 'stop'),
      },
    ],
  };
  if (json.usage) chunkPayload.usage = json.usage;

  const sseBody = `data: ${JSON.stringify(chunkPayload)}\n\ndata: [DONE]\n\n`;
  return new Response(sseBody, {
    status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

function isTransientModelStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504 || status === 520 || status === 522 || status === 524;
}

export async function fetchCustomModelWithRetry(options: {
  url: string;
  apiKey: string;
  baseUrl: string;
  init?: RequestInit;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}): Promise<Response> {
  const fetchFn = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 2;
  const isVitest = typeof process !== 'undefined' && Boolean(process.env?.VITEST);
  const headers = buildCustomModelHeaders(options.apiKey, options.baseUrl, options.init?.headers);

  let rawBodyStr = typeof options.init?.body === 'string' ? options.init.body : '';
  let parsedBody: Record<string, unknown> | null = null;
  if (rawBodyStr) {
    try {
      parsedBody = JSON.parse(rawBodyStr) as Record<string, unknown>;
    } catch {
      parsedBody = null;
    }
  }

  // Clamp excessive default max_tokens (e.g. 65536) on initial request to 16384
  // so standard OpenAI/DeepSeek/Gemini/Groq models don't immediately 400.
  if (parsedBody) {
    if (typeof parsedBody.max_tokens === 'number' && parsedBody.max_tokens > 16384) {
      parsedBody = { ...parsedBody, max_tokens: 16384 };
      rawBodyStr = JSON.stringify(parsedBody);
    }
    if (typeof parsedBody.max_completion_tokens === 'number' && parsedBody.max_completion_tokens > 16384) {
      parsedBody = { ...parsedBody, max_completion_tokens: 16384 };
      rawBodyStr = JSON.stringify(parsedBody);
    }
  }

  const executeSingleFetch = async (targetUrl: string, bodyStr: string): Promise<Response> => {
    let currentUrl = targetUrl;
    for (let hop = 0; hop <= 2; hop++) {
      const resp = await fetchFn(currentUrl, {
        ...options.init,
        method: options.init?.method || 'POST',
        redirect: 'manual',
        headers,
        body: bodyStr || options.init?.body,
      });
      if (resp.status >= 300 && resp.status < 400 && resp.headers.get('location') && hop < 2) {
        try {
          const nextUrl = new URL(resp.headers.get('location')!, currentUrl).toString();
          if (assertSafeCustomModelUrl(nextUrl) === null) {
            currentUrl = nextUrl;
            continue;
          }
        } catch {
          // fall through and return redirect response
        }
      }
      return resp;
    }
    return fetchFn(currentUrl, {
      ...options.init,
      method: options.init?.method || 'POST',
      redirect: 'manual',
      headers,
      body: bodyStr || options.init?.body,
    });
  };

  let lastResp = await executeSingleFetch(options.url, rawBodyStr);

  // 1. Retry transient 429 / 502 / 503 / 504 errors with exponential backoff
  for (let attempt = 1; attempt <= maxRetries && isTransientModelStatus(lastResp.status); attempt++) {
    if (options.init?.signal?.aborted) break;
    const delayMs = isVitest ? 5 : 650 * attempt;
    await new Promise((r) => setTimeout(r, delayMs));
    if (options.init?.signal?.aborted) break;
    lastResp = await executeSingleFetch(options.url, rawBodyStr);
    if (lastResp.ok) break;
  }

  // 2. If baseUrl had no path (e.g. https://custom-host.example.com/chat/completions)
  // and returned 404 or 503, try /v1/chat/completions on the same host.
  if (!lastResp.ok && (lastResp.status === 404 || lastResp.status === 503)) {
    try {
      const u = new URL(options.url);
      if (u.pathname === '/chat/completions') {
        u.pathname = '/v1/chat/completions';
        const altResp = await executeSingleFetch(u.toString(), rawBodyStr);
        if (altResp.ok) lastResp = altResp;
      }
    } catch {
      // ignore
    }
  }

  // 2b. If the request included `tools` / `tool_choice` and the custom endpoint
  // returned 400, 422, 500, 501, 502, or 503 (many OpenAI-compatible proxies,
  // reasoning models, and vLLM deployments return 503/500/400 when tool schemas
  // or `tool_choice: "auto"` are sent), retry without `tools` so the model can
  // respond directly using BrainHalf's <file path="..."> protocol.
  if (!lastResp.ok && [400, 422, 500, 501, 502, 503].includes(lastResp.status) && parsedBody && ('tools' in parsedBody || 'tool_choice' in parsedBody)) {
    const toolLessBody = { ...parsedBody };
    delete toolLessBody.tools;
    delete toolLessBody.tool_choice;
    const toolLessResp = await executeSingleFetch(options.url, JSON.stringify(toolLessBody));
    if (toolLessResp.ok) {
      lastResp = toolLessResp;
      parsedBody = toolLessBody;
      rawBodyStr = JSON.stringify(toolLessBody);
    }
  }

  // 3. If max_tokens was rejected (400/422/503) on models with smaller 4k/8k caps,
  // retry with max_tokens=8192 and then without max_tokens.
  if (!lastResp.ok && (lastResp.status === 400 || lastResp.status === 422 || lastResp.status === 503) && parsedBody && ('max_tokens' in parsedBody || 'max_completion_tokens' in parsedBody)) {
    const reducedBody = { ...parsedBody };
    delete reducedBody.max_tokens;
    delete reducedBody.max_completion_tokens;
    const retryResp = await executeSingleFetch(options.url, JSON.stringify(reducedBody));
    if (retryResp.ok) {
      lastResp = retryResp;
      parsedBody = reducedBody;
      rawBodyStr = JSON.stringify(reducedBody);
    }
  }

  // 4. Google Gemini OpenAI-compat endpoint often returns 503 on overloaded/retired preview models
  // (e.g. gemini-2.0-flash or busy gemini-2.5-pro). Try stable fallback Gemini models if 503/404 persists.
  if (!lastResp.ok && (lastResp.status === 503 || lastResp.status === 404) && parsedBody && typeof parsedBody.model === 'string') {
    try {
      const host = new URL(options.url).hostname.toLowerCase();
      if (host === 'generativelanguage.googleapis.com') {
        const fallbacks = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash'].filter(m => m !== parsedBody!.model);
        for (const fbModel of fallbacks) {
          const fbBody = { ...parsedBody, model: fbModel };
          const fbResp = await executeSingleFetch(options.url, JSON.stringify(fbBody));
          if (fbResp.ok) {
            lastResp = fbResp;
            parsedBody = fbBody;
            rawBodyStr = JSON.stringify(fbBody);
            break;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. Non-streaming fallback: some OpenAI-compatible gateways/models return 503/502/400/501
  // when `stream: true` is sent, but succeed with `stream: false`.
  const requestedStream = parsedBody?.stream === true;
  if (!lastResp.ok && requestedStream && (lastResp.status === 503 || lastResp.status === 502 || lastResp.status === 500 || lastResp.status === 400 || lastResp.status === 501)) {
    const nonStreamBody = { ...parsedBody, stream: false };
    const nonStreamResp = await executeSingleFetch(options.url, JSON.stringify(nonStreamBody));
    if (nonStreamResp.ok) {
      try {
        const json = (await nonStreamResp.json()) as Record<string, unknown>;
        return jsonCompletionToSseResponse(json, 200);
      } catch {
        // ignore and return original response
      }
    }
  }

  // 6. If the upstream ignored `stream: true` and returned 200 OK with application/json,
  // convert the JSON payload into an SSE stream so SSE consumers receive the content cleanly.
  if (lastResp.ok && requestedStream) {
    const ct = (lastResp.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      try {
        const clone = lastResp.clone();
        const json = (await clone.json()) as Record<string, unknown>;
        if (json && (Array.isArray(json.choices) || Array.isArray(json.content) || typeof json.response === 'string')) {
          return jsonCompletionToSseResponse(json, lastResp.status);
        }
      } catch {
        // fall through to original response
      }
    }
  }

  return lastResp;
}
