/**
 * Context assembly for the agent loop.
 *
 * Problems solved:
 * - Stale file snapshots (refreshed every iteration from store + WebContainer)
 * - Missing project files (WebContainer fallback when store lacks content)
 * - Excessive token usage (budget caps + relevant-file selection)
 * - Context duplication (single system block, compact history)
 */
import type { FileNode } from "@stores/studio-store";

export interface ContextBudget {
  /** Total character budget for the system file snapshot block. */
  maxFileContextChars: number;
  /** Per-file cap before head/tail summarization kicks in. */
  maxCharsPerFile: number;
  /** Max prior chat turns to include (user + assistant pairs). */
  maxHistoryMessages: number;
  /** Max characters for all history combined. */
  maxHistoryChars: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxFileContextChars: 14_000,
  maxCharsPerFile: 2_500,
  maxHistoryMessages: 12,
  maxHistoryChars: 6_000,
};

/** Always include these entry/config files when present. */
const PRIORITY_PATHS = [
  "package.json",
  "index.html",
  "src/main.js",
  "src/main.ts",
  "src/game.js",
  "src/game.ts",
  "vite.config.js",
  "vite.config.ts",
];

export interface FileSnapshot {
  path: string;
  content: string;
  truncated: boolean;
  source: "store" | "webcontainer";
}

export interface ContextStats {
  filesIncluded: number;
  filesOmitted: number;
  fileChars: number;
  naiveFileChars: number;
  savingsPercent: number;
}

/** Rough token estimate (≈4 chars per token for English/code mix). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Summarize an oversized file as head + tail with an omission marker. */
export function summarizeFileContent(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { text: content, truncated: false };
  }
  const head = Math.floor(maxChars * 0.55);
  const tail = Math.floor(maxChars * 0.35);
  const omitted = content.length - head - tail;
  return {
    text:
      `${content.slice(0, head)}\n` +
      `\n… [${omitted} chars omitted — use read_file for full content] …\n\n` +
      `${content.slice(-tail)}`,
    truncated: true,
  };
}

