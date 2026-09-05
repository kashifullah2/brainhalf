/**
 * Error normalization layer.
 *
 * Raw error text arrives from many sources (Vite dev server, esbuild, npm,
 * the preview iframe runtime, command output). This module turns that noisy,
 * ANSI-colored, multi-line text into a consistent `NormalizedError[]` the agent
 * can reason about, and renders a compact prompt block for the model.
 *
 * Kept dependency-free and pure so it is trivially unit-testable.
 */

export type ErrorCategory =
  | "vite"
  | "build"
  | "typescript"
  | "runtime"
  | "console"
  | "command"
  | "dependency"
  | "unknown";

export interface NormalizedError {
  category: ErrorCategory;
  message: string;
  /** Project-relative file path when one can be extracted. */
  file?: string;
  line?: number;
  column?: number;
  /** The original (ANSI-stripped) text this was parsed from. */
  raw: string;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** Strips ANSI color codes and trailing whitespace from a chunk of output. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

/** Collapses an absolute WebContainer path to a project-relative one. */
export function toProjectRelative(file: string): string {
  let f = file.trim().replace(/\\/g, "/");
  f = f.replace(/^[a-zA-Z]:\//, "/");

  // WebContainer mounts projects at /home/projects/<id>/… — strip the root AND
  // the per-project folder so we get a path relative to the project itself.
  const projectsMatch = f.match(/\/home\/projects\/[^/]+\/(.+)$/);
  if (projectsMatch) {
    f = projectsMatch[1];
  } else {
    for (const m of ["/home/", "/app/", "/project/"]) {
      const idx = f.indexOf(m);
      if (idx !== -1) {
        f = f.slice(idx + m.length);
        break;
      }
    }
  }
  return f.replace(/^\.\//, "").replace(/^\//, "");
}

/** Extracts `path:line:col` or `path:line` from a string, if present. */
function extractLocation(
  text: string,
): { file?: string; line?: number; column?: number } {
  // e.g. src/main.js:12:21  or  /home/projects/x/src/a.ts:3
  const m = text.match(/([\w./\-@]+\.(?:js|ts|jsx|tsx|mjs|cjs|css|html|vue|svelte)):(\d+)(?::(\d+))?/);
  if (!m) return {};
  return {
    file: toProjectRelative(m[1]),
    line: Number(m[2]),
    column: m[3] ? Number(m[3]) : undefined,
  };
}

/** Classifies a single (already ANSI-stripped) error block into a category. */
export function classifyError(raw: string): ErrorCategory {
  const t = raw.toLowerCase();

  if (/error\s+ts\d{2,5}:/.test(t) || /\bts\d{2,5}\b/.test(t)) return "typescript";
  if (
    t.includes("failed to resolve import") ||
    t.includes("[vite]") ||
    t.includes("vite:import-analysis") ||
    t.includes("internal server error") ||
    t.includes("pre-transform error")
  ) {
    return "vite";
  }
  if (
    t.includes("npm err") ||
    t.includes("eresolve") ||
    t.includes("could not resolve dependency") ||
    t.includes("cannot find module") ||
    t.includes("module not found") ||
    t.includes("enoent")
  ) {
    return "dependency";
  }
  if (
    t.includes("transform failed") ||
    t.includes("build failed") ||
    t.includes("rollup") ||
    t.includes("esbuild") ||
    t.startsWith("error:")
  ) {
    return "build";
  }
  if (
    t.includes("uncaught exception") ||
    t.includes("unhandled promise rejection") ||
    t.includes("uncaught ") ||
    /\b(referenceerror|typeerror|syntaxerror|rangeerror)\b/.test(t)
  ) {
    return "runtime";
  }
  if (t.includes("console.error")) return "console";
  return "unknown";
}

/** Trims a raw block down to a single human-readable headline message. */
function deriveMessage(raw: string, category: ErrorCategory): string {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return raw.trim();

  // Prefer the first line that actually describes the failure.
  const meaningful =
    lines.find((l) =>
      /(error|failed|cannot|unexpected|not found|is not defined|exception|rejection)/i.test(
        l,
      ),
    ) ?? lines[0];

  // Strip leading source prefixes the headline doesn't need.
  let msg = meaningful
    .replace(/^\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)?\s*/i, "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^console\.error:\s*/i, "")
    .trim();

  if (category === "dependency") {
    msg = msg.replace(/^npm err!\s*/i, "");
  }
  return msg || meaningful;
}

/**
 * Normalizes a single raw error block into a structured error.
 * `hint` biases classification when the source is already known.
 */
export function normalizeError(
  rawInput: string,
  hint?: ErrorCategory,
): NormalizedError {
  const raw = stripAnsi(rawInput).trim();
  const category = hint && hint !== "unknown" ? hint : classifyError(raw);
  const loc = extractLocation(raw);
  return {
    category,
    message: deriveMessage(raw, category),
    file: loc.file,
    line: loc.line,
    column: loc.column,
    raw: raw.slice(0, 1200),
  };
}

/**
 * Normalizes many raw blocks, dropping empties and de-duplicating by
 * (category + message + file). Order is preserved (first occurrence wins).
 */
export function normalizeErrors(
  raws: Array<string | { text: string; hint?: ErrorCategory }>,
): NormalizedError[] {
  const seen = new Set<string>();
  const out: NormalizedError[] = [];
  for (const item of raws) {
    const text = typeof item === "string" ? item : item.text;
    const hint = typeof item === "string" ? undefined : item.hint;
    if (!text || !text.trim()) continue;
    const norm = normalizeError(text, hint);
    if (!norm.message) continue;
    const key = `${norm.category}|${norm.message}|${norm.file ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

/** Renders normalized errors into a compact, model-friendly prompt block. */
export function formatErrorsForPrompt(errors: NormalizedError[]): string {
  if (errors.length === 0) return "";
  return errors
    .map((e, i) => {
      const loc = e.file
        ? ` (${e.file}${e.line ? `:${e.line}${e.column ? `:${e.column}` : ""}` : ""})`
        : "";
      return `${i + 1}. [${e.category}]${loc} ${e.message}`;
    })
    .join("\n");
}

/** Short one-line summary for UI/logging (e.g. "2 vite, 1 runtime"). */
export function summarizeErrors(errors: NormalizedError[]): string {
  if (errors.length === 0) return "no errors";
  const counts = new Map<ErrorCategory, number>();
  for (const e of errors) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  return [...counts.entries()].map(([cat, n]) => `${n} ${cat}`).join(", ");
}
