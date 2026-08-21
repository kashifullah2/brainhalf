// Humanizes raw OCR field keys (camelCase, snake_case, SCREAMINGCASE, or
// concatenated ALLCAPS from table-mode extraction) into readable display
// labels like "Marks Obtained".
//
// ALLCAPS strings with no separators (e.g. "MARKESOBTAINED") can't be split
// without knowing where words start, so we use a small dictionary of words
// that commonly appear on invoices, receipts, forms, and tables, and run a
// word-break segmentation. Unknown all-caps keys fall back to a single
// title-cased word rather than being left unreadable.

const WORD_DICT = new Set([
  // invoice / money
  "invoice", "number", "no", "date", "due", "amount", "total", "subtotal",
  "sub", "tax", "taxes", "rate", "price", "unit", "qty", "quantity",
  "discount", "payment", "status", "paid", "balance", "currency", "fee",
  "charge", "shipping", "cost", "deposit", "credit", "debit",
  // parties
  "vendor", "seller", "supplier", "customer", "client", "buyer", "company",
  "name", "address", "street", "city", "state", "zip", "postal", "code",
  "country", "phone", "email", "contact", "website", "bill", "billed", "to",
  "ship", "from", "sent", "by", "prepared", "received",
  // table / academic / generic form fields
  "marks", "mark", "obtained", "grade", "score", "subject", "subjects",
  "student", "roll", "class", "section", "semester", "term", "year",
  "percentage", "percent", "rank", "result", "exam", "examination",
  "description", "item", "items", "product", "service", "category", "type",
  "id", "ref", "reference", "order", "purchase", "po", "method", "card",
  "account", "bank", "note", "notes", "remarks", "comments", "signature",
  "approved", "issued", "issued", "expiry", "expiration", "start", "end",
  "first", "last", "middle", "full", "dob", "birth", "age", "gender",
  "nationality", "employee", "employer", "department", "position", "title",
  "line", "line", "tip", "merchant", "store", "register", "cashier",
  "change", "tender", "cash", "subtotal", "net", "gross", "vat", "gst",
  "cgst", "sgst", "igst", "hsn", "sac", "pan", "tin", "gstin",
  "hours", "rate", "weekly", "monthly", "annual", "daily",
  "serial", "batch", "lot", "warranty", "model", "brand", "size", "color",
  "weight", "height", "width", "length", "dimension", "dimensions",
  "out", "of", "max", "maximum", "min", "minimum", "avg", "average",
]);

// Words that stay lowercase mid-label for natural title case.
const SMALL_WORDS = new Set(["of", "the", "and", "or", "to", "by", "in", "on", "at", "for"]);

// Tokens that render in uppercase (acronyms / standard abbreviations).
const UPPERCASE_TOKENS = new Set([
  "gst", "vat", "hsn", "sac", "pan", "tin", "gstin", "cgst", "sgst", "igst",
  "dob", "po", "id", "url", "api", "pin",
]);

// Well-known keys with exact preferred labels.
const KNOWN: Record<string, string> = {
  invoiceNumber: "Invoice #",
  paymentStatus: "Payment Status",
  dueDate: "Due Date",
  amountDue: "Amount Due",
  billTo: "Bill To",
  sentBy: "Sent By",
  po: "PO #",
  vat: "VAT",
  gst: "GST",
};

function titleCaseWord(word: string, isFirst: boolean): string {
  const lower = word.toLowerCase();
  if (UPPERCASE_TOKENS.has(lower)) return lower.toUpperCase();
  if (!isFirst && SMALL_WORDS.has(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Scored word-break segmentation for a lowercase concatenated string.
// Known dictionary words score positively (scaled by length); unknown chunks
// are penalized so the splitter still isolates recognized words out of
// partially-unknown keys (e.g. "markesobtained" → "markes" + "obtained").
function segmentConcatenated(s: string): string[] {
  const n = s.length;
  const best: ({ score: number; words: string[] } | null)[] = new Array(n + 1).fill(null);
  best[0] = { score: 0, words: [] };
  for (let i = 1; i <= n; i++) {
    for (let j = 0; j < i; j++) {
      const prev = best[j];
      if (!prev) continue;
      const word = s.slice(j, i);
      const known = WORD_DICT.has(word);
      const score =
        prev.score + (known ? 10 + word.length * 3 : -(word.length * 2) - 5);
      if (!best[i] || score > best[i]!.score) {
        best[i] = { score, words: [...prev.words, word] };
      }
    }
  }
  return best[n]?.words ?? [s];
}

export function humanizeFieldLabel(key: string): string {
  if (!key) return "Field";
  if (KNOWN[key]) return KNOWN[key];

  // Already looks human (contains spaces and some lowercase) — just tidy.
  if (/[a-z]/.test(key) && /\s/.test(key.trim())) {
    return key
      .trim()
      .split(/\s+/)
      .map((w, i) => titleCaseWord(w, i === 0))
      .join(" ");
  }

  // snake_case / kebab-case / dotted
  if (/[_\-.]/.test(key)) {
    return key
      .split(/[_\-.]+/)
      .filter(Boolean)
      .map((w, i) => titleCaseWord(w, i === 0))
      .join(" ");
  }

  // Pure ALLCAPS concatenation, e.g. "MARKESOBTAINED"
  if (/^[A-Z0-9]+$/.test(key) && key.length > 1) {
    const lower = key.toLowerCase();
    if (WORD_DICT.has(lower)) return titleCaseWord(lower, true);
    // Word-break is O(n²) — cap pathological OCR junk so the UI never stalls.
    if (lower.length > 60) return titleCaseWord(lower, true);
    const segments = segmentConcatenated(lower);
    return segments.map((w, i) => titleCaseWord(w, i === 0)).join(" ");
  }

  // camelCase / PascalCase — split before capitals and number boundaries
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2");

  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => titleCaseWord(w, i === 0))
    .join(" ");
}
