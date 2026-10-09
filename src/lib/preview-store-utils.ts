/** Adds X-BH-Preview-Capped to a Response when the preview store is capped. Returns the original response unchanged when not capped. */
export function applyPreviewCappedHeader(response: Response, capped: boolean): Response {
  if (!capped) return response;
  const headers = new Headers(response.headers);
  headers.set('X-BH-Preview-Capped', 'true');
  return new Response(response.body, { status: response.status, headers });
}

export type PreviewCapReason = 'rows' | 'bytes';

/**
 * Evaluates which cap (if any) is exceeded by the current store tables.
 * Returns 'rows' if total row count exceeds maxRows, 'bytes' if any single
 * table's JSON blob exceeds maxTableBytes, or null if within both caps.
 */
export function evaluateStoreCaps(
  tables: ReadonlyArray<{ rows: unknown[] }>,
  maxRows: number,
  maxTableBytes: number,
): PreviewCapReason | null {
  const totalRows = tables.reduce((sum, t) => sum + t.rows.length, 0);
  if (totalRows > maxRows) return 'rows';
  for (const { rows } of tables) {
    if (JSON.stringify(rows).length > maxTableBytes) return 'bytes';
  }
  return null;
}

/**
 * Returns table names that exist in hydratedTableNames but are no longer in
 * inMemoryNames — these are the DB rows that should be deleted (orphan sweep).
 */
export function orphanedTableNames(
  hydrated: ReadonlySet<string>,
  inMemory: ReadonlySet<string>,
): Set<string> {
  const orphaned = new Set<string>();
  for (const name of hydrated) {
    if (!inMemory.has(name)) orphaned.add(name);
  }
  return orphaned;
}

/**
 * Returns the updated hydratedTableNames set after a successful persist:
 *   - removes names that were swept from the DB (in hydrated but not in inMemory)
 *   - adds names that were written to the DB (in inMemory but not byte-capped)
 */
export function computeNextHydratedNames(
  hydrated: ReadonlySet<string>,
  inMemory: ReadonlySet<string>,
  byteCapped: ReadonlySet<string>,
): Set<string> {
  const next = new Set(hydrated);
  for (const name of hydrated) {
    if (!inMemory.has(name)) next.delete(name);
  }
  for (const name of inMemory) {
    if (!byteCapped.has(name)) next.add(name);
  }
  return next;
}
