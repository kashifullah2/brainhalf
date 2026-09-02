const META_CONFIDENCE_KEYS = ['_overall_confidence', 'overall_confidence', '_confidence', 'confidence'];

export function takeMetaConfidence(
  parsed: Record<string, unknown>,
): number | undefined {
  for (const key of META_CONFIDENCE_KEYS) {
    if (!(key in parsed)) continue;
    const raw = parsed[key];
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    const hasOtherKeys = Object.keys(parsed).length > 1;
    if (hasOtherKeys && Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) {
      delete parsed[key];
      return numeric;
    }
  }
  return undefined;
}

export function extractJsonBlock(content: string): string {
  let jsonStr = content;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    return jsonMatch[1];
  }
  const firstBrace = content.indexOf("{");
  const firstBracket = content.indexOf("[");
  const lastBrace = content.lastIndexOf("}");
  const lastBracket = content.lastIndexOf("]");
  
  const hasObj = firstBrace !== -1 && lastBrace !== -1;
  const hasArr = firstBracket !== -1 && lastBracket !== -1;
  
  if (hasObj && hasArr) {
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
  return jsonStr;
}

export function joinLabel(parent: string, child: string): string {
  if (!parent) return child;
  if (child.toLowerCase().startsWith(parent.toLowerCase())) return child;
  return `${parent} ${child}`;
}

export function flattenExtraction(
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
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return [[prefix || 'Value', value.map((item) => String(item ?? '')).join(', ')]];
    }
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

export function splitPreambleFromText(text: string): { descFromText?: string; cleanText: string } {
  if (!text) return { cleanText: "" };
  const regex = /^((?:the|this)\s+(?:image|document|photo|picture)\s+(?:depicts|shows|contains|features|is a|displays|illustrates)[\s\S]*?)(?=(?:indicating the following details:|showing the following text:|with text:|containing:|details:|\n\n|\s*-\s*\*\*|\s*\*\*\w+|\s*-\s+[A-Z]))/i;
  const match = text.match(regex);
  if (match) {
    const preamble = match[1].trim();
    const rest = text.slice(match[1].length).replace(/^(?:indicating the following details:|showing the following text:|with text:|containing:|details:|\s*:)\s*/i, "").trim();
    if (rest.length > 0 && preamble.length > 15) {
      return { descFromText: preamble, cleanText: rest };
    }
  }
  return { cleanText: text };
}
