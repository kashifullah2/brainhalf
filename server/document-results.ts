export const MAX_FIELDS = 300;
export const MAX_VALUE_CHARS = 8_000;
export const MAX_OCR_TEXT_CHARS = 200_000;

export function clampConfidence(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, numeric));
}

export interface IncomingField {
  normalizedField?: unknown;
  originalLabel?: unknown;
  value?: unknown;
  confidence?: unknown;
}

export interface SafeField {
  normalizedField: string;
  originalLabel: string;
  value: string;
  confidence: number;
}

export function sanitizeFields(rawFields: IncomingField[]): SafeField[] {
  const seen = new Set<string>();
  const fields: SafeField[] = [];

  for (const raw of rawFields) {
    const name = typeof raw.normalizedField === 'string' ? raw.normalizedField.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    fields.push({
      normalizedField: name.slice(0, 200),
      originalLabel:
        typeof raw.originalLabel === 'string'
          ? raw.originalLabel.trim().slice(0, 200)
          : name.slice(0, 200),
      value:
        typeof raw.value === 'string'
          ? raw.value.slice(0, MAX_VALUE_CHARS)
          : String(raw.value ?? '').slice(0, MAX_VALUE_CHARS),
      confidence: clampConfidence(raw.confidence),
    });
  }

  return fields.slice(0, MAX_FIELDS);
}

export function computeOverallConfidence(
  explicitConfidence: unknown,
  fields: SafeField[]
): number | null {
  if (explicitConfidence !== undefined && explicitConfidence !== null) {
    return clampConfidence(explicitConfidence);
  }
  if (fields.length > 0) {
    return fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length;
  }
  return null;
}

export function buildDocumentResultStatements(
  db: any,
  documentId: number,
  userId: string,
  ocrText: string | null,
  overallConfidence: number | null,
  fields: SafeField[]
) {
  const safeOcrText = typeof ocrText === 'string' ? ocrText.slice(0, MAX_OCR_TEXT_CHARS) : null;
  
  return [
    db.prepare(
      `UPDATE documents
          SET status = 'completed', error = NULL, ocr_text = ?,
              overall_confidence = ?, completed_at = datetime('now')
        WHERE id = ?`
    ).bind(safeOcrText, overallConfidence, documentId),
    db.prepare(`DELETE FROM document_fields WHERE document_id = ?`).bind(documentId),
    ...fields.map((field, index) =>
      db.prepare(
        `INSERT INTO document_fields
           (document_id, user_id, position, normalized_field, original_label,
            value, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        documentId,
        userId,
        index,
        field.normalizedField,
        field.originalLabel,
        field.value,
        field.confidence,
      )
    ),
  ];
}
