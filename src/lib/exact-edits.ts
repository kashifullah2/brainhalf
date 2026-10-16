export interface ExactEdit {
  search: string;
  replace: string;
}

export function applyExactEdits(source: string, edits: readonly ExactEdit[]): string {
  // Normalise to LF so searches and replacements always match regardless of
  // whether the AI generated CRLF or LF line endings. Restore CRLF at the
  // end when the original source used it.
  const hasCrlf = source.includes('\r\n');
  let updated = source.replace(/\r\n/g, '\n');
  for (const edit of edits) {
    if (!edit.search) throw new Error('Search text cannot be empty');
    const searchNormalized = edit.search.replace(/\r\n/g, '\n');
    const replaceNormalized = edit.replace.replace(/\r\n/g, '\n');
    const offset = updated.indexOf(searchNormalized);
    if (offset < 0) throw new Error('Search text did not match the current file; read it again');
    if (updated.indexOf(searchNormalized, offset + 1) !== -1) throw new Error('Search text is ambiguous; include more surrounding lines');
    updated = updated.slice(0, offset) + replaceNormalized + updated.slice(offset + searchNormalized.length);
  }
  return hasCrlf ? updated.replace(/\n/g, '\r\n') : updated;
}
