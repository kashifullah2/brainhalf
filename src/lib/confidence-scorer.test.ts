import { describe, expect, it } from 'vitest';

import {
  calculateFieldConfidence,
  extractModelConfidence,
  validateFieldMath,
} from './confidence-scorer';

/**
 * These cases come from real extractions in the deployed app, where clean values
 * were being routed to the review queue.
 */
describe('calculateFieldConfidence — currency handling', () => {
  it('accepts "Rs." amounts (the bug that flagged every Pakistani receipt)', () => {
    const result = calculateFieldConfidence('Total Amount', 'Rs. 10,000.00', 0.95);
    expect(result.patternScore).toBe(1);
    expect(result.flags).not.toContain('Invalid numeric / currency structure');
    // Comfortably above the 0.80 default routing threshold.
    expect(result.score).toBeGreaterThan(0.8);
  });

  it.each([
    ['$1,234.56'],
    ['1,234.56'],
    ['₹ 999'],
    ['PKR 10,000.00'],
    ['10000'],
    ['10,000.00 Rs'],
    ['(1,234.00)'],
  ])('accepts %s as a money value', (value) => {
    expect(calculateFieldConfidence('Total', value, 0.95).patternScore).toBe(1);
  });

  it('treats "No Charge" on a fee field as valid data, not a failure', () => {
    const result = calculateFieldConfidence('Fee / Charge', 'No Charge', 0.95);
    expect(result.patternScore).toBeGreaterThan(0.8);
    expect(result.flags).toHaveLength(0);
  });

  it('still rejects genuine garbage in a money field', () => {
    const result = calculateFieldConfidence('Total', 'abc/def', 0.95);
    expect(result.patternScore).toBeLessThan(0.5);
    expect(result.flags).toContain('Invalid numeric / currency structure');
  });
});

describe('calculateFieldConfidence — field classification', () => {
  it('does not treat "Tax ID" as a currency amount', () => {
    const result = calculateFieldConfidence('Tax ID', 'NTN-1234567', 0.95);
    expect(result.flags).not.toContain('Invalid numeric / currency structure');
    expect(result.patternScore).toBeGreaterThan(0.9);
  });

  it('does not match "rate" inside "Corporate Name"', () => {
    const result = calculateFieldConfidence('Corporate Name', 'Northwind Supply Co', 0.95);
    expect(result.flags).toHaveLength(0);
    expect(result.patternScore).toBe(1);
  });

  it('does not match "id" inside "Provider"', () => {
    const result = calculateFieldConfidence('Provider', 'easypaisa Mobile Account', 0.95);
    expect(result.patternScore).toBe(1);
  });

  it('accepts document-style dates and times', () => {
    expect(calculateFieldConfidence('Date', '09 February 2024', 0.95).patternScore).toBe(1);
    expect(calculateFieldConfidence('Time', '2:15 AM', 0.95).patternScore).toBe(1);
  });

  it('accepts local mobile numbers', () => {
    expect(calculateFieldConfidence('Mobile', '03151929161', 0.95).patternScore).toBe(1);
  });
});

describe('calculateFieldConfidence — low-quality signals still flag', () => {
  it('flags an empty value', () => {
    const result = calculateFieldConfidence('Vendor', '', 0.95);
    expect(result.flags).toContain('Missing / empty value');
    expect(result.score).toBeLessThan(0.5);
  });

  it('flags text the engine marked illegible', () => {
    const result = calculateFieldConfidence('Vendor', '[ILLEGIBLE]', 0.95);
    expect(result.flags).toContain('Marked illegible by OCR engine');
  });

  it('flags repeated-character hallucinations', () => {
    const result = calculateFieldConfidence('Vendor', 'aaaaaaaa', 0.95);
    expect(result.flags.join(' ')).toMatch(/Repetitive/);
  });
});

