import { describe, expect, it } from 'vitest';

import { sanitizeForExport } from './utils';

// There was no test for this at all, on the one function in the codebase whose
// entire job is to stop a spreadsheet from executing extracted document content.
describe('sanitizeForExport', () => {
  it('leaves ordinary values alone', () => {
    expect(sanitizeForExport('Acme Supplies Ltd')).toBe('Acme Supplies Ltd');
    expect(sanitizeForExport('1,240.50')).toBe('1,240.50');
    expect(sanitizeForExport('INV-2026-0031')).toBe('INV-2026-0031');
  });

  it('neutralises every character a spreadsheet treats as a formula', () => {
    for (const lead of ['=', '+', '-', '@']) {
      expect(sanitizeForExport(`${lead}1+1`)).toBe(`'${lead}1+1`);
    }
  });

  it('neutralises a formula hidden behind leading whitespace', () => {
    // Spreadsheets strip these before deciding whether the cell is a formula, so
    // a check anchored strictly at index 0 lets them through.
    expect(sanitizeForExport('\t=1+1')).toBe("'\t=1+1");
    expect(sanitizeForExport('\r=1+1')).toBe("'\r=1+1");
    expect(sanitizeForExport(' =1+1')).toBe("' =1+1");
  });

  it('neutralises the payloads that actually get used', () => {
    expect(sanitizeForExport('=HYPERLINK("http://evil","click")')).toBe(
      '\'=HYPERLINK("http://evil","click")',
    );
    expect(sanitizeForExport('=cmd|\' /c calc\'!A0')).toBe("'=cmd|' /c calc'!A0");
  });

  it('coerces non-strings without throwing', () => {
    expect(sanitizeForExport(null)).toBe('');
    expect(sanitizeForExport(undefined)).toBe('');
    expect(sanitizeForExport(0)).toBe('0');
    expect(sanitizeForExport(-5)).toBe("'-5");
  });
});
