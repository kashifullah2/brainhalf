// ---------------------------------------------------------------------------
// Extraction prompts, and the request the provider is actually sent.
//
// This lived in src/lib/ocr-client.ts, which meant the BROWSER composed the
// `messages` array and /api/ocr forwarded it upstream verbatim. Any signed-in
// user could therefore post whatever they liked -- the endpoint was general
// purpose LLM access, billed to the account, behind nothing but a session.
//
// The server owns prompt construction now. The client names a mode and hands over
// a document; everything sent upstream is built here, from values checked against
// the lists below. There is no path from a request body to the model's
// instructions any more.
//
// Lives in server/ rather than functions/ because every file under functions/
// becomes a public route. Imported by functions/api/ocr.ts and by the dev proxy
// in vite.config.ts, so development and production cannot drift.
// ---------------------------------------------------------------------------

/** Extraction presets. Must match VALID_MODES in functions/api/batches/index.ts. */
export const OCR_MODES = [
  'invoice',
  'receipt',
  'fulltext',
  'keyvalue',
  'table',
  'handwriting',
  'multilingual',
  'custom',
  'vqa',
] as const;

export type OcrMode = (typeof OCR_MODES)[number];

const MODE_SET: ReadonlySet<string> = new Set(OCR_MODES);

export function isOcrMode(value: unknown): value is OcrMode {
  return typeof value === 'string' && MODE_SET.has(value);
}

/**
 * Cap on the user's own instructions. Matches MAX_CUSTOM_PROMPT_LENGTH in
 * functions/api/batches/index.ts, so a prompt that was accepted onto a batch
 * cannot be too long to run.
 */
export const MAX_CUSTOM_PROMPT_CHARS = 4000;

/**
 * Modes whose prompt asks for a JSON *object*, and which may therefore be sent
 * response_format=json_object.
 *
 * This was inferred with `/json/i.test(prompt)`, which is a test for the word
 * rather than for the intent -- and `fulltext` fails it in the worst way. Its
 * prompt ends "Output the transcription as plain text. No JSON, no markdown
 * formatting, no code fences", which contains the string "JSON", so the constraint
 * was switched ON for the one mode that explicitly asks for plain text. The model
 * was handed two contradictory instructions and forced to return an object, which
 * is very likely why fulltext was observed inventing `image_description` / `text`
 * keys and dropping most of the page.
 *
 * `table` is excluded because it asks for a JSON array, and json_object requires a
 * top-level object.
 */
const RETURNS_JSON_OBJECT: ReadonlySet<string> = new Set<string>([
  'invoice',
  'receipt',
  'keyvalue',
  'handwriting',
  'multilingual',
  'custom',
  'vqa',
]);

