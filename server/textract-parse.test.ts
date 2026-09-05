import { describe, expect, it } from 'vitest';

import { parseTextractResponse } from './textract-parse';
import type { TextractResponse } from './aws-ocr';

describe('parseTextractResponse', () => {
  it('reports the confidence Textract measured, not a constant', () => {
    // The adapter this replaces wrote `_overall_confidence: 0.99` into every
    // result regardless of what Textract said. 0.99 is above every review
    // threshold, so it turned the review queue and the escalation tier off.
    const response: TextractResponse = {
      Blocks: [
        { Id: '1', BlockType: 'LINE', Text: 'INVOICE', Confidence: 60 },
        { Id: '2', BlockType: 'LINE', Text: 'Total 41.00', Confidence: 40 },
      ],
    };

    const parsed = parseTextractResponse(response);

    expect(parsed.confidence).toBeCloseTo(0.5, 5);
    expect(parsed.confidence).not.toBe(0.99);
    expect(parsed.rawText).toBe('INVOICE\nTotal 41.00');
  });

  it('says nothing rather than something when Textract reported no confidence', () => {
    const parsed = parseTextractResponse({
      Blocks: [{ Id: '1', BlockType: 'LINE', Text: 'Hello' }],
    });

    expect(parsed.confidence).toBeNull();
  });

  it('pairs KEY_VALUE_SET blocks and scores them from the words that were read', () => {
    const response: TextractResponse = {
      Blocks: [
        {
          Id: 'key',
          BlockType: 'KEY_VALUE_SET',
          EntityTypes: ['KEY'],
          Confidence: 99,
          Relationships: [
            { Type: 'CHILD', Ids: ['kw'] },
            { Type: 'VALUE', Ids: ['value'] },
          ],
        },
        { Id: 'kw', BlockType: 'WORD', Text: 'Vendor:', Confidence: 98 },
        {
          Id: 'value',
          BlockType: 'KEY_VALUE_SET',
          EntityTypes: ['VALUE'],
          Confidence: 99,
          Relationships: [{ Type: 'CHILD', Ids: ['vw1', 'vw2'] }],
        },
        { Id: 'vw1', BlockType: 'WORD', Text: 'Acme', Confidence: 50 },
        { Id: 'vw2', BlockType: 'WORD', Text: 'Ltd', Confidence: 50 },
      ],
    };

    const parsed = parseTextractResponse(response);

    expect(parsed.fields).toHaveLength(1);
    expect(parsed.fields[0].label).toBe('Vendor');
    expect(parsed.fields[0].value).toBe('Acme Ltd');
    // Mean of 98, 50, 50 — the words, not the KEY_VALUE_SET's own 99. A value
    // read badly must score badly even when the form structure was found cleanly.
    expect(parsed.fields[0].confidence).toBeCloseTo(0.66, 2);
  });

  it('reads AnalyzeExpense summary fields and line items', () => {
    const parsed = parseTextractResponse({
      ExpenseDocuments: [
        {
          SummaryFields: [
            {
              Type: { Text: 'TOTAL' },
              ValueDetection: { Text: '41.00', Confidence: 96 },
            },
          ],
          LineItemGroups: [
            {
              LineItems: [
                {
                  LineItemExpenseFields: [
                    { Type: { Text: 'ITEM' }, ValueDetection: { Text: 'Widget', Confidence: 90 } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.fields.map((f) => f.label)).toEqual(['TOTAL', 'Line 1 — ITEM']);
    expect(parsed.fields[0].confidence).toBeCloseTo(0.96, 5);
    // No LINE blocks in an expense-only reply, so the field confidences are the
    // overall signal.
    expect(parsed.confidence).toBeCloseTo(0.93, 2);
  });

  it('does not let two fields with the same printed label collide', () => {
    const parsed = parseTextractResponse({
      ExpenseDocuments: [
        {
          SummaryFields: [
            { Type: { Text: 'TAX' }, ValueDetection: { Text: '1.00', Confidence: 90 } },
            { Type: { Text: 'TAX' }, ValueDetection: { Text: '2.00', Confidence: 90 } },
          ],
        },
      ],
    });

    expect(parsed.fields.map((f) => f.label)).toEqual(['TAX', 'TAX (2)']);
  });

  it('drops a field with no value, and marks an unscored one as unscored', () => {
    const parsed = parseTextractResponse({
      ExpenseDocuments: [
        {
          SummaryFields: [
            { Type: { Text: 'VENDOR' }, ValueDetection: { Text: '' } },
            { Type: { Text: 'DATE' }, ValueDetection: { Text: '2026-01-01' } },
          ],
        },
      ],
    });

    expect(parsed.fields).toHaveLength(1);
    // Null confidence becomes 0, never 1: an unscored value must not read as
    // certain and skip review.
    expect(parsed.fields[0]).toEqual({ label: 'DATE', value: '2026-01-01', confidence: 0 });
  });

  it('reads a selected checkbox as [X]', () => {
    const parsed = parseTextractResponse({
      Blocks: [
        {
          Id: 'key',
          BlockType: 'KEY_VALUE_SET',
          EntityTypes: ['KEY'],
          Relationships: [
            { Type: 'CHILD', Ids: ['kw'] },
            { Type: 'VALUE', Ids: ['value'] },
          ],
        },
        { Id: 'kw', BlockType: 'WORD', Text: 'Paid', Confidence: 99 },
        {
          Id: 'value',
          BlockType: 'KEY_VALUE_SET',
          EntityTypes: ['VALUE'],
          Relationships: [{ Type: 'CHILD', Ids: ['sel'] }],
        },
        { Id: 'sel', BlockType: 'SELECTION_ELEMENT', SelectionStatus: 'SELECTED', Confidence: 99 },
      ],
    });

    expect(parsed.fields[0]).toMatchObject({ label: 'Paid', value: '[X]' });
  });

  it('returns empty rather than throwing on a reply with nothing in it', () => {
    expect(parseTextractResponse({})).toEqual({ fields: [], rawText: '', confidence: null });
  });
});
