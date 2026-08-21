import { describe, expect, it } from 'vitest';

import { calculateFieldConfidence } from './confidence-scorer';

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
