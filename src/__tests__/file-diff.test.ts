import { describe, expect, it } from 'vitest';
import { computeLineDiff, countLineChanges, diffFileMaps } from '../lib/file-diff';

describe('countLineChanges', () => {
  it('returns zeroes for identical content', () => {
    expect(countLineChanges('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0 });
  });

  it('counts a single inserted line', () => {
    expect(countLineChanges('a\nc', 'a\nb\nc')).toEqual({ added: 1, removed: 0 });
  });

  it('counts a single deleted line', () => {
    expect(countLineChanges('a\nb\nc', 'a\nc')).toEqual({ added: 0, removed: 1 });
  });

  it('counts a replaced line as one add and one remove', () => {
    expect(countLineChanges('a\nb\nc', 'a\nx\nc')).toEqual({ added: 1, removed: 1 });
  });

  it('handles empty before (new file body)', () => {
    expect(countLineChanges('', 'a\nb')).toEqual({ added: 2, removed: 0 });
  });

  it('handles empty after (emptied file)', () => {
    expect(countLineChanges('a\nb', '')).toEqual({ added: 0, removed: 2 });
  });

  it('trims long common prefixes and suffixes', () => {
    const head = Array.from({ length: 500 }, (_, index) => `head-${index}`).join('\n');
    const tail = Array.from({ length: 500 }, (_, index) => `tail-${index}`).join('\n');
    expect(countLineChanges(`${head}\nold\n${tail}`, `${head}\nnew\n${tail}`)).toEqual({ added: 1, removed: 1 });
  });

  it('approximates whole-range replacement for pathological inputs', () => {
    const before = Array.from({ length: 2000 }, (_, index) => `b-${index}`).join('\n');
    const after = Array.from({ length: 2000 }, (_, index) => `a-${index}`).join('\n');
    const { added, removed } = countLineChanges(before, after);
    expect(added).toBeGreaterThan(0);
    expect(removed).toBeGreaterThan(0);
  });
});

describe('computeLineDiff', () => {
  it('returns an empty diff for identical content', () => {
    expect(computeLineDiff('a\nb', 'a\nb')).toEqual([]);
  });

  it('marks added, removed and unchanged lines', () => {
    const diff = computeLineDiff('a\nb\nc', 'a\nx\nc');
    expect(diff).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'x' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('keeps a pure insertion between unchanged lines', () => {
    const diff = computeLineDiff('a\nc', 'a\nb\nc');
    expect(diff).toEqual([
      { type: 'same', text: 'a' },
      { type: 'added', text: 'b' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('returns null when the changed middle exceeds the cell budget', () => {
    const before = Array.from({ length: 2000 }, (_, index) => `b-${index}`).join('\n');
    const after = Array.from({ length: 2000 }, (_, index) => `a-${index}`).join('\n');
    expect(computeLineDiff(before, after)).toBeNull();
  });
});

describe('diffFileMaps', () => {
  it('returns an empty list when nothing changed', () => {
    expect(diffFileMaps({ 'a.ts': 'x' }, { 'a.ts': 'x' })).toEqual([]);
  });

  it('reports added, modified and deleted files sorted by path', () => {
    const changes = diffFileMaps(
      { 'keep.ts': 'same', 'mod.ts': 'old', 'gone.ts': 'bye' },
      { 'keep.ts': 'same', 'mod.ts': 'new', 'new.ts': 'hello' },
    );
    expect(changes).toEqual([
      { path: 'gone.ts', kind: 'deleted', added: 0, removed: 1 },
      { path: 'mod.ts', kind: 'modified', added: 1, removed: 1 },
      { path: 'new.ts', kind: 'added', added: 1, removed: 0 },
    ]);
  });

  it('treats an empty-string file as present, not missing', () => {
    expect(diffFileMaps({ 'a.ts': '' }, { 'a.ts': 'x' })).toEqual([
      { path: 'a.ts', kind: 'modified', added: 1, removed: 0 },
    ]);
  });
});