describe('validateFieldMath — cross-field arithmetic', () => {
  const field = (name: string, value: string) => ({
    normalizedField: name,
    value,
    editedValue: null,
  });

  it('detects Subtotal + Tax ≠ Total', () => {
    const warnings = validateFieldMath([
      field('Subtotal', '$100.00'),
      field('Tax', '$10.00'),
      field('Total', '$115.00'), // should be $110.00
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].involvedFields).toContain('Total');
    expect(warnings[0].expected).toBe('110.00');
    expect(warnings[0].actual).toBe('115.00');
  });

  it('passes when Subtotal + Tax = Total within rounding tolerance', () => {
    const warnings = validateFieldMath([
      field('Subtotal', '$99.99'),
      field('Tax', '$10.00'),
      field('Total', '$109.99'),
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('detects Qty × Unit Price ≠ Amount', () => {
    const warnings = validateFieldMath([
      field('Qty', '5'),
      field('Unit Price', '$20.00'),
      field('Amount', '$110.00'), // should be $100.00
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].expected).toBe('100.00');
  });

  it('returns no warnings for non-invoice documents', () => {
    const warnings = validateFieldMath([
      field('Full Text Transcription', 'Hello world'),
      field('Image Description', 'A photo of a cat'),
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('handles European number notation (1.234,56)', () => {
    const warnings = validateFieldMath([
      field('Subtotal', '1.000,00'),
      field('Tax', '200,00'),
      field('Total', '1.200,00'),
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('detects unusually high tax rates (> 40%)', () => {
    const warnings = validateFieldMath([
      field('Subtotal', '$100.00'),
      field('Tax', '$50.00'),
      field('Total', '$150.00'),
    ]);
    // It should have 0 warnings for the total math, but 1 for the high tax rate
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('unusually high');
    expect(warnings[0].actual).toBe('50.0%');
  });

  it('detects negative tax rates', () => {
    const warnings = validateFieldMath([
      field('Subtotal', '$100.00'),
      field('Tax', '-$5.00'),
      field('Total', '$95.00'),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('unusually high or negative');
  });

  it('validates Subtotal + Tax - Discount = Total combined math', () => {
    const warnings = validateFieldMath([
      field('Subtotal', '$100.00'),
      field('Tax', '$10.00'),
      field('Discount', '$20.00'),
      field('Total', '$80.00'), // should be 100 + 10 - 20 = 90
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].expected).toBe('90.00');
    expect(warnings[0].actual).toBe('80.00');
    expect(warnings[0].involvedFields).toContain('Discount');
  });
});

// ---------------------------------------------------------------------------
// A missing model signal must not read as a confident one.
//
// extractModelConfidence() used to return a hardcoded 0.92 when the provider gave
// no logprobs and no self-reported score -- which is the normal case on the default
// OCR tier and in `fulltext` mode, not an edge case. 0.92 clears the 0.80 review
// threshold, so unmeasured documents were never flagged and never escalated.
// ---------------------------------------------------------------------------
describe('extractModelConfidence — absent signals', () => {
  it('returns null when the response carries no certainty at all', () => {
    expect(extractModelConfidence({ choices: [{ message: { content: '{}' } }] })).toBeNull();
    expect(extractModelConfidence({})).toBeNull();
    expect(extractModelConfidence(null)).toBeNull();
  });

  it('returns null rather than a number for empty logprobs', () => {
    expect(
      extractModelConfidence({ choices: [{ logprobs: { content: [] } }] }),
    ).toBeNull();
  });

  it('averages token probabilities when logprobs are present', () => {
    const score = extractModelConfidence({
      choices: [{ logprobs: { content: [{ logprob: 0 }, { logprob: 0 }] } }],
    });
    // exp(0) === 1 for both tokens.
    expect(score).toBe(1);
  });

  it('uses a self-reported confidence when the provider supplies one', () => {
    expect(extractModelConfidence({ choices: [{ confidence: 0.4 }] })).toBe(0.4);
  });
});

describe('calculateFieldConfidence — scoring without a model signal', () => {
  it('does not inflate a clean field to the old fabricated baseline', () => {
    const withSignal = calculateFieldConfidence('Vendor', 'Northwind Supply Co', 0.92);
    const without = calculateFieldConfidence('Vendor', 'Northwind Supply Co', null);
    expect(withSignal.modelScore).toBe(0.92);
    expect(without.modelScore).toBeNull();
    // Renormalised over pattern + quality only, so it is not simply the same number.
    expect(without.score).not.toBe(withSignal.score);
  });

  // NOTE: ConfidenceDetails.flags is returned but nothing renders it yet -- every
  // caller reads only `.score`. Surfacing the flags needs a column on
  // document_fields, so it is tracked separately as a feature.
  it('records the absence in the flags', () => {
    const result = calculateFieldConfidence('Vendor', 'Acme', null);
    expect(result.flags.some((f) => f.includes('No model certainty signal'))).toBe(true);
  });

  it('still scores a bad extraction low with no model signal to prop it up', () => {
    // This is the case the fabricated 0.92 used to rescue: garbage that the
    // pattern and quality checks both reject.
    const result = calculateFieldConfidence('Vendor', 'aaaaaaaaaaaa', null);
    expect(result.score).toBeLessThan(0.8);
  });

  it('keeps an illegible value under any sane review threshold', () => {
    const result = calculateFieldConfidence('Total', '[ILLEGIBLE]', null);
    expect(result.score).toBeLessThan(0.5);
  });
});
