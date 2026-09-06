// ---------------------------------------------------------------------------
// Provider reply -> the fields and rows the database and the UI both use.
//
// This lived in src/lib/ocr-client.ts, which the queue consumer cannot import
// (that file pulls in localforage and the browser fetch wrapper). So
// queue-worker/src/index.ts carried its own second implementation, and the two
// had already diverged in ways that changed stored data:
//
//   * the worker set no per-field confidence at all, so sanitizeFields()
//     defaulted every field to 0 and the review queue filled up with documents
//     nothing was actually unsure about;
//   * the worker had no `fulltext` branch, so a plain-text transcription came back
//     as one unnamed field instead of the Image Description / Full Text
//     Transcription pair the client produces;
//   * `_overall_confidence` was consumed differently on each side.
//
// One implementation, imported by both. Pure: no DOM, no storage, no fetch.
// ---------------------------------------------------------------------------

import { calculateFieldConfidence, type ImageQualityMetrics } from './confidence';
import {
  extractJsonBlock,
  flattenExtraction,
  takeMetaConfidence,
  splitPreambleFromText,
} from './extraction-parse';

export interface ExtractedField {
  normalizedField: string;
  originalLabel: string;
  value: string;
  editedValue: string | null;
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ParsedExtraction {
  rawText: string;
  fields: ExtractedField[];
  rows: Record<string, unknown>[];
}

export function parseExtraction(
  content: string, 
  mode?: string,
  /**
   * The provider's certainty, or null when it gave none. Null is not a synonym
   * for "high": calculateFieldConfidence() drops the model dimension for it and
   * scores on pattern and image quality alone.
   */
  rawModelConfidence: number | null = null,
  imageQuality?: ImageQualityMetrics
): ParsedExtraction {
  let fields: ExtractedField[] = [];
  let rows: Record<string, unknown>[] = [];
  let rawText = content;

  try {
    // Robustly extract JSON block even if preceded/followed by LLM text
    const jsonStr = extractJsonBlock(content);

    const parsed = JSON.parse(jsonStr.trim());

    if (mode === "fulltext" || mode === undefined) {
      const parsedObj: Record<string, unknown> =
        typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
      const rawDescription = parsedObj.image_description || parsedObj.description || parsedObj.visual_summary;
      const rawTextContent = parsedObj.text || parsedObj.extracted_text || parsedObj.transcription || (typeof parsed === "string" ? parsed : "");

      const { descFromText, cleanText } = splitPreambleFromText(String(rawTextContent));
      const finalDescription = rawDescription ? String(rawDescription) : descFromText;
      const finalExtractedText = cleanText || String(rawTextContent);
      // A `confidence` key the model actually emitted is a real signal; falling
      // back to rawModelConfidence keeps null as null.
      const confScore =
        typeof parsedObj.confidence === "number" ? parsedObj.confidence : rawModelConfidence;

      const fieldsList: ExtractedField[] = [];

      if (finalDescription) {
        const descConf = calculateFieldConfidence("Image Description", finalDescription, confScore, imageQuality);
        fieldsList.push({
          normalizedField: "Image Description",
          originalLabel: "Image Description",
          value: finalDescription,
          editedValue: null,
          confidence: descConf.score,
        });
      }

      const textConf = calculateFieldConfidence("Full Text Transcription", finalExtractedText, confScore, imageQuality);
      fieldsList.push({
        normalizedField: "Full Text Transcription",
        originalLabel: "Full Text Transcription",
        value: finalExtractedText,
        editedValue: null,
        confidence: textConf.score,
      });

      return {
        rawText: finalExtractedText,
        fields: fieldsList,
        rows: [
          {
            "Image Description": finalDescription || "—",
            "Full Text Transcription": finalExtractedText
          }
        ]
      };
    }

    let globalConfidence: number | null = rawModelConfidence;

    if (Array.isArray(parsed)) {
      // Table mode: one row per array entry, each flattened so nested cells
      // become their own columns.
      const flattenedRows = parsed.map((row) => {
        const record: Record<string, unknown> = {};
        for (const [label, val] of flattenExtraction(row)) {
          record[label] = val;
        }
        return record;
      });
      rows = flattenedRows;

      const allFields: Array<[string, string]> = [];
      parsed.forEach((row, rowIndex) => {
        for (const [key, val] of flattenExtraction(row, `Row ${rowIndex + 1}`)) {
          allFields.push([key, val]);
        }
      });

      fields = allFields.map(([key, strVal]) => {
        const confDetails = calculateFieldConfidence(key, strVal, globalConfidence, imageQuality);
        return {
          normalizedField: key,
          originalLabel: key,
          value: strVal,
          editedValue: null,
          confidence: confDetails.score,
        };
      });
    } else if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const meta = takeMetaConfidence(record);
      if (meta !== undefined) globalConfidence = meta;

      const flattened = flattenExtraction(record);

      fields = flattened.map(([key, strVal]) => {
        const confDetails = calculateFieldConfidence(key, strVal, globalConfidence, imageQuality);
        return {
          normalizedField: key,
          originalLabel: key,
          value: strVal,
          editedValue: null,
          confidence: confDetails.score,
        };
      });

      const projected: Record<string, unknown> = {};
      for (const [key, strVal] of flattened) projected[key] = strVal;
      rows = [projected];
    }
  } catch {
    // If raw non-JSON text output, parse out preamble if any and create separate fields without truncating
    const { descFromText, cleanText } = splitPreambleFromText(content);
    fields = [];
    if (descFromText) {
      const descConf = calculateFieldConfidence("Image Description", descFromText, rawModelConfidence, imageQuality);
      fields.push({
        normalizedField: "Image Description",
        originalLabel: "Image Description",
        value: descFromText,
        editedValue: null,
        confidence: descConf.score,
      });
    }

    const confDetails = calculateFieldConfidence("Full Text Transcription", cleanText, rawModelConfidence, imageQuality);
    fields.push({
      normalizedField: "Full Text Transcription",
      originalLabel: "Transcription",
      value: cleanText,
      editedValue: null,
      confidence: confDetails.score,
    });
    rawText = cleanText;
  }

  return { rawText, fields, rows };
}

// Bounding boxes are deliberately NOT synthesised here. The previous
// implementation generated coordinates with Math.random(), and the document
// viewer drew those boxes over the page — so field highlights pointed at random
// locations and moved on every re-render. A wrong highlight is worse than none.
// Real coordinates require an engine that returns them; until then the viewer
// shows the document without overlays.