/** Content types the document part may carry. Mirrors the upload allowlist. */
export const OCR_DOCUMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export function getPromptForMode(mode: string, customPrompt?: string): string {
  const antiHallucination = `Do NOT hallucinate or guess unreadable text. If a word or field is blurry, low-quality, or ambiguous, output "[ILLEGIBLE]".`;
  switch (mode) {
    case "invoice":
      return `Extract the data from this invoice. ${antiHallucination}

Return ONLY a valid JSON object, FLAT — no nested objects. Include at least: "Invoice #", "Vendor", "Dates", "Subtotal", "Tax", "Total", "Payment status". Then add a key for every OTHER labelled value printed on the document — purchase order number, billing and shipping names, terms, due date, line items, discounts — using the label as printed. Do not invent labels that are not printed. Also include an "_overall_confidence" key (float between 0.0 and 1.0).`;
    case "receipt":
      // The six named fields were a ceiling, not a floor: a payment-app
      // confirmation carries a transaction ID, a sender, a recipient, phone
      // numbers and a funding source, none of which is "Merchant" or "Tip", so
      // the mode returned almost nothing on one. The model reads those labels
      // perfectly when asked for whatever is printed, so the schema is now open
      // and flat — nesting is called out because the model otherwise buries
      // half the document under a single "Transaction" object.
      return `Extract the data from this receipt or payment confirmation. ${antiHallucination}

Return ONLY a valid JSON object, FLAT — no nested objects. Use the label printed on the document as each key, exactly as printed, and the text printed against it as the value. Cover EVERY labelled value on the document, including: merchant or service name, date, time, reference or transaction ID, sender, recipient, phone numbers, account or funding source, line items, amount, fee, tax, tip and total. Do not stop at that list if the document shows more, and do not invent labels that are not printed. Also include an "_overall_confidence" key (float 0.0 to 1.0).`;
    case "table":
      return `Extract all tabular schedule or grid data from this document. ${antiHallucination} Return a JSON array of objects representing rows and column headers.`;
    case "keyvalue":
      return `Extract every labelled value visible on this document. ${antiHallucination}

Return ONLY a valid JSON object, FLAT — no nested objects. Each key is the label exactly as printed on the document; each value is the text printed against it. Include every label present, however many there are — dates, reference and transaction IDs, names, phone numbers, addresses, account descriptions, amounts, fees and totals. Do not invent labels that are not printed. Also include an "_overall_confidence" key (float 0.0 to 1.0).`;
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
      // Plain text, deliberately NOT JSON.
      //
      // This prompt used to ask for {image_description, text, confidence}. The
      // default-tier model (hunyuan-ocr) does not honour "put the whole page in
      // this one key": on a 1080x1920 payment receipt with twenty legible lines
      // it answered `"image_description": "Transaction Successful",
      // "text": "Money has been sent"` and invented ad-hoc keys for a few of
      // the amounts. Not truncation — finish_reason was "stop" at 48 completion
      // tokens, and adding max_tokens changed nothing. Asked for plain text
      // instead, the same model on the same image returns all twenty lines,
      // including both phone numbers that every JSON variant dropped.
      //
      // parseOCRResult already handles a non-JSON response: it splits any
      // preamble off as "Image Description" and keeps the rest as
      // "Full Text Transcription", so this needs no parser change.
      return `Transcribe every piece of text in this image, line by line, from top to bottom. Include headings, labels, names, phone numbers, reference and transaction IDs, dates, times, amounts, currency symbols and footer text. Do not summarise, do not skip lines, and do not add commentary of your own. ${antiHallucination}

Output the transcription as plain text. No JSON, no markdown formatting, no code fences.`;
  }
}


/**
 * A document as the client may describe it: a base64 data URL and its filename.
 * Deliberately not a remote URL -- accepting one would have the provider fetch
 * whatever address the caller named.
 */
export interface OcrDocument {
  contentType: string;
  /** `data:<type>;base64,<payload>` */
  dataUrl: string;
  filename: string;
}

export interface UpstreamRequest {
  messages: Array<{ role: string; content: unknown[] }>;
  /** Whether the reply may be constrained to a JSON object. */
  jsonObject: boolean;
}

/**
 * Builds the upstream request for one document.
 *
 * PDFs go as a `file` part and images as `image_url`; the vision `image_url`
 * field accepts png/jpeg/webp/gif only, so a PDF sent that way fails every time.
 *
 * `jsonObject` needs two conditions to hold. The mode has to be one that asks for
 * a JSON object at all (RETURNS_JSON_OBJECT above), and the prompt has to mention
 * JSON, because the provider rejects the parameter outright otherwise -- which
 * every listed preset does, but `custom` and `vqa` interpolate text the user wrote,
 * so it is checked rather than assumed.
 */
export function buildUpstreamRequest(
  mode: OcrMode,
  customPrompt: string | undefined,
  document: OcrDocument,
): UpstreamRequest {
  const systemPrompt = getPromptForMode(mode, customPrompt);

  const documentPart =
    document.contentType === 'application/pdf'
      ? {
          type: 'file',
          file: {
            filename: document.filename || 'document.pdf',
            file_data: document.dataUrl,
          },
        }
      : {
          type: 'image_url',
          image_url: {
            url: document.dataUrl,
            // "high" tiles the image rather than reading it in one downsampled
            // pass, which is the difference between reading a dense invoice and
            // guessing at it.
            detail: 'high',
          },
        };

  return {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: systemPrompt }, documentPart],
      },
    ],
    jsonObject: RETURNS_JSON_OBJECT.has(mode) && /json/i.test(systemPrompt),
  };
}
