export interface ExactEdit {
  search: string;
  replace: string;
}

export function applyExactEdits(source: string, edits: readonly ExactEdit[]): string {
  let updated = source;
  for (const edit of edits) {
    if (!edit.search) throw new Error('Search text cannot be empty');
    const offset = updated.indexOf(edit.search);
    if (offset < 0) throw new Error('Search text did not match the current file; read it again');
    if (updated.indexOf(edit.search, offset + 1) !== -1) throw new Error('Search text is ambiguous; include more surrounding lines');
    updated = updated.slice(0, offset) + edit.replace + updated.slice(offset + edit.search.length);
  }
  return updated;
}
