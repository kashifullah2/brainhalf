// ---------------------------------------------------------------------------
// What this pipeline can actually carry, in one place.
//
// There used to be one number, 25 MB, checked in three places and advertised in
// four. It was wrong for PDFs, and wrong in the worst way: the file uploaded
// successfully, the green tick appeared, and extraction then failed every single
// time with a message about the OCR service.
//
// The arithmetic behind the two limits:
//
//   Images are decoded, downscaled to 1500px and re-encoded as 60% JPEG before
//   they are sent to the model (see fileToBase64 in src/lib/ocr-client.ts), so a
//   25 MB photo reaches /api/ocr as a few hundred kilobytes. The 25 MB cap on
//   them is about upload bandwidth and R2, nothing else.
//
//   PDFs are passed through byte for byte, base64-encoded into a JSON body.
//   base64 costs 4 bytes for every 3, so a PDF arrives at /api/ocr as 1.34x its
//   own size, plus the prompt and the JSON envelope. MAX_BODY_BYTES there is
//   20 MB (functions/api/ocr.ts), which the runtime cannot simply be raised past
//   -- decoding a 34 MB body into a JS string and then JSON.parsing it is two
//   more copies again, against a 128 MB isolate.
//
//     14 MB x 1.34 = 18.8 MB, leaving ~1.2 MB of headroom for the prompt.
//
// Keep MAX_PDF_BYTES consistent with MAX_BODY_BYTES in functions/api/ocr.ts and
// with the per-type caps in functions/api/storage/upload.ts. If you change one,
// change all three in the same commit.
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_PDF_BYTES = 14 * 1024 * 1024;

export const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** The `accept` attribute for a file input, kept next to the type set it mirrors. */
export const ACCEPT_ATTRIBUTE = '.jpg,.jpeg,.png,.webp,.pdf';

export function maxBytesFor(contentType: string): number {
  return contentType === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/** Human-readable summary of the caps, for dropzone copy and error messages. */
export const LIMIT_SUMMARY = `PDF up to ${megabytes(MAX_PDF_BYTES)}, images up to ${megabytes(
  MAX_IMAGE_BYTES,
)}`;

/**
 * Why this file cannot be processed, or null when it can.
 *
 * Checked before the upload starts rather than after it finishes: a file that
 * extraction cannot read should never consume the user's bandwidth, an R2 object
 * and a database row first.
 */
export function rejectionReason(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return `Invalid file type (${file.type || 'unknown'}). Use JPG, PNG, WEBP, or PDF.`;
  }
  if (file.size === 0) return 'This file is empty.';

  const limit = maxBytesFor(file.type);
  if (file.size > limit) {
    return file.type === 'application/pdf'
      ? `Too large. PDFs are limited to ${megabytes(limit)} because the page is sent to the model whole.`
      : `Too large. Images are limited to ${megabytes(limit)}.`;
  }
  return null;
}
