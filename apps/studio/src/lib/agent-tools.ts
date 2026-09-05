/**
 * Shared agent tool helpers — validation, file I/O, fix_error logic.
 * Extracted for unit testing and consistent security checks.
 */
import type { FileNode } from "@stores/studio-store";

export const ALLOWED_SHELL_COMMANDS = ["npm", "node", "npx", "vite", "esbuild", "rollup"] as const;

/** Validate a relative project path (no traversal, no absolute). */
export function isValidPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("..")) return false;
  if (normalized.startsWith("/")) return false;
  return /^[a-zA-Z0-9/_.\-]+$/.test(normalized);
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

export function parseShellCommand(command: string): { cmd: string; args: string[] } {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const cmd = (parts[0] || "").replace(/^['"]|['"]$/g, "");
  const args = parts.slice(1).map((a) => a.replace(/^['"]|['"]$/g, ""));
  return { cmd, args };
}

export function validateShellCommand(command: string): { ok: true } | { ok: false; error: string } {
  const { cmd } = parseShellCommand(command);
  if (!cmd) return { ok: false, error: "empty command" };
  if (!ALLOWED_SHELL_COMMANDS.includes(cmd as (typeof ALLOWED_SHELL_COMMANDS)[number])) {
    return {
      ok: false,
      error: `command "${cmd}" is not allowed. Allowed: ${ALLOWED_SHELL_COMMANDS.join(", ")}.`,
    };
  }
  return { ok: true };
}

export function validatePackageName(name: string): boolean {
  return Boolean(name && /^[a-zA-Z0-9@\-/^.]+$/.test(name));
}

export interface ReadFileInput {
  path: string;
  projectFiles: FileNode[];
  readFromDisk: (path: string) => Promise<string>;
}

/** Read file preferring latest store content, falling back to WebContainer. */
export async function readProjectFile(input: ReadFileInput): Promise<
  { ok: true; content: string; source: "store" | "webcontainer" } | { ok: false; error: string }
> {
  if (!isValidPath(input.path)) {
    return { ok: false, error: `invalid path "${input.path}".` };
  }

  const normalized = input.path.replace(/^\//, "");
  const storeFile = input.projectFiles.find(
    (f) =>
      f.type === "file" &&
      (f.path === normalized || f.name === normalized || f.path === input.path),
  );

  if (storeFile?.content != null) {
    return { ok: true, content: storeFile.content, source: "store" };
  }

  try {
    const content = await input.readFromDisk(normalized);
    return { ok: true, content, source: "webcontainer" };
  } catch {
    return { ok: false, error: `file not found: ${input.path}` };
  }
}

export interface FixErrorInput {
  error: string;
  filePath: string;
  verifyCommand?: string;
  projectFiles: FileNode[];
  readFromDisk: (path: string) => Promise<string>;
  runCommand: (cmd: string, args: string[], onOutput: (d: string) => void) => Promise<number>;
  extraErrors?: string[];
  maxOutputChars?: number;
}

export interface FixErrorResult {
  report: string;
  fileRead: boolean;
  verifyExitCode: number;
}

/**
 * Fully implements fix_error: reads the suspect file, surfaces the reported
 * error + any extra runtime/build errors, runs verification, returns a structured
 * report the model can act on with create_file.
 */
export async function executeFixError(input: FixErrorInput): Promise<
  { ok: true; result: FixErrorResult } | { ok: false; error: string }
> {
  const errorMsg = input.error?.trim();
  if (!errorMsg) return { ok: false, error: "error message is required." };
  if (!input.filePath || !isValidPath(input.filePath)) {
    return { ok: false, error: `invalid file_path "${input.filePath}".` };
  }

  const verifyCommand = input.verifyCommand?.trim() || "npm run build";
  const validation = validateShellCommand(verifyCommand);
  if (!validation.ok) return { ok: false, error: validation.error };

  const read = await readProjectFile({
    path: input.filePath,
    projectFiles: input.projectFiles,
    readFromDisk: input.readFromDisk,
  });

  const maxOut = input.maxOutputChars ?? 3000;
  const maxFile = 3500;

  let report = `=== fix_error report ===\n`;
  report += `Reported error:\n${errorMsg}\n\n`;

  if (read.ok) {
    report += `File ${input.filePath} (${read.source}):\n`;
    report += truncate(read.content, maxFile);
    report += `\n\n`;
  } else {
    report += `Could not read ${input.filePath}: ${read.error}\n\n`;
  }

  if (input.extraErrors?.length) {
    report += `Additional errors from preview/build:\n`;
    report += input.extraErrors.map((e, i) => `${i + 1}. ${e}`).join("\n");
    report += `\n\n`;
  }

  const { cmd, args } = parseShellCommand(verifyCommand);
  let output = "";
  const exitCode = await input.runCommand(cmd, args, (d) => {
    output += d;
  });

  const status = exitCode === 0 ? "PASSED" : `FAILED (exit ${exitCode})`;
  report += `Verification "${verifyCommand}" ${status}.\n`;
  if (output.trim()) {
    report += `Output:\n${truncate(output, maxOut)}\n`;
  }
  report += `\nNext: diagnose the root cause above and apply a fix with create_file.`;

  return {
    ok: true,
    result: {
      report,
      fileRead: read.ok,
      verifyExitCode: exitCode,
    },
  };
}

export interface EditFileInput {
  path: string;
  old_string: string;
  new_string: string;
  projectFiles: FileNode[];
  readFromDisk: (path: string) => Promise<string>;
}

/** Apply a search/replace edit to an existing file. */
export async function applyEditFile(input: EditFileInput): Promise<
  { ok: true; content: string; replaced: number } | { ok: false; error: string }
> {
  if (!isValidPath(input.path)) {
    return { ok: false, error: `invalid path "${input.path}".` };
  }
  if (!input.old_string) {
    return { ok: false, error: "old_string is required for edit_file." };
  }

  const read = await readProjectFile({
    path: input.path,
    projectFiles: input.projectFiles,
    readFromDisk: input.readFromDisk,
  });

  if (!read.ok) {
    return { ok: false, error: read.error };
  }

  if (!read.content.includes(input.old_string)) {
    return {
      ok: false,
      error: `old_string not found in ${input.path}. Use read_file to inspect the current content.`,
    };
  }

  const replaced = read.content.split(input.old_string).length - 1;
  const content = read.content.replace(input.old_string, input.new_string);
  return { ok: true, content, replaced };
}
