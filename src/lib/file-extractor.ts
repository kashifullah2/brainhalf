import { transform } from 'sucrase';
import { normalizePath } from './utils';
import { parseEditPairs, parseMessageSegments } from './message-parser';

/**
 * Redirect source files that land outside a recognised tree prefix (/src,
 * /worker, /shared, /server, /migrations) to /src/.  The AI occasionally
 * writes <file path="/App.tsx"> or <file path="/components/Foo.tsx"> instead
 * of the correct /src/App.tsx or /src/components/Foo.tsx.  Those stray files
 * end up in the project DB, get served alongside the real /src/ tree, and
 * cause React error #130 ("element type is invalid" / rendering undefined).
 */
function redirectSrcPath(filePath: string): string {
  if (/^\/(?:src|worker|shared|server|migrations)\//.test(filePath)) return filePath;
  if (/\.(?:[cm]?[jt]sx?|css|scss|sass|less)$/.test(filePath)) return `/src${filePath}`;
  return filePath;
}
import { applyExactEdits } from './exact-edits';
import { findDanglingImports } from './preview-module-transform';
import { isConversationalPrompt, isDestructivePrompt, isQuestionPrompt, isAmbiguousPrompt } from './prompt-mode';
import { isBlockedSecretFile } from './secret-files';
import { checkShrinkage, isShrinkIntentional, logWritePath, SHRINK_OK_MARKER } from './write-guard';
import { errorMessage } from './generation-errors';
import type { WriteEpoch } from './concurrency';
import type { FlipFlopGuard, RepairLog } from './repair-budget';

export type ExtractionSummary = {
  writtenCount: number;
  deletedCount: number;
  writtenPaths: string[];
  deletedPaths: string[];
  hadSyntaxDrops: boolean;
  sawCodeLikeOutput: boolean;
  wasTruncated: boolean;
  triggerQueued: boolean;
  triggerMarker: string | null;
};

export interface ExtractorConnection {
  id: string;
  send(message: string): void;
}

export interface FileExtractorContext {
  writeEpoch: WriteEpoch;
  truncationRetries: number;
  syntaxRepairAttempts: number;
  persistRepairCounters(): void;
  isHarnessEntry(cleanPath: string): boolean;
  runSql<Row = Record<string, any>>(strings: TemplateStringsArray, ...values: any[]): Row[];
  transact<R>(closure: () => R): R;
  upsertFile(path: string, content: string): boolean;
  flipFlopGuard: FlipFlopGuard | null;
  repairLog: RepairLog | null;
  activeGeneration: { prompt?: string; epoch?: number; filesChanged?: boolean } | null;
  currentAbortController: { signal: { aborted: boolean } } | null;
  name: string;
  broadcast(message: string, exclude?: string[]): void;
  backupToR2(ownerId?: string): Promise<void>;
  senderUserId(connection: ExtractorConnection): string | undefined;
}

export const TRUNCATION_RETRY_MESSAGE = 'The previous response ended with an unfinished file. Regenerate each unfinished file from its beginning using <file path="/...">FULL FILE CONTENT</file>. Keep already completed files unchanged. Do not send a raw continuation or partial snippets.';

export const AUTO_RETRY_FULL_APP_MARKER = '[AUTO-RETRY-FULL-APP]';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SYNTAX_REPAIR_MARKER = '[AUTO-FIX] These files were discarded because of syntax errors';
const MIN_FULL_APP_RESPONSE_CHARS = 260;
const MIN_FULL_APP_RESPONSE_LINES = 5;
const MAX_TRUNCATION_RETRIES = 2;
const MAX_SYNTAX_REPAIRS = 2;

export function findUnterminatedBlock(text: string): 'file' | 'edit' | 'delete' | null {
  const lower = text.toLowerCase();
  const blocks: Array<{ kind: 'file' | 'edit' | 'delete'; open: string; closes: string[] }> = [
    { kind: 'file', open: '<file ', closes: ['</file>'] },
    { kind: 'edit', open: '<edit ', closes: ['</edit>'] },
    { kind: 'delete', open: '<delete ', closes: ['</delete>', '/>'] },
  ];
  for (const block of blocks) {
    const openAt = lower.lastIndexOf(block.open);
    if (openAt < 0) continue;
    const tail = lower.slice(openAt + block.open.length);
    if (!block.closes.some(close => tail.includes(close))) return block.kind;
  }
  return null;
}

let sendFailureCount = 0;
function noteSendFailure(error: unknown): void {
  sendFailureCount += 1;
  if (sendFailureCount <= 5 || sendFailureCount % 100 === 0) {
    console.warn(`WebSocket send failed (#${sendFailureCount}):`, error instanceof Error ? error.message : String(error));
  }
}

export class FileExtractor {
  constructor(private ctx: FileExtractorContext) {}

  private cleanCodeBlock(raw: string): string {
    let c = (raw || '').trim();
    if (c.startsWith('```')) {
      c = c.replace(/^```[a-zA-Z0-9_.-]*\r?\n/, '');
      const closingFence = c.search(/\r?\n```/);
      if (closingFence !== -1) c = c.slice(0, closingFence);
    }
    return c.trim();
  }

  private repairUnclosedBrackets(source: string): string {
    const stack: string[] = [];
    const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
    let inString: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];

      if (inLineComment) {
        if (ch === '\n') inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === '*' && next === '/') { inBlockComment = false; i++; }
        continue;
      }
      if (inString) {
        if (ch === '\\') { i++; continue; }
        if (ch === inString) inString = null;
        continue;
      }
      if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }

      if (pairs[ch]) stack.push(pairs[ch]);
      else if (ch === '}' || ch === ')' || ch === ']') {
        if (stack[stack.length - 1] === ch) stack.pop();
      }
    }

    if (stack.length === 0) return source;
    return source.trimEnd() + '\n' + stack.reverse().join('');
  }

  isLikelyShortNonAppReply(prompt: string, responseText: string): boolean {
    const trimmed = (responseText || '').trim();
    if (!trimmed) return true;

    const lineCount = trimmed.split(/\r?\n/).filter(Boolean).length;
    const looksShort = trimmed.length < MIN_FULL_APP_RESPONSE_CHARS && lineCount <= MIN_FULL_APP_RESPONSE_LINES;
    if (!looksShort) return false;

    const buildIntent = /\b(build|create|generate|make|app|website|landing|dashboard|component|feature|fix|edit|update|implement|bug)\b/i.test(prompt);
    return buildIntent;
  }

  handleIncompleteAppGeneration(opts: {
    actualPrompt: string;
    responseText: string;
    extraction: ExtractionSummary;
    connection: ExtractorConnection;
    expectFiles?: boolean;
    epoch?: number;
    deferTerminal?: (event: () => void) => void;
  }): boolean {
    const { actualPrompt, responseText, extraction, connection, expectFiles = true, epoch } = opts;

    if ((typeof epoch === 'number' && !this.ctx.writeEpoch.accepts(epoch)) || this.ctx.currentAbortController?.signal.aborted) {
      return false;
    }
    if (!expectFiles || isConversationalPrompt(actualPrompt) || isQuestionPrompt(actualPrompt) || isDestructivePrompt(actualPrompt) || isAmbiguousPrompt(actualPrompt)) return false;
    if (extraction.writtenCount > 0 || extraction.deletedCount > 0 || extraction.wasTruncated) {
      return false;
    }

    const shouldRecover =
      !extraction.sawCodeLikeOutput ||
      this.isLikelyShortNonAppReply(actualPrompt, responseText);
    if (!shouldRecover) return false;

    const alreadyRetried = actualPrompt.includes(AUTO_RETRY_FULL_APP_MARKER);
    if (alreadyRetried) {
      throw new Error('Generation returned prose instead of app files. Please retry this prompt or switch model.');
    }

    try {
      connection.send(JSON.stringify({
        type: 'generation_notice',
        message: 'Model returned a response without app files. Retrying with complete file-output instructions.',
      }));
    } catch { }

    const autoRetryMessage =
      `${AUTO_RETRY_FULL_APP_MARKER} Your previous response contained NO <file> blocks — only markdown prose or code fences. That response is being discarded. Start over.\n\n` +
      `You MUST output ONLY complete <file path="/...">FULL FILE CONTENT</file> blocks. No markdown, no explanation, no code fences, no prose of any kind before or after the file blocks.\n` +
      `Tool use is disabled for this response. Do not emit DSML, function-call markup, or any XML other than <file>, <edit>, and <delete> tags.\n` +
      `Generate EVERY file needed for a complete, runnable application. Do not truncate any file. Do not write partial implementations or placeholders.`;

    const publishRetry = () => {
      try { connection.send(JSON.stringify({ type: 'trigger-auto-reply', message: autoRetryMessage })); } catch (e) { noteSendFailure(e); }
    };
    if (opts.deferTerminal) opts.deferTerminal(publishRetry); else publishRetry();
    return true;
  }

  private collectFileWrites(text: string): { writes: Array<{ index: number; path: string; content: string }>; sawFileTag: boolean; wasTruncated: boolean } {
    const writes: Array<{ index: number; path: string; content: string }> = [];
    let sawFileTag = false;
    let wasTruncated = false;

    const tokens: Array<{ kind: 'open' | 'close'; index: number; end: number; path?: string }> = [];
    for (const m of text.matchAll(/<file\s+path=["']([^"']+)["']>/gi)) {
      tokens.push({ kind: 'open', index: m.index, end: m.index + m[0].length, path: m[1] });
    }
    for (const m of text.matchAll(/<\/file>/gi)) {
      tokens.push({ kind: 'close', index: m.index, end: m.index + m[0].length });
    }
    tokens.sort((a, b) => a.index - b.index);

    const stack: Array<{ path: string; index: number; contentStart: number; nested: boolean }> = [];
    const consumed: Array<[number, number]> = [];
    for (const token of tokens) {
      if (token.kind === 'open') {
        stack.push({ path: token.path as string, index: token.index, contentStart: token.end, nested: stack.length > 0 });
        continue;
      }
      const block = stack.pop();
      if (!block) continue;
      if (block.nested) continue;
      let filePath = redirectSrcPath(normalizePath(block.path));
      const fileContent = this.cleanCodeBlock(text.slice(block.contentStart, token.index));
      if (this.ctx.isHarnessEntry(filePath)) {
        if (/export default|function App|return \(/.test(fileContent)) {
          filePath = '/src/App.jsx';
        } else {
          continue;
        }
      }
      writes.push({ index: block.index, path: filePath, content: fileContent });
      consumed.push([block.index, token.end]);
      sawFileTag = true;
    }

    consumed.sort((a, b) => a[0] - b[0]);
    const segments: Array<{ start: number; text: string }> = [];
    let cursor = 0;
    for (const [start, end] of consumed) {
      if (start > cursor) segments.push({ start: cursor, text: text.slice(cursor, start) });
      cursor = Math.max(cursor, end);
    }
    if (cursor < text.length) segments.push({ start: cursor, text: text.slice(cursor) });

    for (const segment of segments) {
      if (!segment.text.trim()) continue;
      const fileRegex = /<file\s+path=["']([^"']+)["']>([\s\S]*?)(?:<\/file>|(?=<(?:file|edit|delete)\s+path=)|$)/gi;
      let match;
      while ((match = fileRegex.exec(segment.text)) !== null) {
        sawFileTag = true;
        if (fileRegex.lastIndex === segment.text.length && !/<\/file>$/i.test(match[0])) {
          wasTruncated = true;
          continue;
        }
        let filePath = redirectSrcPath(normalizePath(match[1]));
        const fileContent = this.cleanCodeBlock(match[2]);
        if (this.ctx.isHarnessEntry(filePath)) {
          if (/export default|function App|return \(/.test(fileContent)) {
            filePath = '/src/App.jsx';
          } else {
            continue;
          }
        }
        writes.push({ index: segment.start + match.index, path: filePath, content: fileContent });
      }
    }

    return { writes, sawFileTag, wasTruncated };
  }

  missingFileCandidates(missing: Array<{ importer: string; specifier: string; resolvedPath: string }>): string[] {
    const JS_EXTS = ['.jsx', '.tsx', '.js', '.ts', '.mjs', '.cjs', '.mts', '.cts'];
    const out = new Set<string>();
    for (const d of missing) {
      const specExt = d.specifier.match(/\.[A-Za-z0-9]+$/)?.[0]?.toLowerCase();
      if (specExt) { out.add(d.resolvedPath + specExt); continue; }
      const importerExt = d.importer.match(/\.[A-Za-z0-9]+$/)?.[0]?.toLowerCase();
      const ext = importerExt && JS_EXTS.includes(importerExt) ? importerExt : '.tsx';
      out.add(d.resolvedPath + ext);
      out.add(d.resolvedPath + '/index' + ext);
    }
    return [...out];
  }

  extractAndSaveFiles(text: string, connection: ExtractorConnection, epoch?: number, extractOnly = false, defer: (event: () => void) => void = event => event()): ExtractionSummary {
    const summary: ExtractionSummary = {
      writtenCount: 0,
      deletedCount: 0,
      writtenPaths: [],
      deletedPaths: [],
      hadSyntaxDrops: false,
      sawCodeLikeOutput: false,
      wasTruncated: false,
      triggerQueued: false,
      triggerMarker: null,
    };

    let triggerSent = false;
    const sendTriggerOnce = (message: string, marker: string) => {
      if (triggerSent) return;
      triggerSent = true;
      summary.triggerQueued = true;
      summary.triggerMarker = marker;
      defer(() => { try { connection.send(JSON.stringify({ type: 'trigger-auto-reply', message })); } catch (e) { noteSendFailure(e); } });
    };

    if (!text) return summary;

    summary.sawCodeLikeOutput = /<file\s+path=|<edit\s+path=|<delete\s+path=/i.test(text);

    if (typeof epoch === 'number' && !this.ctx.writeEpoch.accepts(epoch)) {
      console.log('Generation superseded; discarding extracted files');
      return summary;
    }

    if (extractOnly) return summary;

    const pendingWrites: Map<string, string> = new Map();
    const pendingDeletes: Set<string> = new Set();
    const operations: Array<{ index: number; path: string; type: 'write'; content: string } | { index: number; path: string; type: 'edit'; edits: ReturnType<typeof parseEditPairs> } | { index: number; path: string; type: 'delete' }> = [];
    let wasTruncated = false;

    const deleteRegex = /<delete\s+path=["']([^"']+)["']\s*\/?>/gi;
    let deleteMatch;
    while ((deleteMatch = deleteRegex.exec(text)) !== null) {
      const filePath = redirectSrcPath(normalizePath(deleteMatch[1]));
      if (!this.ctx.isHarnessEntry(filePath)) operations.push({ index: deleteMatch.index, path: filePath, type: 'delete' });
    }

    const editRegex = /<edit\s+path=["']([^"']+)["']>([\s\S]*?)<\/edit>/gi;
    let editMatch;
    while ((editMatch = editRegex.exec(text)) !== null) {
      const filePath = redirectSrcPath(normalizePath(editMatch[1]));
      if (this.ctx.isHarnessEntry(filePath)) continue;
      const edits = parseEditPairs(editMatch[2], false);
      if (edits.length === 0) continue;
      operations.push({ index: editMatch.index, path: filePath, type: 'edit', edits });
    }

    const fileExtraction = this.collectFileWrites(text);
    let sawClosedFileTag = fileExtraction.sawFileTag;
    wasTruncated = fileExtraction.wasTruncated;
    for (const write of fileExtraction.writes) {
      operations.push({ index: write.index, path: write.path, type: 'write', content: write.content });
    }

    if (findUnterminatedBlock(text)) {
      wasTruncated = true;
    }

    if (!sawClosedFileTag && text.includes('```')) {
      for (const segment of parseMessageSegments(text).segments) {
        if (segment.type !== 'file' || segment.isStreaming) continue;
        const filePath = redirectSrcPath(normalizePath(segment.path));
        if (!pendingWrites.has(filePath) && !this.ctx.isHarnessEntry(filePath)) pendingWrites.set(filePath, segment.content);
      }
    }

    for (const operation of operations.sort((left, right) => left.index - right.index)) {
      let filePath = operation.path;
      if (operation.type === 'delete') {
        pendingWrites.delete(filePath);
        pendingDeletes.add(filePath);
      } else if (operation.type === 'write') {
        pendingDeletes.delete(filePath);
        pendingWrites.set(filePath, operation.content);
      } else {
        if (pendingDeletes.has(filePath)) continue;
        try {
          let original = pendingWrites.get(filePath);
          if (original === undefined) {
            let rows = this.ctx.runSql<{ content: string }>`SELECT content FROM project_files WHERE path = ${filePath}`;
            if (rows.length === 0) {
              const alternate = filePath.startsWith('/src/') ? filePath.replace(/^\/src\//, '/') : `/src${filePath}`;
              if (!pendingDeletes.has(alternate)) {
                original = pendingWrites.get(alternate);
                rows = this.ctx.runSql<{ content: string }>`SELECT content FROM project_files WHERE path = ${alternate}`;
                if (original !== undefined || rows.length > 0) filePath = alternate;
              }
            }
            original ??= rows[0]?.content;
          }
          if (typeof original !== 'string') throw new Error('File not found');
          const updated = applyExactEdits(original, operation.edits);
          pendingWrites.set(filePath, updated);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          try { connection.send(JSON.stringify({ type: 'error', error: `Could not apply edit to ${filePath}: ${reason}. Existing contents were preserved.` })); } catch (e) { noteSendFailure(e); }
        }
      }
    }

    summary.wasTruncated = wasTruncated;
    if (wasTruncated) {
      const retriesSoFar = typeof this.ctx.truncationRetries === 'number' ? this.ctx.truncationRetries : 0;
      if (retriesSoFar >= MAX_TRUNCATION_RETRIES) {
        this.ctx.truncationRetries = 0;
        this.ctx.persistRepairCounters();
        try {
          connection.send(JSON.stringify({
            type: 'error',
            error: 'The app files are too large to finish in one response, even after several tries. Ask for a smaller piece first (for example, one screen at a time), then say "continue".',
          }));
        } catch { }
      } else {
        this.ctx.truncationRetries = retriesSoFar + 1;
        this.ctx.persistRepairCounters();
        sendTriggerOnce(TRUNCATION_RETRY_MESSAGE, TRUNCATION_RETRY_MESSAGE);
      }
    }
    if (pendingWrites.size === 0 && pendingDeletes.size === 0) return summary;

    const brokenFiles: Array<{ path: string; error: string }> = [];

    const userPromptForGuard = this.ctx.activeGeneration?.prompt ?? '';
    for (const [path, content] of [...pendingWrites.entries()]) {
      const rows = this.ctx.runSql<{ content: string }>`SELECT content FROM project_files WHERE path = ${path}`;
      const existing = rows[0]?.content;
      if (content.length === 0 && wasTruncated && existing) {
        pendingWrites.delete(path);
        logWritePath('text-protocol', path, 'rejected', 'empty write on truncated generation');
        brokenFiles.push({ path, error: 'Generation was cut off before writing this file; the empty content was discarded.' });
        continue;
      }
      if (!existing) continue;
      if (content.includes(SHRINK_OK_MARKER)) {
        logWritePath('text-protocol', path, 'accepted', 'shrink-ok marker');
        continue;
      }
      if (isShrinkIntentional(userPromptForGuard)) {
        logWritePath('text-protocol', path, 'accepted', 'removal intent in prompt');
        continue;
      }
      const existingLineCount = existing.split('\n').length;
      if (existingLineCount > 200) {
        pendingWrites.delete(path);
        logWritePath('text-protocol', path, 'rejected', `overwrite of ${existingLineCount}-line existing file`);
        brokenFiles.push({ path, error: `Cannot overwrite an existing ${existingLineCount}-line file with <file>. Use <edit> to change specific sections instead of rewriting the whole file.` });
        this.ctx.repairLog?.add(this.ctx.name, 'shrinkage', `${path}: rejected <file> overwrite (${existingLineCount} lines)`);
        continue;
      }
      const pct = checkShrinkage(path, content, existing);
      if (pct === 0) continue;
      pendingWrites.delete(path);
      logWritePath('text-protocol', path, 'rejected', `shrunk ${pct}%`);
      brokenFiles.push({ path, error: `Replacement is ${pct}% shorter (${content.length} vs ${existing.length} bytes); likely truncated. Use <edit> to change specific sections instead of rewriting the whole file. If removal was intentional, include ${SHRINK_OK_MARKER}.` });
      this.ctx.repairLog?.add(this.ctx.name, 'shrinkage', `${path}: ${existing.length} → ${content.length} bytes (${pct}% shorter)`);
    }

    const pkgContent = pendingWrites.get('/package.json');
    if (pkgContent) {
      try {
        const newPkg = JSON.parse(pkgContent);
        // Re-serialize to eliminate duplicate keys and normalize formatting
        pendingWrites.set('/package.json', JSON.stringify(newPkg, null, 2) + '\n');

        if (this.ctx.flipFlopGuard) {
          const pkgPath = '/package.json';
          const oldRow = this.ctx.runSql<{ content: string }>`SELECT content FROM project_files WHERE path = ${pkgPath}`;
          if (oldRow[0]?.content) {
            const oldPkg = JSON.parse(oldRow[0].content);
            let flipFlop = false;
            for (const section of ['dependencies', 'devDependencies'] as const) {
              const oldDeps: Record<string, string> = oldPkg[section] || {};
              const newDeps: Record<string, string> = newPkg[section] || {};
              for (const [pkg, newVer] of Object.entries(newDeps)) {
                if (oldDeps[pkg] && oldDeps[pkg] !== newVer) {
                  if (this.ctx.flipFlopGuard.record(`${this.ctx.name}:${pkg}`, newVer)) {
                    flipFlop = true;
                    try {
                      connection.send(JSON.stringify({
                        type: 'error',
                        error: `Dependency "${pkg}" keeps alternating versions. The builder cannot resolve this conflict automatically — check the peer dependency requirements and pin a compatible version.`,
                      }));
                    } catch (e) { noteSendFailure(e); }
                  }
                }
              }
            }
            if (flipFlop) {
              pendingWrites.delete('/package.json');
            }
          }
        }
      } catch { /* parse failure handled by syntax check */ }
    }

    for (const [path, content] of pendingWrites.entries()) {
      if (!/^\/(?:src|worker|shared|server)\//.test(path) && !path.endsWith('.json')) continue;
      if (path.endsWith('.json')) {
        try { JSON.parse(content); } catch (jsonErr) {
          console.warn(`Invalid JSON in ${path}: ${errorMessage(jsonErr)}`);
          brokenFiles.push({ path, error: errorMessage(jsonErr) });
        }
        continue;
      }
      if (!/\.(?:[cm]?[jt]sx?)$/.test(path)) continue;

      const isJsx = path.endsWith('.jsx');
      const isJs = path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs');
      const isJsxLike = isJsx || path.endsWith('.tsx');
      const isTs = path.endsWith('.ts') || path.endsWith('.tsx');
      const transforms = isJsxLike ? (['jsx', 'typescript'] as const) : isTs ? (['typescript'] as const) : (['jsx'] as const);

      // Detect TypeScript syntax in .jsx/.js files — Vite won't apply TS transforms to those extensions.
      if (isJsx || isJs) {
        const viteTransforms = isJsx ? (['jsx'] as const) : ([] as const);
        let viteOk = true;
        try { transform(content, { transforms: [...viteTransforms] }); } catch { viteOk = false; }
        if (!viteOk) {
          const tsTransforms = isJsx ? (['jsx', 'typescript'] as const) : (['typescript'] as const);
          try {
            transform(content, { transforms: [...tsTransforms] });
            const newExt = isJsx ? '.tsx' : '.ts';
            const newPath = path.replace(/\.[cm]?jsx?$/, newExt);
            if (!pendingWrites.has(newPath)) {
              pendingWrites.set(newPath, content);
              pendingWrites.delete(path);
              logWritePath('text-protocol', path, 'accepted', `renamed → ${newPath} (TypeScript in JS extension)`);
              continue;
            }
          } catch { /* falls through to normal syntax check below */ }
        } else {
          continue;
        }
      }

      try {
        transform(content, { transforms: [...transforms] });
      } catch (syntaxErr) {
        if (!isJsxLike) {
          console.warn(`Unrecoverable syntax error in ${path}: ${errorMessage(syntaxErr)}`);
          brokenFiles.push({ path, error: errorMessage(syntaxErr) });
          continue;
        }
        const repaired = this.repairUnclosedBrackets(content);
        try {
          transform(repaired, { transforms: ['jsx', 'typescript'] });
          pendingWrites.set(path, repaired);
        } catch {
          console.warn(`Unrecoverable syntax error in ${path}: ${errorMessage(syntaxErr)}`);
          brokenFiles.push({ path, error: errorMessage(syntaxErr) });
        }
      }
    }

    for (const { path } of brokenFiles) pendingWrites.delete(path);

    try {
      const existingRows = this.ctx.runSql<{ path: string }>`SELECT path FROM project_files`;
      const existingPaths = new Set((existingRows || []).map(r => r.path));
      const dangling = findDanglingImports(pendingWrites, existingPaths);
      for (const danglingImport of dangling) {
        const { importer, specifier, resolvedPath } = danglingImport;
        const candidate = this.missingFileCandidates([danglingImport])[0] ?? `${resolvedPath}.tsx`;
        if (!brokenFiles.some(f => f.path === candidate)) {
          console.warn(`Dangling import in ${importer}: '${specifier}' resolves to ${resolvedPath} which was never written; queueing ${candidate} for repair.`);
          brokenFiles.push({ path: candidate, error: `Imported by ${importer} via '${specifier}' but the file was never written` });
        }
      }
    } catch (err) {
      console.warn('Dangling-import check failed:', err instanceof Error ? err.message : String(err));
    }

    if (brokenFiles.length > 0) {
      summary.hadSyntaxDrops = true;
      const repairsSoFar = typeof this.ctx.syntaxRepairAttempts === 'number' ? this.ctx.syntaxRepairAttempts : 0;
      if (repairsSoFar < MAX_SYNTAX_REPAIRS) {
        this.ctx.syntaxRepairAttempts = repairsSoFar + 1;
        this.ctx.persistRepairCounters();
        const list = brokenFiles.slice(0, 8).map(f => `- ${f.path}: ${f.error.slice(0, 300)}`).join('\n');
        const repairPrompt =
          `${SYNTAX_REPAIR_MARKER} and were not saved:\n${list}\n\n` +
          `Regenerate ONLY these files, each as one complete <file path="/...">FULL FILE CONTENT</file> block. ` +
          `Do not modify any other file. Check that every bracket, brace, parenthesis and JSX tag is closed before finishing.`;
        try { connection.send(JSON.stringify({ type: 'generation_notice', message: `A file didn't pass the syntax check. Repairing it now…` })); } catch (e) { noteSendFailure(e); }
        sendTriggerOnce(repairPrompt, SYNTAX_REPAIR_MARKER);
      } else {
        const warn = JSON.stringify({
          type: 'error',
          error: `Discarded ${brokenFiles.length} file(s) with unrecoverable syntax errors after ${MAX_SYNTAX_REPAIRS} automatic repair attempts: ${brokenFiles.map(f => f.path).join(', ')}. Ask the agent to regenerate them one at a time.`
        });
        try { connection.send(warn); } catch (e) { noteSendFailure(e); }
      }
    }

    if (pendingWrites.size === 0 && pendingDeletes.size === 0) {
      console.warn('All extracted files had unrecoverable errors.');
      summary.wasTruncated = wasTruncated;
      return summary;
    }

    const written: string[] = [];
    let oversizePath: string | null = null;
    try {
      this.ctx.transact(() => {
        for (const path of pendingDeletes) {
          this.ctx.runSql`DELETE FROM project_files WHERE path = ${path}`;
        }
        for (const [path, content] of pendingWrites.entries()) {
          if (!this.ctx.upsertFile(path, content)) {
            oversizePath = path;
            throw new Error(`Generated file exceeds the per-file size limit: ${path}`);
          }
          written.push(path);
        }
      });
    } catch (e) {
      console.error('Transaction committing extracted files failed; workspace untouched:', e);
      try {
        connection.send(JSON.stringify({
          type: 'error',
          error: oversizePath
            ? `Could not save ${oversizePath}: it is larger than the ${(MAX_FILE_BYTES / 1024 / 1024).toFixed(0)} MB per-file limit, so none of the files were saved and the workspace is unchanged. Ask the agent to split it into smaller files.`
            : 'Failed to save generated files; workspace unchanged.',
        }));
      } catch { }
      return summary;
    }

    this.ctx.backupToR2(this.ctx.senderUserId(connection)).catch(console.error);

    for (const path of pendingDeletes) {
      const deleteMsg = JSON.stringify({ type: 'file_deleted', path });
      try { connection.send(deleteMsg); } catch (e) { noteSendFailure(e); }
      try { this.ctx.broadcast(deleteMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
    }

    for (let i = 0; i < written.length; i++) {
      const path = written[i];
      const content = pendingWrites.get(path) as string;
      const updateMsg = JSON.stringify(
        isBlockedSecretFile(path)
          ? { type: 'file_updated', path, redacted: true }
          : { type: 'file_updated', path, content }
      );
      try { connection.send(updateMsg); } catch (e) { noteSendFailure(e); }
      try { this.ctx.broadcast(updateMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
      const progress = JSON.stringify({ type: 'file_progress', written: i + 1, total: written.length, paths: written.slice(0, i + 1) });
      try { connection.send(progress); } catch (e) { noteSendFailure(e); }
    }

    summary.writtenCount = written.length;
    summary.deletedCount = pendingDeletes.size;
    summary.writtenPaths = [...written];
    summary.deletedPaths = [...pendingDeletes];
    summary.wasTruncated = wasTruncated;

    try {
      const snapshotMsg = JSON.stringify({
        type: 'files_changed',
      });
      try { connection.send(snapshotMsg); } catch (e) { noteSendFailure(e); }
      try { this.ctx.broadcast(snapshotMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
    } catch (e) {
      console.error('Error broadcasting files_snapshot:', e);
    }

    return summary;
  }
}
