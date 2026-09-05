// ---------------------------------------------------------------------------
// AWS Signature Version 4, over WebCrypto.
//
// Replaces @aws-sdk/client-textract and @aws-sdk/client-bedrock-runtime, which
// this project imported but never installed -- so both the Pages Functions build
// and the queue worker build failed to resolve them. Even installed they were the
// wrong shape for this runtime: the v3 clients pull in Node built-ins (stream,
// http, buffer) and therefore need `nodejs_compat`, which neither wrangler.toml
// declares, and together they are megabytes against a Worker bundle limit.
//
// Both services we use are a single JSON POST. Signing one by hand is ~120 lines
// and costs nothing at runtime, so that is what this does.
//
// Reference: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv4-signing-process.html
// ---------------------------------------------------------------------------

const ALGORITHM = 'AWS4-HMAC-SHA256';
const TERMINATOR = 'aws4_request';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present when the caller authenticated with STS rather than a long-lived key. */
  sessionToken?: string;
}

export interface SignedRequestInput {
  method: string;
  /** Host only, e.g. `textract.us-east-1.amazonaws.com`. */
  host: string;
  /**
   * Path as it will appear on the wire, already percent-encoded where a segment
   * contains a reserved character. Canonicalisation escapes it a second time,
   * which is what SigV4 requires for every service except S3.
   */
  path: string;
  region: string;
  service: string;
  body: string;
  headers?: Record<string, string>;
  credentials: AwsCredentials;
  /** Injectable so the signing steps can be tested against AWS's own vectors. */
  now?: Date;
}

function hex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const byte of view) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return hex(digest);
}

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const raw = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

/**
 * RFC 3986 unreserved set, which is narrower than what encodeURIComponent
 * leaves alone: `!`, `'`, `(`, `)` and `*` must be escaped for SigV4.
 */
function escapeUriComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Canonical URI. Every segment of an already-encoded path is escaped again,
 * which is the documented rule for all services other than S3: the wire path
 * carries `%3A` and the string that gets signed carries `%253A`.
 */
export function canonicalUri(path: string): string {
  if (!path || path === '/') return '/';
  return path
    .split('/')
    .map((segment) => (segment ? escapeUriComponent(segment) : ''))
    .join('/');
}

function amzDate(now: Date): { stamp: string; date: string } {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

/**
 * Returns the headers to send, including `Authorization`. The caller does the
 * fetch, so this stays testable without a network.
 */
export async function signAwsRequest(
  input: SignedRequestInput,
): Promise<Record<string, string>> {
  const { stamp, date } = amzDate(input.now ?? new Date());
  const payloadHash = await sha256(input.body);

  // Host and x-amz-date are the two AWS always requires to be signed. No
  // x-amz-content-sha256: that header belongs to S3, and adding it would put a
  // value in the signature that AWS's own published test vectors do not have --
  // which is what the vector test in aws-sigv4.test.ts checks this against.
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: input.host,
    'x-amz-date': stamp,
  };
  if (input.credentials.sessionToken) {
    headers['x-amz-security-token'] = input.credentials.sessionToken;
  }

  const canonicalHeaderNames = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lowercased = new Map(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      value.trim().replace(/\s+/g, ' '),
    ]),
  );

  const canonicalHeaders = canonicalHeaderNames
    .map((name) => `${name}:${lowercased.get(name)}\n`)
    .join('');
  const signedHeaders = canonicalHeaderNames.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.path),
    // No query string on either endpoint we call.
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${input.region}/${input.service}/${TERMINATOR}`;
  const stringToSign = [
    ALGORITHM,
    stamp,
    scope,
    await sha256(canonicalRequest),
  ].join('\n');

  // Signing key: one HMAC per scope component, so the derived key is only ever
  // valid for this date, region and service.
  const kDate = await hmac(
    new TextEncoder().encode(`AWS4${input.credentials.secretAccessKey}`),
    date,
  );
  const kRegion = await hmac(kDate, input.region);
  const kService = await hmac(kRegion, input.service);
  const kSigning = await hmac(kService, TERMINATOR);
  const signature = hex(await hmac(kSigning, stringToSign));

  return {
    ...headers,
    Authorization:
      `${ALGORITHM} Credential=${input.credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** For tests and for callers that want to inspect what was signed. */
export async function canonicalRequestFor(input: SignedRequestInput): Promise<string> {
  const { stamp } = amzDate(input.now ?? new Date());
  const payloadHash = await sha256(input.body);
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: input.host,
    'x-amz-date': stamp,
  };
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const values = new Map(
    Object.entries(headers).map(([n, v]) => [n.toLowerCase(), v.trim().replace(/\s+/g, ' ')]),
  );
  return [
    input.method.toUpperCase(),
    canonicalUri(input.path),
    '',
    names.map((n) => `${n}:${values.get(n)}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
}
