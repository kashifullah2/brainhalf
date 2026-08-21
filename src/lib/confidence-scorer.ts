/**
 * Multi-dimensional Confidence Scoring Engine
 * 
 * Blends 3 key dimensions into a realistic 0-1.0 (or 0-100%) confidence score:
 * 1. Model Certainty Signal (logprobs / self-reported confidence / token probabilities)
 * 2. Field-level Pattern & Type Validation (dates, currency, numbers, emails, phone, tax IDs)
 * 3. Text Quality & Hallucination / Gibberish Detection (entropy, repetition, illegibility, image blur & contrast)
 */

export interface ImageQualityMetrics {
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  contrastScore?: number; // 0 to 1
  blurScore?: number;     // 0 (blurry) to 1 (sharp)
}

export interface ConfidenceDetails {
  score: number; // 0.0 to 1.0
  modelScore: number;
  patternScore: number;
  qualityScore: number;
  flags: string[];
}

/**
 * Client-side Canvas Image Quality Analyzer
 * Evaluates resolution, contrast, and edge sharpness (blur) from an uploaded image File.
 */
export async function analyzeImageQuality(file: File): Promise<ImageQualityMetrics> {
  const metrics: ImageQualityMetrics = {
    fileSizeBytes: file.size,
  };

  if (!file.type.startsWith("image/")) {
    return metrics;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      metrics.width = img.naturalWidth || img.width;
      metrics.height = img.naturalHeight || img.height;

      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // Scale down for fast pixel analysis
          const sampleW = Math.min(200, metrics.width);
          const sampleH = Math.min(200, metrics.height);
          canvas.width = sampleW;
          canvas.height = sampleH;
          ctx.drawImage(img, 0, 0, sampleW, sampleH);

          const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
          const pixels = imgData.data;

          // Calculate Contrast RMS
          let sumGrayscale = 0;
          const grayscaleVals: number[] = [];
          for (let i = 0; i < pixels.length; i += 4) {
            const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            sumGrayscale += gray;
            grayscaleVals.push(gray);
          }
          const avgGray = sumGrayscale / grayscaleVals.length;
          let variance = 0;
          for (const g of grayscaleVals) {
            variance += Math.pow(g - avgGray, 2);
          }
          const rmsContrast = Math.sqrt(variance / grayscaleVals.length);
          // Normalized contrast: 0 (flat/low contrast) to 1 (high contrast)
          metrics.contrastScore = Math.min(1, Math.max(0, rmsContrast / 75));

          // Estimate Edge Sharpness (Blur Detection via horizontal pixel diff)
          let edgeDiffSum = 0;
          for (let y = 0; y < sampleH; y++) {
            for (let x = 0; x < sampleW - 1; x++) {
              const idx1 = (y * sampleW + x) * 4;
              const idx2 = (y * sampleW + x + 1) * 4;
              const g1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
              const g2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
              edgeDiffSum += Math.abs(g1 - g2);
            }
          }
          const avgEdgeDiff = edgeDiffSum / (sampleW * sampleH);
          // Sharpness score: values < 5 indicate blurry / low contrast text edges
          metrics.blurScore = Math.min(1, Math.max(0, avgEdgeDiff / 15));
        }
      } catch (e) {
        console.warn("Image canvas analysis skipped:", e);
      } finally {
        URL.revokeObjectURL(url);
        resolve(metrics);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(metrics);
    };

    img.src = url;
  });
}

/**
 * Extracts average token probability from OpenAI/Hunyuan API logprobs if available.
 */
export function extractModelConfidence(apiResponse: any): number {
  try {
    const choice = apiResponse?.choices?.[0];
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

  return 0.92; // Default baseline model confidence
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
    /^\d{1,3}(?:[,  ]\d{3})*(?:[.,]\d{1,3})?$/.test(working) ||
    /^\d+(?:[.,]\d{1,3})?$/.test(working)
  );
}

/**
 * Calculates a field-level confidence score blending model certainty, pattern validation, and quality signals.
 */
export function calculateFieldConfidence(
  fieldName: string,
  value: string | null | undefined,
  rawModelConfidence: number = 0.92,
  imageQuality?: ImageQualityMetrics
): ConfidenceDetails {
  const flags: string[] = [];
  const strVal = String(value ?? "").trim();

  // ---------------------------------------------------------------------------
  // 1. Model Certainty Signal (Weight: 35%)
  // ---------------------------------------------------------------------------
  let modelScore = Math.max(0.05, Math.min(1.0, rawModelConfidence));

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
  // Blend Scores: 35% Model, 40% Pattern, 25% Quality
  // ---------------------------------------------------------------------------
  const finalScore = Number(
    (modelScore * 0.35 + patternScore * 0.40 + qualityScore * 0.25).toFixed(2)
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
