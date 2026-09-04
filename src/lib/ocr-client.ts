// ---------------------------------------------------------------------------
// OCR client
//
// Talks to our OWN server-side proxy at /api/ocr (functions/api/ocr.ts), which
// holds the upstream credential. No API key exists in this file, or anywhere
// else in the browser bundle — a VITE_-prefixed secret is inlined into the
// published JavaScript and readable by anyone with DevTools.
//
// This file no longer composes what the model is sent. It names a *tier* and a
// *mode* and hands over the document; the prompt, the document part and the
// sampling parameters are built in server/ocr-prompts.ts. Two reasons:
//
//   - the proxy maps a tier to a model server-side, so a signed-in user cannot
//     aim the account's small premium daily quota at their own batch;
//   - it used to build the whole `messages` array here and the proxy forwarded it
//     verbatim, which made /api/ocr general purpose LLM access on the account's
//     budget for anyone holding a session.
// ---------------------------------------------------------------------------

import localforage from "localforage";
import { 
  TextractClient, 
  DetectDocumentTextCommand,
  AnalyzeDocumentCommand,
  AnalyzeExpenseCommand 
} from "@aws-sdk/client-textract";
import { apiRequest } from "./api-client";
import {
  calculateFieldConfidence,
  analyzeImageQuality,
  extractModelConfidence,
  ImageQualityMetrics,
} from "./confidence-scorer";
import {
  extractJsonBlock,
  flattenExtraction,
  takeMetaConfidence,
  splitPreambleFromText,
} from "../../server/extraction-parse";

/**
 * Same-origin path to our OCR proxy, resolved against the deployment base so
 * the app keeps working when hosted under a sub-path (BASE_PATH=/foo/).
 */
/** apiRequest resolves this against the deployment base; see lib/api-paths.ts. */
const OCR_PROXY_PATH = "/ocr";

// Drop caches from older schema versions.
//
// v4 added the model tier to the key and stored the model's confidence alongside
// the content. v5 exists because that stored value could still be the hardcoded
// 0.92 that extractModelConfidence() used to return when the provider gave no
// signal at all -- a number above the review threshold, on documents nothing had
// measured. Those entries have to go, or the fix would not reach anything already
// cached.
localforage.keys().then((keys) => {
  keys.forEach((key) => {
    if (key.startsWith("ocr_cache_") && !key.startsWith("ocr_cache_v5_")) {
      localforage.removeItem(key);
    }
  });
}).catch(() => {});


