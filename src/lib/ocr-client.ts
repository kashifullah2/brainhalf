// ---------------------------------------------------------------------------
// OCR client
//
// Talks to our OWN server-side proxy at /api/ocr (functions/api/ocr.ts), which
// holds the upstream credential. No API key exists in this file, or anywhere
// else in the browser bundle — a VITE_-prefixed secret is inlined into the
// published JavaScript and readable by anyone with DevTools.
//
// The caller selects a *tier*, not a model. The proxy maps the tier to a model
// server-side so a signed-in user cannot aim the account's small premium daily
// quota at their own batch.
// ---------------------------------------------------------------------------

import localforage from "localforage";
import { 
  calculateFieldConfidence, 
  calculateDocumentOverallConfidence,
  analyzeImageQuality,
  extractModelConfidence,
  ImageQualityMetrics
} from "./confidence-scorer";

/**
 * Same-origin path to our OCR proxy, resolved against the deployment base so
 * the app keeps working when hosted under a sub-path (BASE_PATH=/foo/).
 */
const OCR_PROXY_URL = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/ocr`;

// Drop caches from older schema versions. v4 added the model tier to the key and
// began storing the model's real confidence alongside the content, so a v3 entry
// cannot be reused: it would report a fabricated 0.92.
localforage.keys().then((keys) => {
  keys.forEach((key) => {
    if (key.startsWith("ocr_cache_") && !key.startsWith("ocr_cache_v4_")) {
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

export interface HunyuanOCRResponse {
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
  modelConfidence: number;
}

export async function processWithHunyuanOCR(
  file: File,
  mode: string,
  forceReprocess: boolean = false,
  customPrompt?: string,
  tier: OcrTier = 'default'
): Promise<HunyuanOCRResponse> {
  // Convert file to Base64
  const base64Data = await fileToBase64(file);

  // Construct prompt based on mode
  const systemPrompt = getPromptForMode(mode, customPrompt);

  // Analyze client-side image quality (resolution, contrast, edge blur)
  const imageQuality = await analyzeImageQuality(file);

  const isPdf = file.type === "application/pdf";

  // The tier is part of the cache key. The premium tier exists to produce a
  // *better* reading of the same bytes, so sharing one entry between tiers would
  // either serve the worse result or silently discard the better one.
  const cacheKey = `ocr_cache_v4_${tier}_${mode}_${await hashString(base64Data)}`;

  if (!forceReprocess) {
    try {
      const cached = await localforage.getItem<CachedExtraction>(cacheKey);
      if (cached?.content) {
        console.log(`[OCR Client] Cache hit for ${file.name} (${mode}, ${tier})`);
        return parseOCRResult(cached.content, mode, cached.modelConfidence, imageQuality);
      }
    } catch (err) {
      console.warn("Failed to read from OCR cache:", err);
    }
  } else {
    console.log(`[OCR Client] forceReprocess enabled. Bypassing cache for ${file.name}`);
  }

  // PDFs go as a `file` part, images as `image_url`. The vision `image_url`
  // field accepts png/jpeg/webp/gif only, so the PDFs this app has always
  // accepted at upload were being sent in a field that cannot carry them — every
  // PDF failed mid-batch as an unexplained "extraction failed".
  const documentPart = isPdf
    ? {
        type: "file",
        file: {
          filename: file.name || "document.pdf",
          file_data: base64Data,
        },
      }
    : {
        type: "image_url",
        image_url: {
          url: base64Data,
          // "high" tiles the image rather than reading it in one downsampled
          // pass, which is the difference between reading a dense invoice and
          // guessing at it. It costs more input tokens per page — see the quota
          // notes in .env.example.
          detail: "high",
        },
      };

  const requestBody = {
    // Deliberately no `model` field. The proxy resolves the model from `tier`,
    // because a model name accepted from the browser would let any signed-in
    // caller point the account's small premium daily quota at their own batch.
    tier,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: systemPrompt },
          documentPart,
        ],
      },
    ],
    temperature: 0.0, // Force deterministic output
    seed: 42, // Fix seed to eliminate run-to-run variance
    // Two conditions must both hold to constrain the reply to a JSON object.
    //
    // 1. `table` mode asks for a JSON *array*, but response_format=json_object
    //    requires a top-level object and parseOCRResult branches on
    //    Array.isArray for that mode. Constraining it would break table output.
    // 2. The provider rejects response_format=json_object outright unless the
    //    prompt itself mentions JSON. Every prompt in getPromptForMode does say
    //    "JSON", but `custom` mode interpolates text the user wrote, so this is
    //    checked rather than assumed — an unmet invariant here would fail every
    //    request in that mode with an error about the prompt, not the format.
    jsonObject: mode !== "table" && /json/i.test(systemPrompt),
  };

  // One request, to our own origin. There is no direct-to-provider fallback: a
  // browser cannot hold a credential, so the previous fallback published the
  // provider key to anyone who opened DevTools. A proxy failure is an error.
  const response = await fetch(OCR_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    let detail = raw.slice(0, 200);
    try {
      const parsedError = JSON.parse(raw) as OcrProxyError;
      detail = parsedError.details || parsedError.error || detail;
    } catch {
      // Not JSON, so the raw prefix above is the best detail available.
    }
    // Naming the file type matters: if the configured model does not accept
    // native PDF input, every PDF fails while every image succeeds. An
    // unqualified "extraction failed" hides that pattern completely.
    const pdfHint = isPdf
      ? " — this file is a PDF, which the configured model may not accept"
      : "";
    throw new Error(`OCR processing failed (${response.status})${pdfHint}: ${detail}`);
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

function getPromptForMode(mode: string, customPrompt?: string): string {
  const antiHallucination = `Do NOT hallucinate or guess unreadable text. If a word or field is blurry, low-quality, or ambiguous, output "[ILLEGIBLE]".`;
  switch (mode) {
    case "invoice":
      return `Perform detailed OCR extraction on this invoice document. ${antiHallucination} Extract the following fields into JSON object format: "Invoice #", "Vendor", "Dates", "Subtotal", "Tax", "Total", "Payment status". Also include an "_overall_confidence" key (float between 0.0 and 1.0) indicating your certainty. Return ONLY a valid JSON object.`;
    case "receipt":
      return `Perform detailed OCR extraction on this receipt document. ${antiHallucination} Extract fields: "Merchant", "Line items", "Tax", "Tip", "Total", "Payment method". Also include an "_overall_confidence" key (float 0.0 to 1.0). Return ONLY a valid JSON object.`;
    case "table":
      return `Extract all tabular schedule or grid data from this document. ${antiHallucination} Return a JSON array of objects representing rows and column headers.`;
    case "keyvalue":
      return `Extract all visible label-value pairs from this form. ${antiHallucination} Return a JSON object with key-value mappings. Also include an "_overall_confidence" key (float 0.0 to 1.0).`;
    case "handwriting":
      return `This image contains handwritten text (cursive, print, or mixed). Carefully transcribe ALL handwritten content, preserving paragraph structure and line breaks. ${antiHallucination} Return ONLY a valid JSON object with these keys:
