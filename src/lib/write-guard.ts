/** Shared write-safety primitives used on every write path (tool and text-protocol). */

/** Include anywhere in file content to bypass the shrinkage guard intentionally. */
export const SHRINK_OK_MARKER = '/* shrink-ok */';

/** Config files blocked from speculative regeneration. */
export const PROTECTED_CONFIG_FILES = new Set(['/package.json', '/tsconfig.json', '/vite.config.ts']);

/**
 * Returns the % shrinkage if a write would reduce a file beyond the 70% threshold.
 * Returns 0 if the write is safe.
 *
 * Always applied to: /worker/index.ts, files >200 lines, files >100 bytes.
 * Never applied to: empty content (handled by finish_reason check separately).
 */
export function checkShrinkage(path: string, content: string, existing: string): number {
  if (!existing || content.length === 0) return 0;
  const isLargeFile = existing.split('\n').length > 200;
  const isProtectedPath = path === '/worker/index.ts' || isLargeFile;
  if (!isProtectedPath && existing.length < 100) return 0;
  if (content.length >= existing.length * 0.7) return 0;
  return Math.round((1 - content.length / existing.length) * 100);
}

/** Detects removal/cleanup intent in the user's prompt. */
export function isShrinkIntentional(userPrompt: string): boolean {
  // No trailing \b so prefixes like "remov" match "remove", "removes", "removing" etc.
  return /\b(remov|delet|strip|clean|simplif|trim|reduc|cut|drop|eliminat|get rid of|rewrite|rebuild|start over|scratch|minimal|slim)/i.test(userPrompt);
}

/**
 * Returns true if this config-file write should be blocked.
 * Unblocked when the prompt or build error context explicitly references the file.
 */
export function isConfigWriteBlocked(path: string, userPrompt: string, buildErrorContext = ''): boolean {
  if (!PROTECTED_CONFIG_FILES.has(path)) return false;
  const lp = userPrompt.toLowerCase();
  const le = buildErrorContext.toLowerCase();
  const basename = path.replace(/^\//, '');
  if (lp.includes(basename) || le.includes(basename)) return false;
  if (/package\.json$/.test(path) && /\b(depend|install|package|npm|version|librar)/i.test(userPrompt)) return false;
  if (/tsconfig/.test(path) && /\b(typescript|tsconfig|type.check|strict|compiler)\b/i.test(userPrompt)) return false;
  if (/vite\.config/.test(path) && /\b(vite|build config|bundl)\b/i.test(userPrompt)) return false;
  return true;
}

/**
 * Estimates the fraction of lines unchanged between `original` and `updated`
 * using a prefix + suffix scan (O(n)). Works well for contiguous edits —
 * the typical case when deciding whether to use edit_file vs write_file.
 *
 * Returns a value in [0, 1]: 1.0 means identical, 0.0 means no shared lines.
 * Used by write_file to enforce the ~40% change threshold.
 */
export function estimateUnchangedFraction(original: string, updated: string): number {
  const oLines = original.split('\n');
  const uLines = updated.split('\n');
  const total = Math.max(oLines.length, uLines.length);
  if (total === 0) return 0;
  let prefix = 0;
  while (prefix < oLines.length && prefix < uLines.length && oLines[prefix] === uLines[prefix]) prefix++;
  const oRem = oLines.length - prefix;
  const uRem = uLines.length - prefix;
  let suffix = 0;
  while (suffix < oRem && suffix < uRem && oLines[oLines.length - 1 - suffix] === uLines[uLines.length - 1 - suffix]) suffix++;
  return (prefix + suffix) / total;
}

export type WritePathTag = 'tool:write_file' | 'tool:edit_file' | 'tool:batch_edit' | 'text-protocol';

export function logWritePath(tag: WritePathTag, path: string, outcome: 'accepted' | 'rejected', reason?: string): void {
  console.log(`[write_guard] ${tag}: ${path} → ${outcome}${reason ? ` (${reason})` : ''}`);
}
