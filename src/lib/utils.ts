import { extendTailwindMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['micro', 'caption', 'label', 'body-sm', 'body', 'body-lg', 'body-xl', 'title-sm', 'title', 'display'] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}

/**
 * Neutralises spreadsheet formula injection in exported values.
 *
 * A cell whose first character is one of `= + - @` is evaluated as a formula by
 * Excel, Sheets and LibreOffice, so an extracted value -- or a filename -- of
 * `=HYPERLINK("http://evil","click")` becomes a live link in whoever opens the
 * export. Prefixing an apostrophe forces the cell to text.
 *
 * TAB and CR are guarded as well: spreadsheets strip leading control characters
 * before deciding whether a cell is a formula, so `\t=1+1` is evaluated exactly
 * like `=1+1` while sailing past a check that only looks at index 0.
 */
const FORMULA_LEAD = /^[\t\r\n ]*[=+\-@]/;

export function sanitizeForExport(value: unknown): string {
  const str = String(value ?? "");
  return FORMULA_LEAD.test(str) ? `'${str}` : str;
}