- "text": The full handwritten text transcribed verbatim, preserving line breaks.
- "writing_style": One of "cursive", "print", "mixed", or "block letters".
- "language": The detected language of the handwriting.
- "legibility": One of "clear", "mostly readable", "difficult", or "poor".
- "_overall_confidence": A float between 0.0 and 1.0 representing your transcription certainty.`;
    case "multilingual":
      return `This image may contain text in one or more non-English languages or scripts. ${antiHallucination} First, detect the language(s) and script(s) present. Then transcribe ALL visible text in the original language verbatim. Finally, provide an English translation. Return ONLY a valid JSON object with these keys:
- "detected_languages": An array of detected language names (e.g. ["Arabic", "English"]).
- "detected_scripts": An array of script names (e.g. ["Arabic", "Latin"]).
- "original_text": The full text transcribed verbatim in the original language, preserving line breaks.
- "english_translation": An accurate English translation of the full text.
- "_overall_confidence": A float between 0.0 and 1.0 representing your transcription certainty.`;
    case "vqa":
      if (customPrompt && customPrompt.trim().length > 0) {
        return `You are a visual question answering AI. Look at this image carefully and answer the following question(s) based ONLY on what you can see:\n<question>\n${customPrompt.trim()}\n</question>\n\n${antiHallucination}\n\nCRITICAL OUTPUT RULES:\n1. Return ONLY a valid, parseable JSON object.\n2. Do NOT wrap your output in markdown code blocks.\n3. Do NOT output any conversational preamble.\n4. Answer each question as a separate key-value pair in the JSON.\n5. If the answer cannot be determined from the image, set the value to "Cannot determine from image".\n6. Include an "_overall_confidence" key (float 0.0 to 1.0).`;
      }
      return `You are a visual question answering AI. Look at this image carefully and provide a detailed analysis. ${antiHallucination} Return ONLY a valid JSON object with these keys:\n- "document_type": What type of document or image this is.\n- "key_information": The most important information visible.\n- "visual_elements": Description of visual elements (logos, stamps, signatures, photos).\n- "text_summary": A concise summary of all visible text.\n- "_overall_confidence": A float between 0.0 and 1.0.`;
    case "custom":
      if (customPrompt && customPrompt.trim().length > 0) {
        return `You are a highly precise data extraction AI. Follow these user extraction instructions strictly:\n<user_instructions>\n${customPrompt.trim()}\n</user_instructions>\n\n${antiHallucination}\n\nCRITICAL OUTPUT RULES:\n1. Return ONLY a valid, parseable JSON object.\n2. Do NOT wrap your output in markdown code blocks (e.g., no \`\`\`json). Output the raw curly braces directly.\n3. Do NOT output any conversational preamble, greetings, or explanations.\n4. If a specifically requested field is completely missing from the document, set its value to null.\n5. Include an "_overall_confidence" key (float 0.0 to 1.0) indicating your certainty.`;
      }
      // Fallback if the user left the prompt empty
      return `You are a highly precise data extraction AI. Extract all relevant information from this document.\n\n${antiHallucination}\n\nCRITICAL OUTPUT RULES:\n1. Return ONLY a valid, parseable JSON object with key-value pairs.\n2. Do NOT wrap your output in markdown code blocks.\n3. Do NOT output any conversational preamble.\n4. Include an "_overall_confidence" key (float 0.0 to 1.0).`;
    case "fulltext":
    default:
      return `Perform OCR text extraction and visual analysis on this image. ${antiHallucination} Return ONLY a valid JSON object with these keys:
- "image_description": A concise visual summary describing what the image depicts (e.g., object, visual appearance, document type, layout, colors).
- "text": All visible printed or written text transcribed verbatim from the image, preserving line breaks. Do NOT mix the image description into this text key.
- "confidence": A float between 0.0 and 1.0 representing your overall transcription certainty.`;
  }
}

