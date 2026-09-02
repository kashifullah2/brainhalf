// ---------------------------------------------------------------------------
// Whether a batch is actually being worked on.
//
// Historically, extraction ran in the browser tab that started it, so closing
// the tab left the batch abandoned. Now we have a background queue worker.
// A batch with status 'queued' is waiting in the Cloudflare Queue and can
// legitimately sit idle for long periods. A batch with status 'processing'
// that hasn't been updated in a while is considered stalled.
//
// Deliberately dependency-free and separate from api-client.ts: this is a pure
// predicate, and pulling the whole API client (and localforage, and the OCR
// pipeline behind it) in to test three comparisons is not a good trade.
// ---------------------------------------------------------------------------

/**
 * Generous on purpose. A single document can spend 60s upstream (the proxy's
 * timeout) and then spend it again on an escalation re-read, so a live batch can
 * legitimately go a couple of minutes between updates. Calling that abandoned
 * would be worse than polling for too long.
 */
export const BATCH_STALL_AFTER_MS = 5 * 60_000;

export function isBatchInFlight(batch: { status: string }): boolean {
  return batch.status === 'processing' || batch.status === 'queued';
}

/**
 * True when a batch claims to be running but nothing has touched it in a while.
 *
 * Returns false for an unparseable timestamp. Guessing would put a "resume"
 * banner over a batch that is running perfectly well.
 */
export function isBatchStalled(batch: { status: string; updatedAt: string }): boolean {
  if (!isBatchInFlight(batch)) return false;
  
  // A queued batch is in the background queue and can legitimately wait indefinitely
  if (batch.status === 'queued') return false;

  const updatedAt = Date.parse(batch.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt > BATCH_STALL_AFTER_MS;
}
