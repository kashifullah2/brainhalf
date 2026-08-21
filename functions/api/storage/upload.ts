import { fail, json, type AppEnv } from '../../../server/http';
import { authHeaders, requireSession } from '../../../server/guard';
import { randomToken } from '../../../server/crypto';
import {
  RULES,
  enforceRateLimit,
  userIdentity,
} from '../../../server/rate-limit';

/** Matches the cap advertised in the upload UI. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** Strips anything that could escape the intended key prefix. */
function safeFilename(name: string): string {
  const base = name.split('/').join('_').split('\\').join('_').trim();
  const cleaned = base
    .split('')
    .map((char) => (/[A-Za-z0-9._-]/.test(char) ? char : '_'))
    .join('');
  return cleaned.slice(-120) || 'document';
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Stores an uploaded document in R2 and returns its key. The key is always
 * prefixed with the owner's user id, which is what makes the read endpoint's
 * ownership check possible.
 */
export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const limited = await enforceRateLimit(
    env,
    'storage/upload',
    userIdentity(auth.user.id),
    RULES.upload,
  );
  if (limited) return limited;

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_FILE_BYTES) {
    return fail(
      `File is too large. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      413,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('Expected a multipart form upload.', 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return fail('No file was included in the upload.', 400);
  }

  if (file.size === 0) {
    return fail('That file is empty.', 400);
  }
  if (file.size > MAX_FILE_BYTES) {
    return fail(
      `File is too large. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
      413,
    );
  }

  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(contentType)) {
    return fail(
      `Unsupported file type (${contentType}). Use JPG, PNG, WEBP, or PDF.`,
      415,
    );
  }

  const bytes = await file.arrayBuffer();
  const contentHash = await sha256Hex(bytes);

  const objectPath = `${auth.user.id}/${randomToken(12)}-${safeFilename(file.name)}`;

  try {
    await env.DOCUMENTS.put(objectPath, bytes, {
      httpMetadata: { contentType },
      customMetadata: { userId: auth.user.id, originalName: file.name.slice(0, 255) },
    });
  } catch (error) {
    console.error('[api/storage/upload] R2 put failed:', error);
    return fail('Could not store the file.', 500);
  }

  return json(
    {
      objectPath,
      sizeBytes: file.size,
      contentType,
      contentHash,
    },
    201,
    authHeaders(auth),
  );
};
