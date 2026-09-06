// ---------------------------------------------------------------------------
// Confidence scoring — the pure half.
//
// This logic used to live only in src/lib/confidence-scorer.ts, which meant the
// queue consumer could not reach it: queue-worker/src/index.ts inserted every
// extracted field with no confidence at all, so sanitizeFields() defaulted them
// to 0. Every field of every queue-processed document therefore scored 0 and
// landed in the review queue, while the client-side path scored the same document
// properly. Same document, same model, two different answers depending on which
// code path ran it.
//
// Nothing here touches the DOM, so both paths import it. analyzeImageQuality()
// stays in src/lib/confidence-scorer.ts, which re-exports everything below —
// it needs a canvas, and the worker has no image to measure anyway.
// ---------------------------------------------------------------------------

export interface ImageQualityMetrics {
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  contrastScore?: number; // 0 to 1
  blurScore?: number;     // 0 (blurry) to 1 (sharp)
}

export interface ConfidenceDetails {
  score: number; // 0.0 to 1.0
  /** Null when the provider returned no certainty signal for this extraction. */
  modelScore: number | null;
  patternScore: number;
  qualityScore: number;
  flags: string[];
}

/**
 * The model's own certainty, or null when the provider did not give us one.
 *
 * This used to return a hardcoded 0.92 in that case, which was not a default so
 * much as a fabrication with consequences. The default OCR tier does not support
 * logprobs, and `fulltext` mode asks for plain text rather than a JSON object
 * carrying `_overall_confidence` -- so 0.92 was the *normal* outcome, not an edge
 * case. It sits above the 0.80 review threshold, so those documents were never
 * flagged and never escalated: the "human in the loop" gate silently disengaged
 * on exactly the documents nothing had measured.
 *
 * Null propagates. calculateFieldConfidence() drops the model dimension and
 * scores on the signals that do exist, rather than blending in a guess.
 */
/**
 * The slice of an OpenAI-compatible reply this reads. Narrowed here, at the
 * boundary, rather than by typing the parameter `any` and letting an untyped
 * value spread through the function.
 */
interface CertaintyBearingReply {
  choices?: Array<{
    logprobs?: { content?: Array<{ logprob?: unknown }> } | null;
    confidence?: unknown;
  }>;
}

export function extractModelConfidence(apiResponse: unknown): number | null {
  try {
    const choice = (apiResponse as CertaintyBearingReply | null | undefined)?.choices?.[0];
    const logprobs = choice?.logprobs?.content;

    if (Array.isArray(logprobs) && logprobs.length > 0) {
      let totalProb = 0;
      let count = 0;
      for (const item of logprobs) {
        if (typeof item.logprob === "number") {
          totalProb += Math.exp(item.logprob);
          count++;
        }
      }
      if (count > 0) {
        return Math.max(0.1, Math.min(1.0, totalProb / count));
      }
    }

    if (typeof choice?.confidence === "number") {
      return choice.confidence;
    }
  } catch (e) {
    console.warn("Logprob extraction error:", e);
  }

  // No logprobs and no self-reported score. Say so instead of inventing one.
  return null;
}


/**
 * Currency prefixes/suffixes seen in real documents. The previous single
 * character class ([-$€£¥₹]) rejected every multi-character
 * marker, so "Rs. 10,000.00" scored as an invalid amount and a perfectly clean
 * value was routed to the review queue.
 */
const CURRENCY_MARKERS = [
  'rs.', 'rs', 'pkr', 'inr', 'usd', 'eur', 'gbp', 'jpy', 'aed', 'sar', 'cad',
  'aud', 'chf', 'cny', 'try', 'zar', 'ngn', 'kes', 'bdt', 'lkr', 'npr',
  '$', '€', '£', '¥', '₹', '₨', '₪', '₺', '₦', 'ر.س',
];

/**
 * Values that legitimately appear in a money field without being a number.
 * "Fee / Charge: No Charge" is correct data, not a failed extraction.
 */
const NON_NUMERIC_MONEY_VALUES = new Set([
  'no charge', 'free', 'nil', 'none', 'waived', 'n/a', 'na', 'not applicable',
  '0', '-', '—',
]);