async function hashString(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ExtractionResult {
  rawText: string;
  fields: Array<{
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
  }>;
  rows: Record<string, unknown>[];
}

/** Shape of the JSON error envelope returned by functions/api/ocr.ts. */
interface OcrProxyError {
  error?: string;
  details?: string;
}

/**
 * Which model tier the proxy should use. `escalation` is for re-reading a
 * document the cheap tier extracted with low confidence, and draws on a daily
 * quota roughly a tenth the size — so it is requested per document, never by
 * default. The proxy resolves this to an actual model name.
 */
export type OcrTier = 'default' | 'escalation';

/**
 * A cached extraction.
 *
 * The model's own confidence is stored with the content, not recomputed on read.
 * Earlier versions cached the content string alone and passed a hardcoded 0.92
 * on every cache hit, which had two consequences: the confidence shown for a
 * cached document was invented, and because 0.92 sits above any sane review
 * threshold, a cached low-quality scan could never trigger escalation.
 */
interface CachedExtraction {
  content: string;
  /** Null when the provider returned no certainty signal for this extraction. */
  modelConfidence: number | null;
}

export async function extractDocument(
  file: File,
  mode: string,
  forceReprocess: boolean = false,
  customPrompt?: string,
  tier: OcrTier = 'default'
): Promise<ExtractionResult> {
  // Convert file to Base64
  const base64Data = await fileToBase64(file);

  // Analyze client-side image quality (resolution, contrast, edge blur)
  const imageQuality = await analyzeImageQuality(file);

  const isPdf = file.type === "application/pdf";

  /**
   * Read the type back out of the data URL rather than off the File.
   *
   * fileToBase64 re-encodes images as JPEG, so a PNG upload arrives here as
   * `data:image/jpeg;base64,...`. The server checks that the declared type and the
   * data URL agree, and it is the URL that is telling the truth.
   */
  let declaredType = /^data:([^;]+);base64,/.exec(base64Data)?.[1] ?? file.type;
  if (!declaredType || declaredType === 'application/octet-stream') {
    if (file.name) {
      if (/\.jpe?g$/i.test(file.name)) declaredType = 'image/jpeg';
      else if (/\.png$/i.test(file.name)) declaredType = 'image/png';
      else if (/\.webp$/i.test(file.name)) declaredType = 'image/webp';
      else if (/\.pdf$/i.test(file.name)) declaredType = 'application/pdf';
    }
  }
  if (declaredType === 'image/jpg') declaredType = 'image/jpeg';

  // The tier is part of the cache key. The premium tier exists to produce a
  // *better* reading of the same bytes, so sharing one entry between tiers would
  // either serve the worse result or silently discard the better one.
  const cacheKey = `ocr_cache_v5_${tier}_${mode}_${await hashString(base64Data)}`;

  if (!forceReprocess) {
    try {
      const cached = await localforage.getItem<CachedExtraction>(cacheKey);
      if (cached?.content) {
        return parseOCRResult(cached.content, mode, cached.modelConfidence, imageQuality);
      }
    } catch (err) {
      console.warn("Failed to read from OCR cache:", err);
    }
  }

  // AWS Textract Integration (Native Forms, Expense & Tables)
  const accessKeyId = (import.meta.env.VITE_AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || "").trim();
  if (accessKeyId && secretAccessKey) {
    console.log(`[OCR Client] Routing to Native AWS Textract (${mode})...`);
    const client = new TextractClient({
      region: import.meta.env.VITE_AWS_REGION || "us-east-1",
      credentials: {
        accessKeyId,
        secretAccessKey
      }
    });
    
    const base64Content = base64Data.split(",")[1].replace(/\s/g, "");
    const binaryString = atob(base64Content);
    const len = binaryString.length;
    const imageBytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      imageBytes[i] = binaryString.charCodeAt(i);
    }

    try {
      let response: any = null;
      if (mode === 'invoice' || mode === 'receipt') {
        try {
          const expenseCommand = new AnalyzeExpenseCommand({
            Document: { Bytes: imageBytes }
          });
          response = await client.send(expenseCommand);
        } catch {
          // Fallback to AnalyzeDocument if Expense fails
        }
      }

      if (!response || !response.ExpenseDocuments?.length) {
        try {
          const analyzeCommand = new AnalyzeDocumentCommand({
            Document: { Bytes: imageBytes },
            FeatureTypes: ["FORMS", "TABLES"]
          });
          response = await client.send(analyzeCommand);
        } catch {
          const textCommand = new DetectDocumentTextCommand({
            Document: { Bytes: imageBytes }
          });
          response = await client.send(textCommand);
        }
      }

      const fields: Array<{
        normalizedField: string;
        originalLabel: string;
        value: string;
        editedValue: string | null;
        confidence: number;
      }> = [];
      const rows: Record<string, unknown>[] = [];
      let rawText = "";

      // 1. Process Expense Documents (Invoices & Receipts)
      if (response.ExpenseDocuments && response.ExpenseDocuments.length > 0) {
        for (const expDoc of response.ExpenseDocuments) {
          if (expDoc.SummaryFields) {
            for (const f of expDoc.SummaryFields) {
              const label = f.Type?.Text || f.LabelDetection?.Text || "Field";
              const val = f.ValueDetection?.Text || "";
              const conf = (f.ValueDetection?.Confidence || 99) / 100;
              if (val) {
                fields.push({
                  normalizedField: label,
                  originalLabel: label,
                  value: val,
                  editedValue: null,
                  confidence: Math.round(conf * 100) / 100,
                });
              }
            }
          }
          if (expDoc.LineItemGroups) {
            for (const group of expDoc.LineItemGroups) {
              if (group.LineItems) {
                for (const item of group.LineItems) {
                  const rowObj: Record<string, unknown> = {};
                  if (item.LineItemExpenseFields) {
                    for (const f of item.LineItemExpenseFields) {
                      const k = f.Type?.Text || f.LabelDetection?.Text || "Item";
                      rowObj[k] = f.ValueDetection?.Text || "";
                    }
                  }
                  if (Object.keys(rowObj).length > 0) rows.push(rowObj);
                }
              }
            }
          }
        }
      }

      // 2. Process Forms / Key-Values / Line Blocks
      if (response.Blocks) {
        const blockMap = new Map<string, any>();
        const keyBlocks: any[] = [];
        const lineTexts: string[] = [];

        for (const block of response.Blocks) {
          blockMap.set(block.Id, block);
          if (block.BlockType === "LINE" && block.Text) {
            lineTexts.push(block.Text);
          } else if (block.BlockType === "KEY_VALUE_SET" && block.EntityTypes?.includes("KEY")) {
            keyBlocks.push(block);
          }
        }

        rawText = lineTexts.join("\n");

        const getText = (resultBlock: any) => {
          let t = "";
          if (resultBlock?.Relationships) {
            for (const rel of resultBlock.Relationships) {
              if (rel.Type === "CHILD") {
                for (const childId of rel.Ids) {
                  const word = blockMap.get(childId);
                  if (word?.BlockType === "WORD") t += word.Text + " ";
                  if (word?.BlockType === "SELECTION_ELEMENT" && word.SelectionStatus === "SELECTED") t += "[X] ";
                }
              }
            }
          }
          return t.trim();
        };

        const getValueBlock = (keyBlock: any) => {
          if (keyBlock.Relationships) {
            for (const rel of keyBlock.Relationships) {
              if (rel.Type === "VALUE") {
                for (const valId of rel.Ids) return blockMap.get(valId);
              }
            }
          }
          return null;
        };

        for (const keyBlock of keyBlocks) {
          const kText = getText(keyBlock);
          const vBlock = getValueBlock(keyBlock);
          const vText = vBlock ? getText(vBlock) : "";
          if (kText && vText) {
            fields.push({
              normalizedField: kText,
              originalLabel: kText,
              value: vText,
              editedValue: null,
              confidence: Math.round(((keyBlock.Confidence || 99) / 100) * 100) / 100,
            });
          }
        }
      }

      if (!rawText && fields.length > 0) {
        rawText = fields.map(f => `${f.normalizedField}: ${f.value}`).join("\n");
      }

      if (fields.length === 0 && rawText) {
        fields.push({
          normalizedField: "Full Text Transcription",
          originalLabel: "Transcription",
          value: rawText,
          editedValue: null,
          confidence: 0.99
        });
      }

      return { rawText, fields, rows };
    } catch (err: any) {
      console.error("Textract Native Error:", err);
      const errorName = err.name || "UnknownError";
      const errorMsg = err.message || "An error occurred";
      throw new Error(`Textract Error (${errorName}): ${errorMsg}`);
    }
  }

  /**
   * What the server is asked for. Notably NOT a `messages` array.
   *
   * This used to compose the whole upstream conversation here -- system prompt,
   * document part, temperature, seed, response format -- and /api/ocr forwarded it
   * verbatim. That made the endpoint general purpose LLM access on the account's
   * budget for anyone holding a session. The prompt, the document part and the
   * sampling parameters are all built server-side now, in server/ocr-prompts.ts,
   * from a mode checked against a fixed list.
   *
   * There is still no `model` field: the proxy resolves the model from `tier`, so a
   * caller cannot aim the small premium daily quota at their own batch.
   */
  const requestBody = {
    tier,
    mode,
    // The one piece of caller text that reaches the model, and only inside the
    // delimited block the server's prompt builder puts it in.
    customPrompt,
    document: {
      contentType: declaredType,
      dataUrl: base64Data,
      filename: file.name || (isPdf ? "document.pdf" : "document"),
    },
  };

  // One request, to our own origin. There is no direct-to-provider fallback: a
  // browser cannot hold a credential, so the previous fallback published the
  // provider key to anyone who opened DevTools. A proxy failure is an error.
  const response = await apiRequest(OCR_PROXY_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let detail = raw.slice(0, 200);
    try {
      const parsedError = JSON.parse(raw) as OcrProxyError;
      // `details` only exists in development. Production deliberately returns a
      // single user-facing `error` and logs the provider's own wording server-side,
      // because that wording describes our account rather than this document.
      detail = parsedError.error || parsedError.details || detail;
    } catch {
      // Not JSON, so the raw prefix above is the best detail available.
    }
    // Naming the file type matters: if the configured model does not accept
    // native PDF input, every PDF fails while every image succeeds. An
    // unqualified "extraction failed" hides that pattern completely.
    const pdfHint = isPdf
      ? " This file is a PDF, which the configured model may not accept."
      : "";
    // The server's sentence leads; the status is context, not the headline.
    throw new Error(
      `${detail || "Extraction failed."}${pdfHint} (HTTP ${response.status})`,
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const modelConfidence = extractModelConfidence(data);

  try {
    // Store the model's real confidence with the content. Recomputing it on read
    // is impossible — logprobs are not in the cached text — so a cache that held
    // only the content forced a fabricated score on every hit.
    await localforage.setItem<CachedExtraction>(cacheKey, { content, modelConfidence });
  } catch (err) {
    console.warn("Failed to write to OCR cache:", err);
  }

  return parseOCRResult(content, mode, modelConfidence, imageQuality);
}

export function compressImageForUpload(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (file.type === "application/pdf") {
      return resolve(file);
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIMENSION = 1500;
      let width = img.width;
      let height = img.height;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return resolve(file);
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) return resolve(file);
        const nameParts = file.name.split('.');
        if (nameParts.length > 1) {
          nameParts.pop();
        }
        const newName = nameParts.join('.') + '.jpeg';
        resolve(new File([blob], newName, { type: "image/jpeg", lastModified: file.lastModified }));
      }, "image/jpeg", 0.6);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    // Pass PDFs through without compression
    if (file.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
      return;
    }

    // For images, use HTML5 Canvas to resize and compress
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      const MAX_DIMENSION = 1500;
      let width = img.width;
      let height = img.height;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      
      if (!ctx) {
        // Fallback if canvas fails
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
        return;
      }
      
      // Draw and compress to 60% JPEG to drastically reduce payload
      // Modern LLMs handle this compression level perfectly for OCR
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      resolve(dataUrl);
    };
    img.onerror = () => reject(new Error("Failed to load image for compression"));
    img.src = url;
  });
}




