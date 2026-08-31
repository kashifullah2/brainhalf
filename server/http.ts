// ---------------------------------------------------------------------------
// Shared HTTP helpers for the Pages Functions in functions/.
//
// This directory lives OUTSIDE functions/ on purpose: every file under
// functions/ becomes a public route, and shared library code must not be
// reachable as an endpoint.
// ---------------------------------------------------------------------------

export interface AppEnv {
  /** D1 database binding declared in wrangler.toml. */
  DB: D1Database;
  /** R2 bucket holding the original uploaded documents. */
  DOCUMENTS: R2Bucket;
  /** Default-tier OCR provider: the dedicated OCR model (Hunyuan). Server-only. */
  HUNYUAN_API_KEY?: string;
  HUNYUAN_BASE_URL?: string;
  HUNYUAN_MODEL?: string;
  /**
   * Escalation-tier provider: OpenAI. Used only to re-extract a page the
   * default tier read with low confidence. Draws on a much smaller daily quota
   * — see RULES.ocrEscalation.
   */
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  /**
   * Legacy OpenAI key name, kept as a fallback: api/ocr.ts uses it when
   * OPENAI_API_KEY is not set, so a deployment whose OpenAI key was already
   * stored under this name keeps working. New setups should use OPENAI_API_KEY.
   */
  OCR_API_KEY?: string;
  /**
   * Google OAuth client ID. Public by nature, but the server needs it to check
   * the `aud` claim of an ID token — without that check, a token minted for a
   * different application would be accepted.
   */
  GOOGLE_CLIENT_ID?: string;
  /**
   * Fallback name under which the same public Google OAuth client ID is exposed
   * to the client bundle. auth/google.ts accepts it so a single value can be
   * shared between the Vite build and the server. Same value as GOOGLE_CLIENT_ID.
   */
  VITE_GOOGLE_CLIENT_ID?: string;
  /** Cloudflare Email Service binding, used for password reset mail. */
  EMAIL?: { send: (message: unknown) => Promise<unknown> };
  /** EmailJS parameters for password reset mail delivery. */
  EMAILJS_SERVICE_ID?: string;
  EMAILJS_TEMPLATE_ID?: string;
  EMAILJS_PWD_TEMPLATE_ID?: string;
  EMAILJS_PUBLIC_KEY?: string;
  VITE_EMAILJS_SERVICE_ID?: string;
  VITE_EMAILJS_TEMPLATE_ID?: string;
  VITE_EMAILJS_PWD_TEMPLATE_ID?: string;
  VITE_EMAILJS_PUBLIC_KEY?: string;
  /** Background processing queue for OCR */
  OCR_QUEUE?: Queue<any>;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  // Auth responses must never be cached by a browser or an intermediary.
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function json(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, ...extraHeaders },
  });
}

/**
 * A client-safe error. The `message` is shown to the user, so it must never
 * disclose whether an account exists, or anything about server internals.
 */
export function fail(message: string, status: number): Response {
  return json({ error: message }, status);
}

/** Parses a JSON body, returning null rather than throwing on malformed input. */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Deliberately permissive: the authoritative check on an address is whether
 * mail to it is delivered, not whether it satisfies a clever regex.
 */
export function isPlausibleEmail(email: string): boolean {
  if (email.length < 3 || email.length > 254) return false;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  return domain.length >= 3 && domain.includes('.') && !domain.includes(' ');
}

export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt-era length caps do not apply to PBKDF2, but bound the work anyway. */
export const MAX_PASSWORD_LENGTH = 512;

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password is required.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return 'Password is too long.';
  }
  return null;
}

/**
 * Escapes text for interpolation into HTML — an email body, a rendered page.
 * Covers the five characters that can break out of an element body or an
 * attribute value. `&` is replaced first so the other entities are not
 * double-escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;')
    .split("'")
    .join('&#39;');
}

export function clientIp(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP');
}

export function userAgent(request: Request): string | null {
  const ua = request.headers.get('User-Agent');
  return ua ? ua.slice(0, 256) : null;
}