/**
 * Keys the model uses to report its own certainty. They are signals, not
 * extracted data — previously they leaked into the table as columns, so a
 * document ended up with a "CONFIDENCE" column holding "0.9", which then got a
 * confidence bar of its own.
 */
const META_CONFIDENCE_KEYS = ['_overall_confidence', 'overall_confidence', '_confidence', 'confidence'];

/**
 * Pulls a meta confidence value out of a parsed object and removes it, so it is
 * never presented as extracted content. Only accepts a plausible 0-1 score.
 */
function takeMetaConfidence(
  parsed: Record<string, unknown>,
): number | undefined {
  for (const key of META_CONFIDENCE_KEYS) {
    if (!(key in parsed)) continue;
    const raw = parsed[key];
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    // A lone {"confidence": ...} object is the payload, not metadata.
    const hasOtherKeys = Object.keys(parsed).length > 1;
    if (hasOtherKeys && Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) {
      delete parsed[key];
      return numeric;
    }
  }
  return undefined;
}

function joinLabel(parent: string, child: string): string {
  if (!parent) return child;
  // Avoid "Transaction Transaction Date".
  if (child.toLowerCase().startsWith(parent.toLowerCase())) return child;
  return `${parent} ${child}`;
}

/**
 * Flattens a nested extraction result into label/value pairs.
 *
 * The model returns structures like
 *   {"Transaction": {"Date": "...", "ID": "..."}}
 * and the previous code JSON.stringify'd the inner object into a single cell, so
 * the table showed `{"Date":"09 February...` instead of usable columns.
 */