/** Splits a field name into lowercase word tokens. */
function tokenize(fieldName: string): string[] {
  return fieldName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

type FieldKind =
  | 'date'
  | 'money'
  | 'email'
  | 'phone'
  | 'taxId'
  | 'reference'
  | 'text';

const DATE_TOKENS = new Set(['date', 'dated', 'time', 'created', 'due', 'issued', 'expiry', 'expires']);
const MONEY_TOKENS = new Set([
  'total', 'amount', 'subtotal', 'price', 'tip', 'cost', 'balance', 'rate',
  'fee', 'charge', 'paid', 'payable', 'discount', 'gross', 'net',
]);
const TAX_ID_TOKENS = new Set(['ein', 'vat', 'ntn', 'gst', 'tin', 'abn', 'registration']);
const REFERENCE_TOKENS = new Set(['invoice', 'id', 'no', 'num', 'number', 'ref', 'reference', 'receipt', 'order', 'transaction']);

/**
 * Classifies a field by whole-word tokens rather than substring matching.
 *
 * Substring matching produced false positives that were routed to the review
 * queue: "Corporate Name" contains "rate", "Provider" contains "id", and
 * "Tax ID" was validated as a currency amount because it contains "tax".
 */
function classifyField(fieldName: string): FieldKind {
  const tokens = tokenize(fieldName);
  const has = (token: string) => tokens.includes(token);
  const hasAny = (set: Set<string>) => tokens.some((t) => set.has(t));

  // Tax identifiers first: "Tax ID" must not be read as an amount.
  if (hasAny(TAX_ID_TOKENS)) return 'taxId';
  if (has('tax') && (has('id') || has('no') || has('number'))) return 'taxId';

  if (hasAny(DATE_TOKENS)) return 'date';
  if (has('email') || has('mail')) return 'email';
  if (has('phone') || has('tel') || has('mobile') || has('msisdn')) return 'phone';
  // Bare "tax" (i.e. a tax amount) counts as money.
  if (hasAny(MONEY_TOKENS) || has('tax')) return 'money';
  if (hasAny(REFERENCE_TOKENS)) return 'reference';

  return 'text';
}

/** True when the value reads as a monetary amount in any common notation. */
function looksLikeMoney(value: string): boolean {
  let working = value.trim().toLowerCase();

  // Parenthesised negatives: (1,234.00)
  const negated = working.startsWith('(') && working.endsWith(')');
  if (negated) working = working.slice(1, -1).trim();

  // Strip a currency marker from either end.
  for (const marker of CURRENCY_MARKERS) {
    if (working.startsWith(marker)) {
      working = working.slice(marker.length).trim();
      break;
    }
    if (working.endsWith(marker)) {
      working = working.slice(0, -marker.length).trim();
      break;
    }
  }

  working = working.replace(/^[-+]/, '').trim();
  if (!working) return false;

  // Grouped (1,234,567.89 / 1.234.567,89) or plain (1234.56) notation.
  return (
    // \u00A0 is a non-breaking space: some locales group thousands with one,
    // and it was previously written here as a literal invisible character.
    /^\d{1,3}(?:[,\u00A0 ]\d{3})*(?:[.,]\d{1,3})?$/.test(working) ||
    /^\d+(?:[.,]\d{1,3})?$/.test(working)
  );
}

/**
 * Calculates a field-level confidence score blending model certainty, pattern validation, and quality signals.
 */
export function calculateFieldConfidence(
  fieldName: string,
  value: string | null | undefined,
  rawModelConfidence: number | null = null,
  imageQuality?: ImageQualityMetrics
): ConfidenceDetails {
  const flags: string[] = [];
  const strVal = String(value ?? "").trim();

  // ---------------------------------------------------------------------------
  // 1. Model Certainty Signal (Weight: 35%, or 0% when there is no signal)
  // ---------------------------------------------------------------------------
  const modelScore =
    rawModelConfidence === null
      ? null
      : Math.max(0.05, Math.min(1.0, rawModelConfidence));

  if (modelScore === null) {
    flags.push("No model certainty signal — scored on pattern and image quality only");
  }

  // ---------------------------------------------------------------------------
  // 2. Pattern & Semantic Type Validation (Weight: 40%)
  // ---------------------------------------------------------------------------
  let patternScore = 1.0;

  if (!strVal || strVal === "—" || strVal.toLowerCase() === "null" || strVal.toLowerCase() === "undefined") {
    patternScore = 0.1;
    flags.push("Missing / empty value");
  } else if (strVal.includes("[ILLEGIBLE]")) {
    patternScore = 0.15;
    flags.push("Marked illegible by OCR engine");
  } else {
    switch (classifyField(fieldName)) {
      case 'date': {
        const isValidDate =
          !isNaN(Date.parse(strVal)) ||
          /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(strVal) ||
          // "09 February 2024", "February 9, 2024", "2:15 AM"
          /\d{1,2}\s+[a-z]{3,}\s+\d{2,4}/i.test(strVal) ||
          /[a-z]{3,}\s+\d{1,2},?\s+\d{2,4}/i.test(strVal) ||
          /^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(strVal);
        if (isValidDate) {
          patternScore = 1.0;
        } else {
          patternScore = 0.25;
          flags.push("Invalid date pattern");
        }
        break;
      }

      case 'money': {
        if (looksLikeMoney(strVal)) {
          patternScore = 1.0;
        } else if (NON_NUMERIC_MONEY_VALUES.has(strVal.toLowerCase())) {
          // Legitimate, just not a number. Do not treat as an error.
          patternScore = 0.9;
        } else {
          patternScore = 0.3;
          flags.push("Invalid numeric / currency structure");
        }
        break;
      }

      case 'email': {
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strVal)) {
          patternScore = 1.0;
        } else {
          patternScore = 0.2;
          flags.push("Invalid email format");
        }
        break;
      }

      case 'phone': {
        const digits = strVal.replace(/[^0-9]/g, "");
        // 7-15 digits covers national and E.164 international numbers.
        if (digits.length >= 7 && digits.length <= 15) {
          patternScore = 1.0;
        } else {
          patternScore = 0.4;
          flags.push("Invalid phone format");
        }
        break;
      }

      case 'taxId': {
        if (/^[A-Z0-9][A-Z0-9.\-/]{3,24}$/i.test(strVal)) {
          patternScore = 0.95;
        } else {
          patternScore = 0.45;
          flags.push("Suspicious tax ID structure");
        }
        break;
      }

      case 'reference': {
        if (strVal.length >= 2 && !/\s{4,}/.test(strVal)) {
          patternScore = 0.95;
        } else {
          patternScore = 0.4;
          flags.push("Suspicious reference number");
        }
        break;
      }

      case 'text':
      default:
        patternScore = 1.0;
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Text Quality & Hallucination / Gibberish Detection (Weight: 25%)
  // ---------------------------------------------------------------------------
  let qualityScore = 1.0;

  if (strVal) {
    // Gibberish Check 1: Excessive Character Repetition (e.g., "aaaaa" or "121212121212")
    if (/(.)\1{4,}/.test(strVal) || /(\w{2,4})\1{3,}/.test(strVal)) {
      qualityScore -= 0.5;
      flags.push("Repetitive character pattern / potential hallucination");
    }

    // Gibberish Check 2: Repeated Word Hallucination (e.g., "Total Total Total")
    if (/\b(\w+)\s+\1\s+\1\b/i.test(strVal)) {
      qualityScore -= 0.45;
      flags.push("Repeated word sequence");
    }

    // Gibberish Check 3: Excessive Special Character Noise Ratio
    const specialChars = (strVal.match(/[^a-zA-Z0-9\s.,$/#-]/g) || []).length;
    const specialRatio = specialChars / strVal.length;
    if (specialRatio > 0.3) {
      qualityScore -= 0.4;
      flags.push("High special character noise ratio");
    }

    // Gibberish Check 4: Shannon Character Entropy (detects random keyboard mashing)
    const entropy = calculateEntropy(strVal);
    if (strVal.length > 8 && (entropy < 1.5 || entropy > 5.0)) {
      qualityScore -= 0.35;
      flags.push("Abnormal text entropy (potential gibberish)");
    }

    // Image Quality Signals: Resolution, Contrast, Blur
    if (imageQuality) {
      if (imageQuality.width && imageQuality.width < 600) {
        qualityScore -= 0.15;
        flags.push("Low document resolution (<600px)");
      }
      if (imageQuality.contrastScore !== undefined && imageQuality.contrastScore < 0.3) {
        qualityScore -= 0.15;
        flags.push("Low contrast document");
      }
      if (imageQuality.blurScore !== undefined && imageQuality.blurScore < 0.25) {
        qualityScore -= 0.2;
        flags.push("Blurry document image");
      }
    }
  } else {
    qualityScore = 0.1;
  }

  qualityScore = Math.max(0, qualityScore);

  // ---------------------------------------------------------------------------
  // Blend: 35% model, 40% pattern, 25% quality.
  //
  // With no model signal the remaining two are renormalised over their own weight
  // (0.40 + 0.25 = 0.65) rather than a placeholder being blended in for the third.
  // Substituting a number for a measurement that was never taken is what produced
  // a fabricated 0.92 on every unmeasured document; weighting on what is actually
  // known keeps the score meaningful and keeps a genuinely bad extraction low.
  // ---------------------------------------------------------------------------
  const MODEL_WEIGHT = 0.35;
  const PATTERN_WEIGHT = 0.40;
  const QUALITY_WEIGHT = 0.25;

  const finalScore = Number(
    (modelScore === null
      ? (patternScore * PATTERN_WEIGHT + qualityScore * QUALITY_WEIGHT) /
        (PATTERN_WEIGHT + QUALITY_WEIGHT)
      : modelScore * MODEL_WEIGHT +
        patternScore * PATTERN_WEIGHT +
        qualityScore * QUALITY_WEIGHT
    ).toFixed(2)
  );

  return {
    score: Math.max(0.05, Math.min(1.0, finalScore)),
    modelScore,
    patternScore,
    qualityScore,
    flags,
  };
}

/**
 * Calculates average document confidence score across all fields.
 */
export function calculateDocumentOverallConfidence(
  fields: Array<{ confidence: number }>,
  rawText?: string
): number {
  if (!fields || fields.length === 0) return 0.5;

  const totalFieldConf = fields.reduce((acc, f) => acc + (f.confidence || 0), 0);
  let avgConf = totalFieldConf / fields.length;

  // Penalize if raw OCR text has signs of hallucination / gibberish
  if (rawText) {
    if (rawText.includes("[ILLEGIBLE]")) {
      avgConf *= 0.85;
    }
    if (/(.)\1{6,}/.test(rawText) || /\b(\w+)\s+\1\s+\1\b/i.test(rawText)) {
      avgConf *= 0.75;
    }
  }

  return Number(Math.max(0.05, Math.min(1.0, avgConf)).toFixed(2));
}

// ---------------------------------------------------------------------------
// Cross-Field Mathematical Validation
//
// Checks arithmetic relationships between extracted fields so discrepancies
// caused by vendor typos or blurred scans surface immediately rather than
// after an accountant enters them into an ERP.
// ---------------------------------------------------------------------------

export interface MathWarning {
  /** Human-readable explanation of the discrepancy. */
  message: string;
  /** Which fields are involved, so the UI can highlight them. */
  involvedFields: string[];
  /** The expected value, computed from the other fields. */
  expected: string;
  /** What the document actually says. */
  actual: string;
}

/**
 * Strips currency markers and grouping separators from a value and returns
 * the underlying number, or NaN if the string is not numeric.
 */
function parseMoneyValue(raw: string): number {
  if (!raw) return NaN;
  let working = raw.trim().toLowerCase();

  // Parenthesised negatives: (1,234.00)
  let isNegated = working.startsWith('(') && working.endsWith(')');
  if (isNegated) working = working.slice(1, -1).trim();

  if (working.startsWith('-')) {
    isNegated = true;
  }
  working = working.replace(/^[-+]/, '').trim();

  // Strip known currency markers from either end.
  for (const marker of CURRENCY_MARKERS) {
    if (working.startsWith(marker)) {
      working = working.slice(marker.length).trim();
      break;
    }
    if (working.endsWith(marker)) {
      working = working.slice(0, -marker.length).trim();
      break;
    }
  }

  if (working.startsWith('-')) {
    isNegated = true;
    working = working.replace(/^-/, '').trim();
  }

  if (!working) return NaN;

  // Detect European notation (1.234,56) vs US notation (1,234.56).
  const lastComma = working.lastIndexOf(',');
  const lastDot = working.lastIndexOf('.');
  if (lastComma > lastDot) {
    // European: dots are grouping, comma is decimal
    working = working.replace(/\./g, '').replace(',', '.');
  } else {
    // US / standard: commas are grouping
    working = working.replace(/,/g, '').replace(/\s/g, '');
  }

  const num = Number(working);
  return isNegated ? -num : num;
}

/**
 * Finds a field by checking if any extracted field's normalised name contains
 * one of the candidate tokens (whole-word). Returns the first match.
 */
function findFieldValue(
  fields: Array<{ normalizedField: string; value: string; editedValue?: string | null }>,
  candidates: string[],
): { name: string; value: number } | null {
  for (const field of fields) {
    const tokens = field.normalizedField.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const candidate of candidates) {
      if (tokens.includes(candidate) || field.normalizedField.toLowerCase() === candidate) {
        const raw = field.editedValue ?? field.value;
        const num = parseMoneyValue(raw);
        if (Number.isFinite(num)) {
          return { name: field.normalizedField, value: num };
        }
      }
    }
  }
  return null;
}

/**
 * Validates arithmetic relationships between extracted fields.
 *
 * Currently checks:
 *   1. Subtotal + Tax ≈ Total   (tolerance: ±$0.02 to allow rounding)
 *   2. Qty × Unit Price ≈ Amount (for line-item style extractions)
 *
 * Returns an empty array when all checks pass or when the required fields
 * are not present (non-invoice documents simply skip the check).
 */
export function validateFieldMath(
  fields: Array<{ normalizedField: string; value: string; editedValue?: string | null }>,
): MathWarning[] {
  const warnings: MathWarning[] = [];
  const TOLERANCE = 0.02; // Rounding tolerance in currency units

  // --- Check 1: Subtotal + Tax - Discount ≈ Total ------------------------
  const subtotal = findFieldValue(fields, ['subtotal', 'sub total']);
  const tax = findFieldValue(fields, ['tax', 'vat', 'gst']);
  const discount = findFieldValue(fields, ['discount']);
  const total = findFieldValue(fields, ['total', 'amount due', 'grand total']);

  if (subtotal && total) {
    // If we have either tax or discount (or both), we can validate the total
    if (tax || discount) {
      const taxVal = tax ? tax.value : 0;
      const discVal = discount ? discount.value : 0;
      const expected = subtotal.value + taxVal - discVal;
      const diff = Math.abs(expected - total.value);
      
      if (diff > TOLERANCE) {
        const parts = [];
        parts.push(`${subtotal.name} (${subtotal.value.toFixed(2)})`);
        if (tax) parts.push(`+ ${tax.name} (${taxVal.toFixed(2)})`);
        if (discount) parts.push(`− ${discount.name} (${discVal.toFixed(2)})`);
        
        warnings.push({
          message: `${parts.join(' ')} = ${expected.toFixed(2)}, but ${total.name} is ${total.value.toFixed(2)} — difference of ${diff.toFixed(2)}.`,
          involvedFields: [subtotal.name, tax?.name, discount?.name, total.name].filter(Boolean) as string[],
          expected: expected.toFixed(2),
          actual: total.value.toFixed(2),
        });
      }
    }
  }

  // --- Check 3: Reasonable Tax Rate --------------------------------------
  if (subtotal && tax && subtotal.value > 0) {
    const rate = tax.value / subtotal.value;
    // Over 40% tax is extremely rare and usually indicates a misread field
    if (rate > 0.40 || rate < 0) {
      warnings.push({
        message: `The calculated tax rate is ${(rate * 100).toFixed(1)}%, which is unusually high or negative. Please verify the ${subtotal.name} and ${tax.name} values.`,
        involvedFields: [subtotal.name, tax.name],
        expected: '0 - 40%',
        actual: `${(rate * 100).toFixed(1)}%`,
      });
    }
  }

  // --- Check 2: Qty × Unit Price ≈ Amount --------------------------------
  const qty = findFieldValue(fields, ['qty', 'quantity']);
  const unitPrice = findFieldValue(fields, ['unit price', 'price', 'rate']);
  const amount = findFieldValue(fields, ['amount', 'line total']);

  if (qty && unitPrice && amount) {
    const expected = qty.value * unitPrice.value;
    const diff = Math.abs(expected - amount.value);
    if (diff > TOLERANCE) {
      warnings.push({
        message: `${qty.name} (${qty.value}) × ${unitPrice.name} (${unitPrice.value.toFixed(2)}) = ${expected.toFixed(2)}, but ${amount.name} is ${amount.value.toFixed(2)} — difference of ${diff.toFixed(2)}.`,
        involvedFields: [qty.name, unitPrice.name, amount.name],
        expected: expected.toFixed(2),
        actual: amount.value.toFixed(2),
      });
    }
  }

  return warnings;
}

/**
 * Helper to calculate Shannon entropy of a string
 */
function calculateEntropy(str: string): number {
  const frequencies: Record<string, number> = {};
  for (const char of str) {
    frequencies[char] = (frequencies[char] || 0) + 1;
  }

  let entropy = 0;
  for (const char in frequencies) {
    const p = frequencies[char] / str.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}