export function parseOCRResult(
  content: string, 
  mode?: string,
  /**
   * The provider's certainty, or null when it gave none. Null is not a synonym
   * for "high": calculateFieldConfidence() drops the model dimension for it and
   * scores on pattern and image quality alone.
   */
  rawModelConfidence: number | null = null,
  imageQuality?: ImageQualityMetrics
): ExtractionResult {
  let fields: ExtractionResult["fields"] = [];
  let rows: Record<string, unknown>[] = [];
  let rawText = content;

  try {
    // Robustly extract JSON block even if preceded/followed by LLM text
    let jsonStr = extractJsonBlock(content);

    const parsed = JSON.parse(jsonStr.trim());

    if (mode === "fulltext" || mode === undefined) {
      const parsedObj = (typeof parsed === "object" && parsed !== null) ? (parsed as Record<string, any>) : {};
      const rawDescription = parsedObj.image_description || parsedObj.description || parsedObj.visual_summary;
      const rawTextContent = parsedObj.text || parsedObj.extracted_text || parsedObj.transcription || (typeof parsed === "string" ? parsed : "");

      const { descFromText, cleanText } = splitPreambleFromText(String(rawTextContent));
      const finalDescription = rawDescription ? String(rawDescription) : descFromText;
      const finalExtractedText = cleanText || String(rawTextContent);
      // A `confidence` key the model actually emitted is a real signal; falling
      // back to rawModelConfidence keeps null as null.
      const confScore =
        typeof parsedObj.confidence === "number" ? parsedObj.confidence : rawModelConfidence;

      const fieldsList: ExtractionResult["fields"] = [];

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

// Bounding boxes are deliberately NOT synthesised any more. The previous
// implementation generated coordinates with Math.random(), and the document
// viewer drew those boxes over the page — so field highlights pointed at random
// locations and moved on every re-render. A wrong highlight is worse than none.
// Real coordinates require an engine that returns them; until then the viewer
// shows the document without overlays.