function flattenExtraction(
  value: unknown,
  prefix = '',
  depth = 0,
): Array<[string, string]> {
  const MAX_DEPTH = 4;

  if (value === null || value === undefined) {
    return prefix ? [[prefix, '']] : [];
  }

  if (typeof value !== 'object') {
    return [[prefix || 'Value', String(value)]];
  }

  if (depth >= MAX_DEPTH) {
    return [[prefix || 'Value', JSON.stringify(value)]];
  }

  if (Array.isArray(value)) {
    // All-scalar arrays read best as one joined cell ("Sent to": [name, phone]).
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return [[prefix || 'Value', value.map((item) => String(item ?? '')).join(', ')]];
    }
    // Arrays of objects (line items) become numbered columns.
    return value.flatMap((item, index) =>
      flattenExtraction(item, joinLabel(prefix, `${index + 1}`), depth + 1),
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return prefix ? [[prefix, '']] : [];
  }

  return entries.flatMap(([key, child]) =>
    flattenExtraction(child, joinLabel(prefix, key), depth + 1),
  );
}
function splitPreambleFromText(text: string): { descFromText?: string; cleanText: string } {
  if (!text) return { cleanText: "" };
  
  // Detect conversational LLM preamble describing the image before the extracted content
  const regex = /^((?:the|this)\s+(?:image|document|photo|picture)\s+(?:depicts|shows|contains|features|is a|displays|illustrates)[\s\S]*?)(?=(?:indicating the following details:|showing the following text:|with text:|containing:|details:|\n\n|\s*-\s*\*\*|\s*\*\*\w+|\s*-\s+[A-Z]))/i;

  const match = text.match(regex);
  if (match) {
    const preamble = match[1].trim();
    const rest = text.slice(match[1].length).replace(/^(?:indicating the following details:|showing the following text:|with text:|containing:|details:|\s*:)\s*/i, "").trim();
    if (rest.length > 0 && preamble.length > 15) {
      return {
        descFromText: preamble,
        cleanText: rest
      };
    }
  }
  return { cleanText: text };
}

export function parseOCRResult(
  content: string, 
  mode?: string,
  rawModelConfidence: number = 0.92,
  imageQuality?: ImageQualityMetrics
): HunyuanOCRResponse {
  let fields: HunyuanOCRResponse["fields"] = [];
  let rows: Record<string, unknown>[] = [];
  let rawText = content;

  try {
    // Robustly extract JSON block even if preceded/followed by LLM text
    let jsonStr = content;
    
    // First, look for standard markdown blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    } else {
      // Fallback: aggressively locate the first and last structural brackets
      const firstBrace = content.indexOf("{");
      const firstBracket = content.indexOf("[");
      const lastBrace = content.lastIndexOf("}");
      const lastBracket = content.lastIndexOf("]");

      const hasObj = firstBrace !== -1 && lastBrace !== -1;
      const hasArr = firstBracket !== -1 && lastBracket !== -1;

      if (hasObj && hasArr) {
        // Find which structure encompasses the most content
        if (firstBrace < firstBracket && lastBrace > lastBracket) {
          jsonStr = content.substring(firstBrace, lastBrace + 1);
        } else {
          jsonStr = content.substring(firstBracket, lastBracket + 1);
        }
      } else if (hasObj) {
        jsonStr = content.substring(firstBrace, lastBrace + 1);
      } else if (hasArr) {
        jsonStr = content.substring(firstBracket, lastBracket + 1);
      }
    }

    const parsed = JSON.parse(jsonStr.trim());

    if (mode === "fulltext" || mode === undefined) {
      const parsedObj = (typeof parsed === "object" && parsed !== null) ? (parsed as Record<string, any>) : {};
      const rawDescription = parsedObj.image_description || parsedObj.description || parsedObj.visual_summary;
      const rawTextContent = parsedObj.text || parsedObj.extracted_text || parsedObj.transcription || (typeof parsed === "string" ? parsed : "");

      const { descFromText, cleanText } = splitPreambleFromText(String(rawTextContent));
      const finalDescription = rawDescription ? String(rawDescription) : descFromText;
      const finalExtractedText = cleanText || String(rawTextContent);
      const confScore = typeof parsedObj.confidence === "number" ? parsedObj.confidence : rawModelConfidence;

      const fieldsList: HunyuanOCRResponse["fields"] = [];

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

    let globalConfidence = rawModelConfidence;

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

      // Columns are the union across every row, in order of first appearance —
      // taking only the first row dropped fields that appeared later.
      const seen = new Set<string>();
      const ordered: Array<[string, string]> = [];
      for (const row of flattenedRows) {
        for (const [label, val] of Object.entries(row)) {
          if (seen.has(label)) continue;
          seen.add(label);
          ordered.push([label, String(val ?? '')]);
        }
      }

      fields = ordered.map(([key, strVal], index) => {
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

