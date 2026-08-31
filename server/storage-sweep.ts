// ---------------------------------------------------------------------------
// Collecting uploaded files that no document ever claimed.
//
// See migrations/0006_pending_uploads.sql for why they exist at all.
//
// There is no scheduled job to put this in: wrangler.toml here is a Pages config
// (it declares pages_build_output_dir), and a Pages project has no cron handler to
// register. So this follows the pattern already used by the session and rate-limit
// prunes -- probabilistic, bounded by LIMIT, hung off a request via waitUntil, and
// never allowed to fail one.
//
// This deletes data, so it is deliberately conservative:
//
//   * a long grace period, because the window between storing bytes and creating
//     the row that references them is normally seconds;
//   * a NOT EXISTS check against `documents` as well as the pending row, so an
//     object is only removed when BOTH records agree nothing points at it;
//   * R2 first, then the row -- if the second step fails the next sweep retries,
//     and deleting an absent key is harmless. The other order leaks the object
//     permanently.
// ---------------------------------------------------------------------------

import type { AppEnv } from './http';

/**
 * How long an upload may sit unclaimed before it is considered abandoned.
 *
 * Hours rather than minutes: a user can legitimately upload files, leave the
 * browser open on the preset step, and come back after lunch to start the batch.
 * Deleting their files underneath them would be far worse than paying for a day
 * of storage.
 */
const GRACE_HOURS = 24;

/** Roughly one call in every SWEEP_EVERY also sweeps. */
const SWEEP_EVERY = 25;

/** Objects removed per sweep. Bounds what any single request pays for. */
const SWEEP_BATCH = 50;

interface PendingRow {
  object_path: string;
}

/**
 * Deletes up to SWEEP_BATCH abandoned objects. Returns how many it removed, which
 * is used by the tests -- callers should ignore it and never await it on the
 * response path.
 */
export async function sweepAbandonedUploads(env: AppEnv): Promise<number> {
  if (!env.DB || !env.DOCUMENTS) return 0;

  let rows: PendingRow[] = [];
  try {
    const result = await env.DB.prepare(
      `SELECT p.object_path AS object_path
         FROM pending_uploads p
        WHERE p.created_at < datetime('now', ?)
          AND NOT EXISTS (
                SELECT 1 FROM documents d WHERE d.object_path = p.object_path
              )
        LIMIT ?`,
    )
      .bind(`-${GRACE_HOURS} hours`, SWEEP_BATCH)
      .all<PendingRow>();
    rows = result.results ?? [];
  } catch (error) {
    console.error('[storage-sweep] could not list abandoned uploads:', error);
    return 0;
  }

  if (rows.length === 0) return 0;

  const keys = rows.map((row) => row.object_path).filter(Boolean);
  if (keys.length === 0) return 0;

  try {
    // Bytes first. A failure here leaves the row in place, so the next sweep tries
    // again rather than losing track of the object.
    await env.DOCUMENTS.delete(keys);
  } catch (error) {
    console.error('[storage-sweep] R2 delete failed; rows kept for the next sweep:', error);
    return 0;
  }

  try {
    const placeholders = keys.map(() => '?').join(', ');
    await env.DB.prepare(
      `DELETE FROM pending_uploads WHERE object_path IN (${placeholders})`,
    )
      .bind(...keys)
      .run();
  } catch (error) {
    // The objects are gone; the rows will be retried and the delete is idempotent.
    console.error('[storage-sweep] could not clear swept rows:', error);
  }

  console.log(`[storage-sweep] removed ${keys.length} abandoned upload(s).`);
  return keys.length;
}

/** Sweeps roughly one call in every SWEEP_EVERY. Never throws. */
export async function maybeSweepAbandonedUploads(env: AppEnv): Promise<void> {
  if (Math.floor(Math.random() * SWEEP_EVERY) !== 0) return;
  try {
    await sweepAbandonedUploads(env);
  } catch (error) {
    console.error('[storage-sweep] sweep failed:', error);
  }
}