/** Extract file paths mentioned in free text (paths ending in common extensions). */
export function extractMentionedPaths(text: string): string[] {
  const matches = text.match(
    /(?:^|[\s"'`(])([\w./-]+\.(?:html|css|js|ts|jsx|tsx|json|mjs|cjs|vue|svelte|wasm|png|jpg|svg|glb|gltf))/gi,
  );
  if (!matches) return [];
  const paths = new Set<string>();
  for (const m of matches) {
    const p = m.trim().replace(/^['"`(]+|['"`)\s]+$/g, "");
    if (p && !p.startsWith("http")) paths.add(p.replace(/^\.\//, ""));
  }
  return [...paths];
}

/** Score how relevant a file is to the current turn (higher = more important). */
export function scoreFileRelevance(
  path: string,
  hints: {
    userPrompt: string;
    mentionedPaths: Set<string>;
    recentlyTouched: Set<string>;
    errorFiles: Set<string>;
  },
): number {
  let score = 0;
  const lower = path.toLowerCase();
  const prompt = hints.userPrompt.toLowerCase();

  if (PRIORITY_PATHS.includes(path)) score += 100;
  if (hints.mentionedPaths.has(path)) score += 80;
  if (hints.recentlyTouched.has(path)) score += 60;
  if (hints.errorFiles.has(path)) score += 90;

  const base = path.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
  if (base && prompt.includes(base.toLowerCase())) score += 40;

  if (lower.startsWith("src/")) score += 20;
  if (lower.startsWith("assets/")) score += 10;
  if (lower.endsWith(".json") && path !== "package.json") score -= 5;

  return score;
}

export interface SelectFilesInput {
  files: FileNode[];
  userPrompt: string;
  recentlyTouched?: string[];
  errorFiles?: string[];
  extraMentioned?: string[];
}

/** Pick and order files for inclusion under the character budget. */
export function selectRelevantFiles(input: SelectFilesInput): string[] {
  const mentioned = new Set([
    ...extractMentionedPaths(input.userPrompt),
    ...(input.extraMentioned ?? []),
  ]);
  const touched = new Set(input.recentlyTouched ?? []);
  const errorFiles = new Set(input.errorFiles ?? []);

  const filePaths = input.files
    .filter((f) => f.type === "file" && f.path)
    .map((f) => f.path as string);

  const scored = filePaths
    .map((path) => ({
      path,
      score: scoreFileRelevance(path, {
        userPrompt: input.userPrompt,
        mentionedPaths: mentioned,
        recentlyTouched: touched,
        errorFiles,
      }),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  // Always try to include priority paths first even if low score.
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const p of PRIORITY_PATHS) {
    if (filePaths.includes(p) && !seen.has(p)) {
      ordered.push(p);
      seen.add(p);
    }
  }
  for (const { path } of scored) {
    if (!seen.has(path)) {
      ordered.push(path);
      seen.add(path);
    }
  }
  return ordered;
}

export interface BuildFileContextInput {
  files: FileNode[];
  selectedPaths: string[];
  readFile: (path: string) => Promise<string | null>;
  budget?: ContextBudget;
}

/** Build the project file snapshot block under budget. */
export async function buildFileContextBlock(
  input: BuildFileContextInput,
): Promise<{ block: string; snapshots: FileSnapshot[]; stats: ContextStats }> {
  const budget = input.budget ?? DEFAULT_CONTEXT_BUDGET;
  const storeByPath = new Map(
    input.files
      .filter((f) => f.type === "file" && f.path)
      .map((f) => [f.path as string, f]),
  );

  const parts: string[] = [];
  const snapshots: FileSnapshot[] = [];
  let total = 0;
  let naiveTotal = 0;
  let omitted = 0;

  for (const path of input.selectedPaths) {
    const node = storeByPath.get(path);
    let content: string | null = node?.content ?? null;
    let source: "store" | "webcontainer" = "store";

    if (content == null) {
      content = await input.readFile(path);
      source = "webcontainer";
    }

    if (content == null) {
      omitted++;
      continue;
    }

    naiveTotal += content.length + path.length + 20;

    const remaining = budget.maxFileContextChars - total;
    if (remaining < 200) {
      omitted += input.selectedPaths.length - snapshots.length;
      break;
    }

    const perFileCap = Math.min(budget.maxCharsPerFile, remaining - 50);
    const { text, truncated } = summarizeFileContent(content, perFileCap);
    const chunk = `--- ${path}${truncated ? " (summarized)" : ""} ---\n${text}`;
    if (total + chunk.length > budget.maxFileContextChars) {
      omitted++;
      continue;
    }

    parts.push(chunk);
    snapshots.push({ path, content: text, truncated, source });
    total += chunk.length;
  }

  omitted += input.selectedPaths.length - snapshots.length - omitted;
  if (omitted < 0) omitted = input.selectedPaths.length - snapshots.length;

  const savingsPercent =
    naiveTotal > 0 ? Math.round(((naiveTotal - total) / naiveTotal) * 100) : 0;

  const indexLine =
    snapshots.length > 0
      ? `Included ${snapshots.length} file(s)` +
        (omitted > 0 ? ` (${omitted} omitted — use read_file)` : "") +
        `. ~${estimateTokens(total)} tokens.\n\n`
      : "No file contents loaded — use read_file before editing.\n\n";

  return {
    block: indexLine + parts.join("\n\n"),
    snapshots,
    stats: {
      filesIncluded: snapshots.length,
      filesOmitted: Math.max(0, input.selectedPaths.length - snapshots.length),
      fileChars: total,
      naiveFileChars: naiveTotal,
      savingsPercent,
    },
  };
}

/** Format the system message with fresh project context. */
export function formatSystemContext(fileBlock: string): string {
  return (
    `Current project files (refreshed this turn — prefer read_file before editing):\n` +
    fileBlock
  );
}

/** Collect paths recently written or read in the conversation. */
export function collectTouchedPaths(messages: Array<{ role: string; content: string }>): string[] {
  const paths = new Set<string>();
  const pathRe =
    /(?:File written:|Contents of|read |fixing |---\s*)\s*([\w./-]+\.(?:html|css|js|ts|jsx|tsx|json|mjs|cjs))/gi;
  for (const m of messages) {
    for (const match of m.content.matchAll(pathRe)) {
      if (match[1]) paths.add(match[1].replace(/^\.\//, ""));
    }
  }
  return [...paths];
}
