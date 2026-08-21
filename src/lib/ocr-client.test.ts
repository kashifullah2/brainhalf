import { describe, expect, it } from 'vitest';

import { parseOCRResult } from './ocr-client';

function valueOf(
  result: ReturnType<typeof parseOCRResult>,
  field: string,
): string | undefined {
  return result.fields.find((f) => f.normalizedField === field)?.value;
}

describe('parseOCRResult — nested structures', () => {
  it('flattens a nested object into separate fields instead of dumping JSON', () => {
    // Shape taken from a real easypaisa receipt extraction, which used to render
    // as a single cell reading {"Date":"09 February...
    const content = JSON.stringify({
      Transaction: { Date: '09 February 2024', Time: '9:00 PM', ID: '26319831836' },
      'Funding Source': 'easypaisa Mobile Account',
    });

    const result = parseOCRResult(content, 'keyvalue');
    const names = result.fields.map((f) => f.normalizedField);

    expect(names).toContain('Transaction Date');
    expect(names).toContain('Transaction Time');
    expect(names).toContain('Transaction ID');
    expect(valueOf(result, 'Transaction Date')).toBe('09 February 2024');
    // No field value should still be raw JSON.
    expect(result.fields.every((f) => !f.value.trimStart().startsWith('{'))).toBe(true);
  });

  it('joins an array of scalars into one readable value', () => {
    const content = JSON.stringify({ 'Sent to': ['HUSNAIN ALI', '03151929161'] });
    const result = parseOCRResult(content, 'keyvalue');
    expect(valueOf(result, 'Sent to')).toBe('HUSNAIN ALI, 03151929161');
  });

  it('numbers the entries of an array of objects', () => {
    const content = JSON.stringify({
      'Line Items': [
        { Description: 'Widget', Amount: '10.00' },
        { Description: 'Gadget', Amount: '20.00' },
      ],
    });
    const result = parseOCRResult(content, 'keyvalue');
    const names = result.fields.map((f) => f.normalizedField);
    expect(names).toContain('Line Items 1 Description');
    expect(names).toContain('Line Items 2 Amount');
    expect(valueOf(result, 'Line Items 2 Amount')).toBe('20.00');
  });

  it('flattens table rows and unions columns across every row', () => {
    // The old code took columns from the first row only, so a field that first
    // appeared in row 2 was dropped from the table entirely.
    const content = JSON.stringify([
      { Amount: '10,000.00' },
      { Amount: '250.00', 'Fee / Charge': 'No Charge' },
    ]);

    const result = parseOCRResult(content, 'table');
    const names = result.fields.map((f) => f.normalizedField);

    expect(names).toEqual(['Amount', 'Fee / Charge']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]['Fee / Charge']).toBe('No Charge');
  });
});

describe('parseOCRResult — model metadata', () => {
  it('does not expose a "confidence" key as an extracted field', () => {
    // This produced a user-visible CONFIDENCE column holding "0.9", which then
    // got a confidence bar of its own.
    const content = JSON.stringify({ text: 'easypaisa', confidence: 0.9 });
    const result = parseOCRResult(content, 'keyvalue');
    const names = result.fields.map((f) => f.normalizedField);

    expect(names).toContain('text');
    expect(names).not.toContain('confidence');
  });

  it('uses the reported confidence as the score rather than displaying it', () => {
    const content = JSON.stringify({ Vendor: 'Acme', _overall_confidence: 0.4 });
    const result = parseOCRResult(content, 'invoice');
    const names = result.fields.map((f) => f.normalizedField);

    expect(names).toEqual(['Vendor']);
    // 0.4 model certainty must drag the blended score below the 0.8 threshold.
    expect(result.fields[0].confidence).toBeLessThan(0.8);
  });

  it('keeps a lone confidence object as data (nothing else to report)', () => {
    const content = JSON.stringify({ confidence: 0.9 });
    const result = parseOCRResult(content, 'keyvalue');
    expect(result.fields.map((f) => f.normalizedField)).toEqual(['confidence']);
  });
});

describe('parseOCRResult — fallbacks', () => {
  it('extracts JSON wrapped in a markdown fence', () => {
    const content = 'Here you go:\n```json\n{"Vendor":"Acme"}\n```';
    expect(valueOf(parseOCRResult(content, 'invoice'), 'Vendor')).toBe('Acme');
  });

  it('falls back to a transcription field for non-JSON output', () => {
    const result = parseOCRResult('just some plain text', 'invoice');
    expect(result.fields[0].normalizedField).toBe('Full Text Transcription');
  });

  it('never emits synthetic bounding boxes', () => {
    const result = parseOCRResult(JSON.stringify({ Vendor: 'Acme' }), 'invoice');
    expect(result.fields.every((f) => f.boundingBox === undefined)).toBe(true);
  });
});
