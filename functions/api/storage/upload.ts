import { fail, json, type AppEnv } from '../../../server/http';
import { authHeaders, requireSession } from '../../../server/guard';
import { randomToken } from '../../../server/crypto';
import {
  RULES,
  enforceRateLimit,
  userIdentity,
} from '../../../server/rate-limit';
import { maybeSweepAbandonedUploads } from '../../../server/storage-sweep';

// ---------------------------------------------------------------------------
// Size caps, per content type.
//
// One flat 25 MB cap here was wrong for PDFs. They are passed to the model byte
// for byte inside a base64 JSON body, which costs 1.34x, and MAX_BODY_BYTES in
// functions/api/ocr.ts is 20 MB -- so every PDF over about 15 MB uploaded
// successfully, showed a green tick, and then failed extraction every single
// time. Rejecting it here means the user is told before spending the bandwidth.
//
// Images are downscaled and re-encoded in the browser before extraction, so
// their cap is only about upload size.
//
// Keep in step with src/lib/upload-limits.ts and MAX_BODY_BYTES in
// functions/api/ocr.ts.
// ---------------------------------------------------------------------------
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PDF_BYTES = 14 * 1024 * 1024;
/** The largest anything may be, used for the cheap content-length pre-check. */
const MAX_UPLOAD_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_PDF_BYTES);

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function maxBytesFor(contentType: string): number {
  return contentType === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
}

function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

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
export const onRequestPost: PagesFunction<AppEnv> = async ({
  request,
  env,
  waitUntil,
}) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  // Uploads are where orphaned objects come from, so this is where the collection
  // of them is paid for. waitUntil keeps it off the response path.
  waitUntil(maybeSweepAbandonedUploads(env));

  const limited = await enforceRateLimit(
    env,
    'storage/upload',
    userIdentity(auth.user.id),
    RULES.upload,
  );
  if (limited) return limited;

  // content-length is a claim, not a fact, and the type is not known yet -- so
  // this is only the outer bound. The real per-type check is below, against the
  // size the file actually turned out to be.
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return fail(
      `File is too large. The limit is ${megabytes(MAX_UPLOAD_BYTES)} MB.`,
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

  // Type first: the size cap depends on it.
  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(contentType)) {
    return fail(
      `Unsupported file type (${contentType}). Use JPG, PNG, WEBP, or PDF.`,
      415,
    );
  }

  const maxBytes = maxBytesFor(contentType);
  if (file.size > maxBytes) {
    return fail(
      contentType === 'application/pdf'
        ? `That PDF is too large. PDFs are limited to ${megabytes(maxBytes)} MB, because the whole file is sent to the model.`
        : `That image is too large. The limit is ${megabytes(maxBytes)} MB.`,
      413,
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

  // Record the key so it can be found again.
  //
  // Until now the HTTP response below was the ONLY record of it: the row that
  // references the object is created later, when the batch is, so a tab closed in
  // between left an object in the bucket that nothing pointed at, nothing could
  // look for, and we paid for indefinitely. server/storage-sweep.ts collects
  // whatever is still unclaimed after the grace period.
  try {
    await env.DB.prepare(
      `INSERT INTO pending_uploads (object_path, user_id) VALUES (?, ?)
       ON CONFLICT (object_path) DO NOTHING`,
    )
      .bind(objectPath, auth.user.id)
      .run();
  } catch (error) {
    // The file is stored and usable; failing the upload over the bookkeeping row
    // would be the wrong trade. Worst case the object is not swept.
    console.error('[api/storage/upload] could not record the pending upload:', error);
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
