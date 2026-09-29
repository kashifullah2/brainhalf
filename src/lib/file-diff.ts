/**
 * Line-level diffing for the "what changed" summary shown after each
 * generation. Files are compared line by line; common prefixes/suffixes are
 * trimmed first so the O(n*m) LCS only ever runs on the changed middle, and
 * pathological inputs fall back to a whole-range replace instead of blowing
 * the memory budget.
 */

export type FileChangeKind = 'added' | 'modified' | 'deleted';

export interface FileChange {
  path: string;
  kind: FileChangeKind;
  /** Lines present after the change but not before. */
  added: number;
  /** Lines present before the change but not after. */
  removed: number;
}

export type DiffLineType = 'same' | 'added' | 'removed';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/** DP cell budget for one file's changed middle; beyond this we approximate. */
const MAX_LCS_CELLS = 1_000_000;

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.split('\n');
}

/** Trims equal leading/trailing lines so the expensive DP runs on a small middle. */
function trimCommon(before: string[], after: string[]): {
  prefix: number;
  beforeMiddle: string[];
  afterMiddle: string[];
} {
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;

  return {
    prefix,
    beforeMiddle: before.slice(prefix, before.length - suffix),
    afterMiddle: after.slice(prefix, after.length - suffix),
  };
}

/** Length of the longest common subsequence of the two middles. */
function lcsLength(beforeMiddle: string[], afterMiddle: string[]): number {
  const rows = beforeMiddle.length;
  const cols = afterMiddle.length;
  if (rows === 0 || cols === 0) return 0;
  let previous = new Uint32Array(cols + 1);
  let current = new Uint32Array(cols + 1);
  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      current[col] = beforeMiddle[row - 1] === afterMiddle[col - 1]
        ? previous[col - 1] + 1
        : Math.max(previous[col], current[col - 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[cols];
}

export function countLineChanges(before: string, after: string): { added: number; removed: number } {
  if (before === after) return { added: 0, removed: 0 };
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const { beforeMiddle, afterMiddle } = trimCommon(beforeLines, afterLines);
  if (beforeMiddle.length * afterMiddle.length > MAX_LCS_CELLS) {
    // Too large to align precisely — report the changed range as replaced.
    return { added: afterMiddle.length, removed: beforeMiddle.length };
  }
  const common = lcsLength(beforeMiddle, afterMiddle);
  return { added: afterMiddle.length - common, removed: beforeMiddle.length - common };
}

/**
 * Full unified line diff of the two versions, or null when the changed range
 * is too large to align (callers should show a summary instead of the diff).
 */
export function computeLineDiff(before: string, after: string): DiffLine[] | null {
  if (before === after) return [];
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const { prefix, beforeMiddle, afterMiddle } = trimCommon(beforeLines, afterLines);
  if (beforeMiddle.length * afterMiddle.length > MAX_LCS_CELLS) return null;

  const rows = beforeMiddle.length;
  const cols = afterMiddle.length;
  // Full DP table only here (needed for backtracking); counts use lcsLength.
  const table: Uint32Array[] = new Array(rows + 1);
  table[rows] = new Uint32Array(cols + 1);
  for (let row = rows - 1; row >= 0; row -= 1) {
    table[row] = new Uint32Array(cols + 1);
    for (let col = cols - 1; col >= 0; col -= 1) {
      table[row][col] = beforeMiddle[row] === afterMiddle[col]
        ? table[row + 1][col + 1] + 1
        : Math.max(table[row + 1][col], table[row][col + 1]);
    }
  }

  const middle: DiffLine[] = [];
  let row = 0;
  let col = 0;
  while (row < rows && col < cols) {
    if (beforeMiddle[row] === afterMiddle[col]) {
      middle.push({ type: 'same', text: beforeMiddle[row] });
      row += 1;
      col += 1;
    } else if (table[row + 1][col] >= table[row][col + 1]) {
      middle.push({ type: 'removed', text: beforeMiddle[row] });
      row += 1;
    } else {
      middle.push({ type: 'added', text: afterMiddle[col] });
      col += 1;
    }
  }
  while (row < rows) { middle.push({ type: 'removed', text: beforeMiddle[row] }); row += 1; }
  while (col < cols) { middle.push({ type: 'added', text: afterMiddle[col] }); col += 1; }

  const lines: DiffLine[] = [];
  for (let index = 0; index < prefix; index += 1) lines.push({ type: 'same', text: beforeLines[index] });
  lines.push(...middle);
  const suffixCount = beforeLines.length - prefix - rows;
  for (let index = beforeLines.length - suffixCount; index < beforeLines.length; index += 1) {
    lines.push({ type: 'same', text: beforeLines[index] });
  }
  return lines;
}

/**
 * Compares two project file maps and lists every path that was added,
 * modified, or deleted, with per-file line counts. Sorted by path.
 */
export function diffFileMaps(
  before: Record<string, string>,
  after: Record<string, string>,
): FileChange[] {
  const changes: FileChange[] = [];
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const path of paths) {
    const hadBefore = Object.prototype.hasOwnProperty.call(before, path);
    const hasAfter = Object.prototype.hasOwnProperty.call(after, path);
    const beforeContent = hadBefore ? before[path] : '';
    const afterContent = hasAfter ? after[path] : '';
    if (hadBefore && hasAfter && beforeContent === afterContent) continue;
    if (!hadBefore) {
      changes.push({ path, kind: 'added', added: splitLines(afterContent).length, removed: 0 });
    } else if (!hasAfter) {
      changes.push({ path, kind: 'deleted', added: 0, removed: splitLines(beforeContent).length });
    } else {
      const { added, removed } = countLineChanges(beforeContent, afterContent);
      changes.push({ path, kind: 'modified', added, removed });
    }
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}
