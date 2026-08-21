import { describe, expect, it } from 'vitest';

import { columnLetter, recordsToCsv, recordsToXlsx } from './xlsx-writer';

describe('columnLetter', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [51, 'AZ'],
    [52, 'BA'],
    [701, 'ZZ'],
    [702, 'AAA'],
  ])('maps index %i to %s', (index, expected) => {
    expect(columnLetter(index)).toBe(expected);
  });
});

describe('recordsToCsv', () => {
  it('unions columns across records in first-appearance order', () => {
    const csv = recordsToCsv([
      { Filename: 'a.jpg', Amount: '10' },
      { Filename: 'b.jpg', Fee: 'No Charge' },
    ]);
    expect(csv.split('\r\n')[0]).toBe('Filename,Amount,Fee');
    expect(csv.split('\r\n')[2]).toBe('b.jpg,,No Charge');
  });

  it('quotes values containing commas, quotes, and newlines', () => {
    const csv = recordsToCsv([
      { A: 'x,y', B: 'say "hi"', C: 'line1\nline2' },
    ]);
    const row = csv.split('\r\n')[1];
    expect(row).toContain('"x,y"');
    expect(row).toContain('"say ""hi"""');
    expect(row).toContain('"line1\nline2"');
  });

  it('uses CRLF line endings as RFC 4180 requires', () => {
    expect(recordsToCsv([{ A: '1' }])).toBe('A\r\n1');
  });
});

describe('recordsToXlsx', () => {
  it('produces a ZIP with the xlsx content type', async () => {
    const blob = recordsToXlsx([{ Vendor: 'Acme', Total: '10.5' }], 'Batch Data');
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const bytes = new Uint8Array(await blob.arrayBuffer());
    // "PK\x03\x04" — local file header signature.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('xl/worksheets/sheet1.xml');
    // Headers are written as text, numbers as numeric cells.
    expect(text).toContain('<is><t xml:space="preserve">Vendor</t></is>');
    expect(text).toContain('<v>10.5</v>');
  });

  it('escapes XML-significant characters in values', async () => {
    const blob = recordsToXlsx([{ 'A&B': '<script>"x"' }]);
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('A&amp;B');
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });

  it('keeps leading zeros as text so IDs are not mangled', async () => {
    const blob = recordsToXlsx([{ Mobile: '03151929161' }]);
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('<t xml:space="preserve">03151929161</t>');
    expect(text).not.toContain('<v>03151929161</v>');
  });

  it('keeps numbers beyond 15 significant digits as text', async () => {
    const blob = recordsToXlsx([{ Ref: '1234567890123456789' }]);
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('<t xml:space="preserve">1234567890123456789</t>');
  });

  it('still stores real amounts as numbers', async () => {
    const blob = recordsToXlsx([{ Total: '10.5', Qty: '3', Neg: '-4.25', Frac: '0.5' }]);
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('<v>10.5</v>');
    expect(text).toContain('<v>3</v>');
    expect(text).toContain('<v>-4.25</v>');
    expect(text).toContain('<v>0.5</v>');
  });

  it('sanitises an invalid sheet name', async () => {
    const blob = recordsToXlsx([{ A: '1' }], 'bad/name:with*chars');
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toContain('bad_name_with_chars');
  });
});
