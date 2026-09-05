// ---------------------------------------------------------------------------
// Textract response -> the flat label/value shape the rest of the pipeline uses.
//
// Confidence here comes from Textract's own per-block `Confidence` (0-100). The
// adapter this replaces wrote a constant 0.99 into every result, which sat above
// every review threshold and therefore turned the review queue and the escalation
// tier off for any document Textract handled.
// ---------------------------------------------------------------------------

import type { TextractBlock, TextractExpenseField, TextractResponse } from './aws-ocr';

export interface TextractField {
  label: string;
  value: string;
  /** 0-1. Textract reports 0-100, so this is its number divided by 100. */
  confidence: number;
}

export interface TextractExtraction {
  fields: TextractField[];
  /** Line-by-line transcription, in reading order. */
  rawText: string;
  /**
   * Mean of the confidences Textract actually reported, or null when it reported
   * none. Null means "not measured" and propagates as such -- it is never
   * replaced with an optimistic default.
   */
  confidence: number | null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Walks a block's CHILD relationships and joins the words underneath it. */
function childText(
  block: TextractBlock | undefined,
  byId: Map<string, TextractBlock>,
): { text: string; confidences: number[] } {
  const parts: string[] = [];
  const confidences: number[] = [];
  if (!block?.Relationships) return { text: '', confidences };

  for (const relationship of block.Relationships) {
    if (relationship.Type !== 'CHILD' || !relationship.Ids) continue;
    for (const id of relationship.Ids) {
      const child = byId.get(id);
      if (!child) continue;
      if (child.BlockType === 'WORD' && child.Text) {
        parts.push(child.Text);
        if (typeof child.Confidence === 'number') confidences.push(child.Confidence);
      } else if (
        child.BlockType === 'SELECTION_ELEMENT' &&
        child.SelectionStatus === 'SELECTED'
      ) {
        parts.push('[X]');
        if (typeof child.Confidence === 'number') confidences.push(child.Confidence);
      }
    }
  }

  return { text: parts.join(' ').trim(), confidences };
}

function relatedValueBlock(
  keyBlock: TextractBlock,
  byId: Map<string, TextractBlock>,
): TextractBlock | undefined {
  for (const relationship of keyBlock.Relationships ?? []) {
    if (relationship.Type !== 'VALUE') continue;
    for (const id of relationship.Ids ?? []) {
      const value = byId.get(id);
      if (value) return value;
    }
  }
  return undefined;
}

function expenseFieldLabel(field: TextractExpenseField, fallback: string): string {
  return (
    field.Type?.Text?.trim() ||
    field.LabelDetection?.Text?.trim() ||
    fallback
  );
}

export function parseTextractResponse(response: TextractResponse): TextractExtraction {
  const fields: TextractField[] = [];
  const usedLabels = new Map<string, number>();
  const documentConfidences: number[] = [];

  /** Keeps two fields with the same printed label from colliding. */
  const pushField = (label: string, value: string, confidence: number | null) => {
    const trimmedLabel = label.trim().replace(/:$/, '').trim();
    const trimmedValue = value.trim();
    if (!trimmedLabel || !trimmedValue) return;

    const seen = usedLabels.get(trimmedLabel) ?? 0;
    usedLabels.set(trimmedLabel, seen + 1);
    fields.push({
      label: seen === 0 ? trimmedLabel : `${trimmedLabel} (${seen + 1})`,
      value: trimmedValue,
      // Null becomes 0 rather than 1: an unscored value must not read as certain.
      confidence: confidence === null ? 0 : clamp01(confidence / 100),
    });
    if (confidence !== null) documentConfidences.push(confidence);
  };

  // --- AnalyzeExpense: invoices and receipts --------------------------------
  for (const expense of response.ExpenseDocuments ?? []) {
    for (const field of expense.SummaryFields ?? []) {
      pushField(
        expenseFieldLabel(field, 'Field'),
        field.ValueDetection?.Text ?? '',
        typeof field.ValueDetection?.Confidence === 'number'
          ? field.ValueDetection.Confidence
          : null,
      );
    }

    let lineNumber = 0;
    for (const group of expense.LineItemGroups ?? []) {
      for (const item of group.LineItems ?? []) {
        lineNumber += 1;
        for (const field of item.LineItemExpenseFields ?? []) {
          pushField(
            `Line ${lineNumber} — ${expenseFieldLabel(field, 'Item')}`,
            field.ValueDetection?.Text ?? '',
            typeof field.ValueDetection?.Confidence === 'number'
              ? field.ValueDetection.Confidence
              : null,
          );
        }
      }
    }
  }

  // --- AnalyzeDocument / DetectDocumentText ---------------------------------
  const blocks = response.Blocks ?? [];
  const byId = new Map<string, TextractBlock>();
  const keyBlocks: TextractBlock[] = [];
  const lines: string[] = [];
  const lineConfidences: number[] = [];

  for (const block of blocks) {
    if (block.Id) byId.set(block.Id, block);
    if (block.BlockType === 'LINE' && block.Text) {
      lines.push(block.Text);
      if (typeof block.Confidence === 'number') lineConfidences.push(block.Confidence);
    } else if (
      block.BlockType === 'KEY_VALUE_SET' &&
      block.EntityTypes?.includes('KEY')
    ) {
      keyBlocks.push(block);
    }
  }

  for (const keyBlock of keyBlocks) {
    const key = childText(keyBlock, byId);
    const valueBlock = relatedValueBlock(keyBlock, byId);
    const value = childText(valueBlock, byId);
    // Prefer the words' own confidences over the KEY_VALUE_SET's: the words are
    // what was read, and a value read badly should score badly even when the
    // surrounding form structure was detected cleanly.
    const wordConfidence = mean([...key.confidences, ...value.confidences]);
    const blockConfidence =
      typeof valueBlock?.Confidence === 'number' ? valueBlock.Confidence : null;
    pushField(key.text, value.text, wordConfidence ?? blockConfidence);
  }

  const rawText = lines.join('\n');

  // Line confidences describe the whole page, so they are the best overall
  // signal. Field confidences are the fallback for an expense-only response,
  // which carries no LINE blocks.
  const confidence = mean(lineConfidences) ?? mean(documentConfidences);

  return {
    fields,
    rawText,
    confidence: confidence === null ? null : clamp01(confidence / 100),
  };
}
