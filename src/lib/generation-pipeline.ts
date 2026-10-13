import { FlipFlopGuard, RepairLog } from './repair-budget';
import { GenerationJobs, MAX_RESUMES } from './generation-jobs';
import { findDanglingImports } from './preview-module-transform';
import { isStarterApp } from './preview-entry';
import { verificationPlan } from '../runtime/verification';
import { extractApiFetches, extractWorkerRoutes, findUncoveredFetches } from './api-coverage';
import { aiBudgetEndpoint, AiBudget, AiBudgetError, meteredModel } from './ai-budget';
import type { FileExtractor } from './file-extractor';
import { resolveModel, capTokenLimit, withAbortSignal, killSwitchRefusal, resolveKillSwitchStatus, MAX_OUTPUT_TOKENS, DEFAULT_MODEL_ID, STREAM_FIRST_CHUNK_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_MS, AI_TIMEOUT_MS, modelSupportsThinking, type AllowedModel, type KillSwitchStatus } from './models';
import { WriteEpoch, IdempotencyStore } from './concurrency';
import { isSystemContinuation, ToolTranscriptStream, toolSummaryMarkup } from './chat-transcript';
import { generationControls, generationContextLimits } from './generation-controls';
import { isHarnessEntry as isHarnessEntryModule } from './preview-import-map';
import { writeGenerationEvent } from './cf-analytics';
import { structuredLog } from './structured-log';
import { prepareCapabilities, sdkCapabilities, imageMessages, cfImageMessages, acceptsImageInput, runCapabilityLoop, capabilitiesFromTools, type AgentCapabilities } from './agent-capabilities';
import { BEDROCK_ALIASES, createBedrockClient, providerCredentials, providerModel, selectModelTransport, type ProviderLanguageModel } from './provider-clients';
import { isConversationalPrompt, shouldUseStagedPipeline } from './prompt-mode';
import { createToolHandlers, instrumentTools } from './agent-tools';
import { boundedConversation, estimateTokens } from './agent-context';
import { validateRuntimeProviders } from './runtime-config';
import { MAX_GENERATION_RESUME_CHARS, type GenerationSession } from './generation-session';
import type { BuilderAttachment } from './builder-attachments';
import { tracing } from 'cloudflare:workers';
import { GenerationUserError, classifyGenerationError, errorMessage } from './generation-errors';
import { isStepCount, streamText, type SystemModelMessage } from 'ai';
import { sourceSnapshot } from '../runtime/source';
import { devJobPayload, PILOT_LIMITS } from '../runtime/types';
import { AUTO_RETRY_FULL_APP_MARKER } from './file-extractor';
import { DISCONNECT_GRACE_MS } from './timeouts';

const KILL_SWITCH_CACHE_KEY = 'ks_cache';
const GENERATION_TRANSIENT_RETRIES = 3;
const MAX_LLM_CALLS_PER_GENERATION = 16;

function fixToolCallIndex(line: string): string {
  if (!line.startsWith('data: ')) return line;
  const payload = line.slice(6).trim();
  if (payload === '[DONE]') return line;
  try {
    const obj = JSON.parse(payload) as {
      choices?: Array<{ delta?: { tool_calls?: Array<{ index?: number }> } }>;
    };
    let patched = false;
    for (const choice of obj?.choices ?? []) {
      const calls = choice?.delta?.tool_calls;
      if (Array.isArray(calls)) {
        calls.forEach((tc, i) => {
          if (typeof tc.index !== 'number') { tc.index = i; patched = true; }
        });
      }
    }
    return patched ? `data: ${JSON.stringify(obj)}` : line;
  } catch { return line; }
}

function stripThinkingBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trimStart();
}

type WorkersAIStreamResponse = {
  getReader?: () => ReadableStreamDefaultReader<unknown>;
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};

// Token capacity ladder for Cloudflare Workers AI. Starts high so a full
// multi-file full-stack generation is not truncated, and steps down only when
// the provider rejects the request for a token/context reason.
const TOKEN_LADDER = [65536, 32768, 16384, 8192, 4096];
const MAX_CF_ATTEMPTS = 6;

export const COMPLETENESS_REPAIR_MARKER = '[AUTO-FIX] The build finished but these files are imported by the app and were never written:';
export const PHANTOM_HOOK_REPAIR_MARKER = '[AUTO-FIX] These files use useAuth/AuthProvider/AuthContext without defining them:';
export const VERIFY_FILE_REPAIR_MARKER = '[AUTO-FIX] brainhalf.verify.json is invalid:';
export const ROUTE_COVERAGE_REPAIR_MARKER = '[AUTO-FIX] The frontend calls these /api/ routes but no matching handler exists in worker/index.ts:';
export const APP_ENTRY_REPAIR_MARKER = '[AUTO-FIX] The generation finished but the app entry file is still the starter placeholder:';

export type ClientMessage = {
  type?: string;
  prompt?: unknown;
  message?: unknown;
  messages?: Array<{ role?: unknown; content?: unknown } | null>;
  files?: Record<string, unknown>;
  workspaceFiles?: Record<string, unknown>;
  expected_revision?: unknown;
  replace_all?: unknown;
  preserve_secrets?: unknown;
  idempotencyKey?: string;
  executionTarget?: unknown;
  model?: string;
  provider?: string;
  attachmentIds?: unknown;
  requestId?: unknown;
  limit?: unknown;
  offset?: unknown;
  revision?: unknown;
  name?: string;
  branchId?: string;
  messageIndex?: number;
};

export interface PipelineConnection {
  id: string;
  send: (message: string) => void;
}

export interface GenerationPipelineContext {
  runSql: {
    <R = any>(strings: TemplateStringsArray, ...values: any[]): R[];
  };
  env: {
    REGISTRY?: {
      idFromName: (name: string) => any;
      get: (id: any) => { fetch: (req: Request | string, init?: RequestInit) => Promise<Response> };
    };
    [key: string]: any;
  };
  storage: {
    put?: (key: string, value: any) => Promise<void> | void;
    get?: <T = any>(key: string) => Promise<T | undefined> | T | undefined;
    delete?: (key: string) => Promise<boolean> | boolean;
    transactionSync?: <R>(fn: () => R) => R;
  };
  waitUntil: (promise: Promise<unknown>) => void;
  fileExtractor: FileExtractor;
  name: string;
  writeEpoch: WriteEpoch;
  idempotency: IdempotencyStore;
  connectionUserIds: Map<string, string>;
  broadcast: (message: string, exclude?: string[]) => void;
  backupToR2: (ownerId?: string) => Promise<void>;
  getConnections: () => Iterable<any>;
  authorizeConnection: (connection: any, forceRefresh?: boolean) => Promise<boolean>;
  abortGeneration: () => void;
  senderUserId: (connection: any) => string | undefined;
  queueProductOutcome: (event: any) => Promise<void>;
  saveCheckpoint: (label: string) => void;
  readAllProjectFiles: () => Record<string, string>;
  saveGenerationTurn: (prompt: string, response: string, epoch?: number) => void;
  ensureEntryPointExists: () => void;
  upsertFile: (path: string, content: string) => boolean;
  builderService: (ownerId: string) => any;
}

let sendFailureCount = 0;
function noteSendFailure(error: unknown): void {
  sendFailureCount += 1;
  if (sendFailureCount <= 5 || sendFailureCount % 100 === 0) {
    console.warn(`WebSocket send failed (#${sendFailureCount}):`, error instanceof Error ? error.message : String(error));
  }
}

export class GenerationPipeline {
  readonly ctx: GenerationPipelineContext;

  truncationRetries = 0;
  syntaxRepairAttempts = 0;
  finalCompletenessRepairAttempts = 0;
  phantomHookRepairAttempts = 0;
  verifyFileRepairAttempts = 0;
  apiRouteCoverageRepairAttempts = 0;
  appEntryRepairAttempts = 0;
  flipFlopGuard = new FlipFlopGuard();
  repairLog = new RepairLog();
  pendingCompletenessRepair: { parentJobId: string; marker: string } | null = null;
  killSwitchCache: KillSwitchStatus | null = null;
  turnSavedForEpoch = -1;

  activeGeneration: (GenerationSession & { epoch: number }) | null = null;
  activeJobId: string | null = null;
  activeAccounting: { id: string; startedAt: number; inputTokens: number | null; outputTokens: number | null; firstResponseAt: number | null; providerCalls: number; generationMs: number | null; extractionMs: number | null; checksMs: number | null; editChars: number; rewriteChars: number; cacheReadTokens: number; cacheWriteTokens: number } | null = null;
  activeBudget: AiBudget | null = null;
  currentAbortController: AbortController | null = null;
  generationBranchId: string = 'main';

  constructor(ctx: GenerationPipelineContext) {
    this.ctx = ctx;
  }

  captureUsage(input: unknown, output: unknown, inputDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } | null) {
    const accounting = this.activeAccounting;
    if (!accounting) return;
    if (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0) accounting.inputTokens = input;
    if (typeof output === 'number' && Number.isSafeInteger(output) && output >= 0) accounting.outputTokens = output;
    if (inputDetails?.cacheReadTokens) accounting.cacheReadTokens += inputDetails.cacheReadTokens;
    if (inputDetails?.cacheWriteTokens) accounting.cacheWriteTokens += inputDetails.cacheWriteTokens;
  }

  generationSnapshot(): GenerationSession | undefined {
    if (!this.activeGeneration || !this.ctx.writeEpoch.accepts(this.activeGeneration.epoch)) return undefined;
    const { epoch: _epoch, ...session } = this.activeGeneration;
    return session;
  }

  rememberGenerationText(text: string, epoch?: number) {
    const session = this.activeGeneration;
    if (!session || session.epoch !== epoch) return;
    if (text && this.activeAccounting && this.activeAccounting.firstResponseAt === null) this.activeAccounting.firstResponseAt = Date.now();
    if (session.truncated) return;
    if (session.response.length + text.length > MAX_GENERATION_RESUME_CHARS) {
      session.response = 'Reconnected to the active generation. The full response will be saved in this conversation when it finishes.\n\n';
      session.truncated = true;
    } else session.response += text;
  }

  generationJobs(): GenerationJobs {
    return new GenerationJobs((sql, ...params) => this.ctx.runSql(sql.split('?') as unknown as TemplateStringsArray, ...params));
  }

  resetRepairCounters(): void {
    this.truncationRetries = 0;
    this.syntaxRepairAttempts = 0;
    this.finalCompletenessRepairAttempts = 0;
    this.phantomHookRepairAttempts = 0;
    this.verifyFileRepairAttempts = 0;
    this.apiRouteCoverageRepairAttempts = 0;
    this.appEntryRepairAttempts = 0;
    this.flipFlopGuard?.clear();
  }

  persistActiveGeneration(generationSessionId: string, jobId: string, accountingId: string, budgetId: string, budgetOwner: string): void {
    try {
      this.ctx.runSql`INSERT OR REPLACE INTO active_generation_state (id, generation_session_id, job_id, accounting_id, budget_id, budget_owner, started_at, turn_saved_for_epoch, truncation_retries, syntax_repair_attempts, final_completeness_repair_attempts, phantom_hook_repair_attempts, verify_file_repair_attempts, api_route_coverage_repair_attempts, app_entry_repair_attempts) VALUES (1, ${generationSessionId}, ${jobId}, ${accountingId}, ${budgetId}, ${budgetOwner}, ${Date.now()}, ${this.turnSavedForEpoch}, ${this.truncationRetries}, ${this.syntaxRepairAttempts}, ${this.finalCompletenessRepairAttempts}, ${this.phantomHookRepairAttempts}, ${this.verifyFileRepairAttempts}, ${this.apiRouteCoverageRepairAttempts}, ${this.appEntryRepairAttempts})`;
    } catch { /* auxiliary — lost row only loses wake-cleanup, not the generation */ }
  }

  persistRepairCounters(): void {
    try {
      this.ctx.runSql`UPDATE active_generation_state SET turn_saved_for_epoch=${this.turnSavedForEpoch}, truncation_retries=${this.truncationRetries}, syntax_repair_attempts=${this.syntaxRepairAttempts}, final_completeness_repair_attempts=${this.finalCompletenessRepairAttempts}, phantom_hook_repair_attempts=${this.phantomHookRepairAttempts}, verify_file_repair_attempts=${this.verifyFileRepairAttempts}, api_route_coverage_repair_attempts=${this.apiRouteCoverageRepairAttempts}, app_entry_repair_attempts=${this.appEntryRepairAttempts} WHERE id=1`;
    } catch { /* auxiliary */ }
  }

  clearActiveGenerationState(): void {
    try { this.ctx.runSql`DELETE FROM active_generation_state WHERE id=1`; } catch { /* auxiliary */ }
  }

  recoverOrphanedGeneration(activeGeneration: unknown): void {
    if (activeGeneration) return;
    type ActiveGenRow = { accounting_id: string; budget_id: string; budget_owner: string };
    let staleRow: ActiveGenRow | undefined;
    try {
      const rows = this.ctx.runSql<ActiveGenRow>`SELECT accounting_id, budget_id, budget_owner FROM active_generation_state WHERE id=1`;
      staleRow = rows[0];
    } catch { /* table may not exist yet */ }
    if (staleRow) {
      try { this.ctx.runSql`UPDATE generation_usage SET finished_at=${Date.now()}, status=${'failed'} WHERE id=${staleRow.accounting_id} AND status='running'`; } catch {}
      try {
        const endpoint = aiBudgetEndpoint(this.ctx.env, staleRow.budget_owner);
        this.ctx.waitUntil(endpoint.fetch(new Request('https://registry/ai/end', { method: 'POST', body: JSON.stringify({ id: staleRow.budget_id }), signal: AbortSignal.timeout(10_000) })).catch(() => {}));
      } catch {}
      this.clearActiveGenerationState();
    }
    try { this.ctx.runSql`UPDATE generation_usage SET finished_at=${Date.now()}, status=${'failed'} WHERE status='running'`; } catch {}
  }

  checkFinalCompleteness(allFiles: Map<string, string>, connection: PipelineConnection): string | null {
    if (allFiles.size === 0) return null;
    const missing = findDanglingImports(allFiles, new Set<string>());
    if (missing.length === 0) return null;
    const candidates = [...new Set(this.ctx.fileExtractor.missingFileCandidates(missing))];
    console.warn(`Final completeness check: ${candidates.length} imported file(s) never written: ${candidates.join(', ')}`);
    if (this.finalCompletenessRepairAttempts < 1) {
      this.finalCompletenessRepairAttempts++;
      this.persistRepairCounters();
      const list = candidates.slice(0, 8).map(p => `- ${p}`).join('\n');
      try { connection.send(JSON.stringify({ type: 'generation_notice', message: `The build was missing ${candidates.length} file(s). Generating them now…` })); } catch (e) { noteSendFailure(e); }
      return (
        `${COMPLETENESS_REPAIR_MARKER}\n${list}\n\n` +
        `Generate ONLY these missing files, each as one complete <file path="/...">FULL FILE CONTENT</file> block. ` +
        `Match the existing app's architecture, imports, and styling. Do not modify any other file.`
      );
    } else {
      try {
        connection.send(JSON.stringify({
          type: 'error',
          error: `The app is incomplete: ${candidates.length} file(s) imported by the app were never generated (${candidates.slice(0, 5).join(', ')}${candidates.length > 5 ? ', …' : ''}). Ask the builder to create them.`,
        }));
      } catch { }
    }
    return null;
  }

  checkMissingAppEntry(allFiles: Map<string, string>, connection: PipelineConnection): string | null {
    if (allFiles.size === 0) return null;
    const appTsx = allFiles.get('/src/App.tsx') ?? allFiles.get('/src/App.jsx');
    if (appTsx && !isStarterApp(appTsx)) return null;
    if (this.appEntryRepairAttempts >= 1) return null;
    this.appEntryRepairAttempts++;
    this.persistRepairCounters();
    const which = allFiles.has('/src/App.tsx') ? '/src/App.tsx' : '/src/App.jsx';
    const reason = appTsx ? 'still contains the starter placeholder' : 'was never written';
    try { connection.send(JSON.stringify({ type: 'generation_notice', message: 'Completing the app entry file…' })); } catch { }
    return (
      `${APP_ENTRY_REPAIR_MARKER} ${which} ${reason}.\n\n` +
      `Write a complete, working ${which} that implements the user\'s requested app. ` +
      `Use the other files already written as context (components, types, routes). ` +
      `Do not modify any other file.`
    );
  }

  checkNoPhantomAuthHooks(allFiles: Map<string, string>, connection: PipelineConnection): string | null {
    if (allFiles.size === 0) return null;
    const phantomPattern = /\buseAuth\b|\bAuthProvider\b|\bAuthContext\b/;
    const definitionPattern = /(?:function\s+useAuth|const\s+useAuth|export\s+(?:default\s+)?(?:function|const)\s+(?:useAuth|AuthProvider)|createContext.*Auth|AuthContext\s*=\s*createContext)/;
    let anyDefines = false;
    const consumers: string[] = [];
    for (const [path, content] of allFiles) {
      if (!/\.(?:[jt]sx?)$/.test(path)) continue;
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      if (definitionPattern.test(stripped)) { anyDefines = true; break; }
      if (phantomPattern.test(stripped)) consumers.push(path);
    }
    if (anyDefines || consumers.length === 0) return null;
    if (this.phantomHookRepairAttempts >= 1) {
      try {
        connection.send(JSON.stringify({
          type: 'error',
          error: `${consumers.length} file(s) reference useAuth/AuthProvider/AuthContext but no file defines them (${consumers.slice(0, 3).join(', ')}). Ask the builder to fix this.`,
        }));
      } catch {}
      return null;
    }
    this.phantomHookRepairAttempts++;
    this.persistRepairCounters();
    const list = consumers.slice(0, 8).map(p => `- ${p}`).join('\n');
    try { connection.send(JSON.stringify({ type: 'generation_notice', message: `Found ${consumers.length} file(s) using an undefined auth hook. Repairing…` })); } catch {}
    return (
      `${PHANTOM_HOOK_REPAIR_MARKER}\n${list}\n\n` +
      `These files call useAuth, AuthProvider, or AuthContext but no file in the project defines them — the app will crash. ` +
      `Replace every phantom reference: use useState + useEffect calling the session API (GET /api/auth/session) directly, ` +
      `or create and export a real useAuth hook in a new /src/hooks/useAuth.tsx file that all consumers import. ` +
      `Use targeted <edit> blocks; do not rewrite entire files.`
    );
  }

  checkVerificationPlanFile(allFiles: Map<string, string>, connection: PipelineConnection): string | null {
    if (allFiles.size === 0) return null;
    const hasWorkerBackend = allFiles.has('/worker/index.ts');
    const verifyRaw = allFiles.get('/brainhalf.verify.json') ?? allFiles.get('brainhalf.verify.json');
    if (!verifyRaw) {
      if (!hasWorkerBackend) return null;
      if (this.verifyFileRepairAttempts >= 1) return null;
      this.verifyFileRepairAttempts++;
      this.persistRepairCounters();
      try { connection.send(JSON.stringify({ type: 'generation_notice', message: 'Generating verification plan for your app…' })); } catch {}
      return (
        `${VERIFY_FILE_REPAIR_MARKER} missing\n\n` +
        `This app has a worker backend (/worker/index.ts) but no brainhalf.verify.json. ` +
        `Write a complete, valid brainhalf.verify.json that exercises the app\'s actual API routes. ` +
        `The file MUST satisfy all schema rules: at least 3 steps, one successful POST/PUT/PATCH/DELETE ` +
        `request step, one database assertion step with rows > 0 and at least one assertion, and for ` +
        `private apps one anonymous or otherUser access-denial step. ` +
        `Use <file path="/brainhalf.verify.json">…</file> — do not modify any other file.`
      );
    }
    let validationError: string | null = null;
    try {
      verificationPlan({ 'brainhalf.verify.json': verifyRaw });
    } catch (err) {
      validationError = err instanceof Error ? err.message : String(err);
    }
    if (!validationError) return null;
    if (this.verifyFileRepairAttempts >= 1) return null;
    this.verifyFileRepairAttempts++;
    this.persistRepairCounters();
    try { connection.send(JSON.stringify({ type: 'generation_notice', message: 'Fixing verification plan…' })); } catch {}
    return (
      `${VERIFY_FILE_REPAIR_MARKER} ${validationError}\n\n` +
      `Fix /brainhalf.verify.json so it passes all schema checks: at least 3 steps, one successful ` +
      `POST/PUT/PATCH/DELETE request step (method not GET, status < 300), one database assertion step ` +
      `(type:"database", rows > 0, non-empty assertions[]), and for private apps one anonymous or ` +
      `otherUser access-denial step (status 401/403/404). Use a targeted <edit> block or rewrite the ` +
      `file with <file path="/brainhalf.verify.json">…</file>. Do not modify any other file.`
    );
  }

  checkApiRouteCoverage(allFiles: Map<string, string>, connection: PipelineConnection): string | null {
    if (allFiles.size === 0) return null;
    const workerContent = allFiles.get('/worker/index.ts') ?? allFiles.get('worker/index.ts');
    if (!workerContent) return null;
    const fetches = extractApiFetches(allFiles);
    if (fetches.length === 0) return null;
    const routes = extractWorkerRoutes(workerContent);
    const uncovered = findUncoveredFetches(fetches, routes, workerContent);
    if (uncovered.length === 0) return null;
    console.warn(`Route coverage check: ${uncovered.length} fetch call(s) with no matching route: ${uncovered.join(', ')}`);
    if (this.apiRouteCoverageRepairAttempts < 1) {
      this.apiRouteCoverageRepairAttempts++;
      this.persistRepairCounters();
      const list = uncovered.slice(0, 8).map(p => `- ${p}`).join('\n');
      try { connection.send(JSON.stringify({ type: 'generation_notice', message: `The backend is missing ${uncovered.length} route(s). Adding them now…` })); } catch (e) { noteSendFailure(e); }
      return (
        `${ROUTE_COVERAGE_REPAIR_MARKER}\n${list}\n\n` +
        `Add the missing route handler(s) to /worker/index.ts. ` +
        `Follow the routing, database and auth patterns already present in that file. ` +
        `Never add handlers for platform-provided routes (/api/auth/*, /api/contact, /api/storage) — the platform serves them in front of the worker. ` +
        `Do not modify any other file.`
      );
    }
    try {
      connection.send(JSON.stringify({
        type: 'error',
        error: `The app is incomplete: ${uncovered.length} API call(s) in the frontend have no matching backend route (${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', …' : ''}). Ask the builder to add the missing routes.`,
      }));
    } catch { }
    return null;
  }

  noteRepairQueued(jobId: string, actualPrompt: string, marker: string | null): boolean {
    if (!marker) return false;
    if (this.pendingCompletenessRepair === null) {
      try {
        const rows = this.ctx.runSql<{ parent_job_id: string; marker: string }>`SELECT parent_job_id, marker FROM pending_repair WHERE id = 1`;
        if (rows[0]) this.pendingCompletenessRepair = { parentJobId: rows[0].parent_job_id, marker: rows[0].marker };
      } catch { /* table not yet created — schema migration pending */ }
    }
    const pending = this.pendingCompletenessRepair;
    if (pending && pending.parentJobId === jobId) return true;
    if (pending && actualPrompt.startsWith(pending.marker)) {
      this.pendingCompletenessRepair = { parentJobId: pending.parentJobId, marker };
    } else {
      this.pendingCompletenessRepair = { parentJobId: jobId, marker };
    }
    try {
      const { parentJobId: pjid, marker: m } = this.pendingCompletenessRepair;
      this.ctx.runSql`INSERT OR REPLACE INTO pending_repair (id, parent_job_id, marker) VALUES (1, ${pjid}, ${m})`;
    } catch { /* auxiliary */ }
    return true;
  }

  resolveCompletenessRepair(actualPrompt: string, accountingId: string, completed: boolean, jobOutcome: { kind: 'failed' | 'interrupted'; error: string } | null, aborted: boolean): void {
    if (this.pendingCompletenessRepair === null) {
      try {
        const rows = this.ctx.runSql<{ parent_job_id: string; marker: string }>`SELECT parent_job_id, marker FROM pending_repair WHERE id = 1`;
        if (rows[0]) this.pendingCompletenessRepair = { parentJobId: rows[0].parent_job_id, marker: rows[0].marker };
      } catch { /* table not yet created */ }
    }
    const pending = this.pendingCompletenessRepair;
    if (!pending || pending.parentJobId === accountingId || !actualPrompt.startsWith(pending.marker)) return;
    this.pendingCompletenessRepair = null;
    try { this.ctx.runSql`DELETE FROM pending_repair WHERE id = 1`; } catch { /* auxiliary */ }
    try {
      const jobs = this.generationJobs();
      if (completed) {
        jobs.complete(pending.parentJobId);
        this.ctx.runSql`UPDATE generation_usage SET finished_at=${Date.now()}, status='completed' WHERE id=${pending.parentJobId}`;
      } else {
        const status = aborted ? 'stopped' : 'failed';
        if (jobOutcome?.kind === 'failed') jobs.fail(pending.parentJobId, jobOutcome.error);
        else jobs.interrupt(pending.parentJobId, jobOutcome?.error ?? 'The repair turn did not finish.');
        this.ctx.runSql`UPDATE generation_usage SET finished_at=${Date.now()}, status=${status} WHERE id=${pending.parentJobId}`;
      }
    } catch { /* parent bookkeeping is auxiliary; the files themselves are saved */ }
  }

  verifyFinalCompleteness(connection: PipelineConnection, defer: (event: () => void) => void = event => event()): boolean {
    try {
      const rows = this.ctx.runSql<{ path: string; content: string }>`SELECT path, content FROM project_files`;
      const allFiles = new Map<string, string>();
      for (const r of rows || []) allFiles.set(r.path, r.content || '');
      const prompt = this.checkFinalCompleteness(allFiles, connection);
      if (!prompt) return false;
      defer(() => { try { connection.send(JSON.stringify({ type: 'trigger-auto-reply', message: prompt })); } catch (e) { noteSendFailure(e); } });
      return true;
    } catch (err) {
      console.warn('Final completeness check failed:', err instanceof Error ? err.message : String(err));
    }
    return false;
  }

  verifyNoPhantomAuthHooks(connection: PipelineConnection, defer: (event: () => void) => void = event => event()): boolean {
    try {
      const rows = this.ctx.runSql<{ path: string; content: string }>`SELECT path, content FROM project_files`;
      const allFiles = new Map<string, string>();
      for (const r of rows || []) allFiles.set(r.path, r.content || '');
      const prompt = this.checkNoPhantomAuthHooks(allFiles, connection);
      if (!prompt) return false;
      defer(() => { try { connection.send(JSON.stringify({ type: 'trigger-auto-reply', message: prompt })); } catch {} });
      return true;
    } catch (err) {
      console.warn('Phantom auth hook check failed:', err instanceof Error ? err.message : String(err));
    }
    return false;
  }

  verifyVerificationPlanFile(connection: PipelineConnection, defer: (event: () => void) => void = event => event()): boolean {
    try {
      const rows = this.ctx.runSql<{ path: string; content: string }>`SELECT path, content FROM project_files`;
      const allFiles = new Map<string, string>();
      for (const r of rows || []) allFiles.set(r.path, r.content || '');
      const prompt = this.checkVerificationPlanFile(allFiles, connection);
      if (!prompt) return false;
      defer(() => { try { connection.send(JSON.stringify({ type: 'trigger-auto-reply', message: prompt })); } catch {} });
      return true;
    } catch (err) {
      console.warn('verify.json check failed:', err instanceof Error ? err.message : String(err));
    }
    return false;
  }

  verifyApiRouteCoverage(connection: PipelineConnection, defer: (event: () => void) => void = event => event()): boolean {
    try {
      const rows = this.ctx.runSql<{ path: string; content: string }>`SELECT path, content FROM project_files`;
      const allFiles = new Map<string, string>();
      for (const r of rows || []) allFiles.set(r.path, r.content || '');
      const prompt = this.checkApiRouteCoverage(allFiles, connection);
      if (!prompt) return false;
      defer(() => { try { connection.send(JSON.stringify({ type: 'trigger-auto-reply', message: prompt })); } catch (e) { noteSendFailure(e); } });
      return true;
    } catch (err) {
      console.warn('Route coverage check failed:', err instanceof Error ? err.message : String(err));
    }
    return false;
  }

  async run(
    connection: PipelineConnection,
    data: ClientMessage,
    systemPrompt: string,
    actualPrompt: string,
    epoch: number,
    plannerMode: boolean,
    resumeChain?: { parentJobId: string; resumeCount: number; initialFiles: string[] } | null,
    modes?: { destructiveMode?: boolean; questionMode?: boolean; ambiguousMode?: boolean; isIncrementalEdit?: boolean; isFreshBuild?: boolean },
    staticSystemPart?: string
  ): Promise<void> {
        if (!isSystemContinuation(actualPrompt)) this.resetRepairCounters();
        const controls = generationControls(data);
        const generationTimeoutMs = controls.timeoutMs;
        const maxSteps = controls.maxSteps;
    
        const abortController = new AbortController();
        this.currentAbortController = abortController;
        this.activeGeneration = { id: typeof data.idempotencyKey === 'string' ? data.idempotencyKey : crypto.randomUUID(), epoch, model: data.model || DEFAULT_MODEL_ID, prompt: actualPrompt, response: '', startedAt: Date.now(), filesChanged: false, truncated: false };
        const accounting = { id: crypto.randomUUID(), startedAt: Date.now(), inputTokens: null as number | null, outputTokens: null as number | null, firstResponseAt: null as number | null, providerCalls: 0, generationMs: null as number | null, extractionMs: null as number | null, checksMs: null as number | null, editChars: 0, rewriteChars: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
        this.activeAccounting = accounting;
        const measureGeneration = !plannerMode && !isConversationalPrompt(actualPrompt);
        const outcomeScope = { id: accounting.id, projectId: this.ctx.name, ownerId: this.ctx.senderUserId(connection) || '' };
        if (measureGeneration) this.ctx.queueProductOutcome({ ...outcomeScope, kind: 'generation_started', at: accounting.startedAt }).catch(() => {});
        try {
          this.ctx.runSql`INSERT INTO generation_usage(id,model,started_at,status) VALUES (${accounting.id},${String(data.model || DEFAULT_MODEL_ID).slice(0, 200)},${Date.now()},${'running'})`;
          this.ctx.runSql`DELETE FROM generation_usage WHERE id NOT IN (SELECT id FROM generation_usage ORDER BY started_at DESC LIMIT 200)`;
        } catch { console.warn('AI usage recording unavailable'); }
        // Durable resume checkpoint for this generation. Shares the accounting id
        // so generation_usage and generation_jobs stay 1:1. Best-effort: a missed
        // row only loses resumability, never the generation itself.
        try {
          this.generationJobs().create({
            id: accounting.id,
            prompt: actualPrompt.slice(0, 4000),
            model: String(data.model || DEFAULT_MODEL_ID).slice(0, 200),
            parentJobId: resumeChain?.parentJobId ?? null,
            resumeCount: resumeChain?.resumeCount ?? 0,
            initialFiles: resumeChain?.initialFiles ?? [],
          });
          // Only track file checkpoints while the durable row exists; otherwise
          // upsertFile writes would be attributed to a job that was never stored.
          this.activeJobId = accounting.id;
        } catch { console.warn('Generation resume checkpoint unavailable'); }
        let completed = false;
        // P0-4: set when this turn queued a repair/retry turn (staged or Workers
        // AI path). While set, the turn is not terminal: the usage row and the
        // durable job stay open until the repair turn resolves the parent.
        let repairQueuedThisTurn = false;
        // Terminal resume bookkeeping, decided in the catch branches and applied
        // in the finally: 'failed' = hard failure, never resume (quota, auth,
        // bad model); 'interrupted' = the build can continue from its saved files
        // (stream drop, timeout, user stop, disconnect).
        let jobOutcome: { kind: 'failed' | 'interrupted'; error: string } | null = null;
        const genTimeout = setTimeout(
          () => abortController.abort(new Error(`Generation exceeded ${Math.round(generationTimeoutMs / 1000)}s. Please retry.`)),
          generationTimeoutMs
        );
        // A silent tab must not keep streaming after logout. Check subscribers while
        // inference is active; every incoming command also checks before execution.
        let checkingAccess = false;
        let disconnectedSince: number | null = null;
        const accessTimer = setInterval(async () => {
          if (checkingAccess) return;
          checkingAccess = true;
          try {
            const connections = [...this.ctx.getConnections()];
            await Promise.all(connections.map(sub => this.ctx.authorizeConnection(sub, false)));
            if (!this.ctx.connectionUserIds.size) {
              if (!disconnectedSince) disconnectedSince = Date.now();
              if (Date.now() - disconnectedSince >= DISCONNECT_GRACE_MS) this.ctx.abortGeneration();
            } else {
              disconnectedSince = null;
            }
          } catch { this.ctx.abortGeneration(); }
          finally { checkingAccess = false; }
        }, 10_000);
    
        // Superseded before it wrote anything: a stop or a newer generation won.
        if (!this.ctx.writeEpoch.accepts(epoch) || this.currentAbortController?.signal.aborted) {
          console.log('Generation epoch superseded or aborted before start; aborting');
          if (measureGeneration) await this.ctx.queueProductOutcome({ ...outcomeScope, kind: 'generation_failed', at: Date.now() });
          clearTimeout(genTimeout);
          clearInterval(accessTimer);
          this.currentAbortController = null;
          this.activeAccounting = null;
          try { this.generationJobs().interrupt(accounting.id, 'The build was stopped.'); } catch { /* auxiliary */ }
          if (this.activeJobId === accounting.id) this.activeJobId = null;
          try { this.ctx.runSql`UPDATE generation_usage SET finished_at=${Date.now()},status=${'stopped'} WHERE id=${accounting.id}`; } catch (e) { console.warn('Failed to record generation stop:', e); }
          if (this.activeGeneration?.epoch === epoch) this.activeGeneration = null;
          // L-3: superseded before the outer try/finally, so its resolveCompletenessRepair
          // never fires. Resolve here so the parent repair turn is not left open.
          this.resolveCompletenessRepair(actualPrompt, accounting.id, false, null, true);
          return;
        }
    
        const terminalEvents: Array<() => void> = [];
        const deferTerminal = (event: () => void) => { terminalEvents.push(event); };
        const sendError = (msg: string, code?: string) => {
          const payload = JSON.stringify(code ? { type: 'error', code, error: msg } : { type: 'error', error: msg });
          deferTerminal(() => {
            try { connection.send(payload); } catch (e) { noteSendFailure(e); }
            try { this.ctx.broadcast(payload, [connection.id]); } catch (e) { noteSendFailure(e); }
          });
        };
        // Set by the tool-loop's prepareStep when the kill-switch fires mid-generation.
        // Checked first in the outer catch so the right message reaches the client.
        let midGenerationKillSwitch: string | null = null;
    
        const budget = new AiBudget(this.ctx.env, this.ctx.connectionUserIds.get(connection.id) || '', abortController.signal);
        try {
          try { connection.send(JSON.stringify({ type: 'generation_notice', message: 'Preparing your app request…', stage: 'accepted', requestId: data.idempotencyKey })); } catch (e) { noteSendFailure(e); }
          if (modes?.isIncrementalEdit) {
            try { connection.send(JSON.stringify({ type: 'generation_mode', mode: 'incremental' })); } catch {}
          }
          const maxReserveTokens = Math.min(controls.maxTokens * (maxSteps + 1), 65536);
          let rawHistory: Array<{ role: string; content: string }> = [];
          await Promise.all([
            budget.startAndReserve(maxReserveTokens),
            Promise.resolve().then(() => {
              try { const branch = this.generationBranchId; rawHistory = this.ctx.runSql<{ role: string; content: string }>`SELECT role, content FROM messages WHERE branch_id = ${branch} ORDER BY id DESC LIMIT 12`.reverse(); }
              catch { console.warn('Could not load conversation context'); }
            }),
          ]);
          this.activeBudget = budget;
          this.persistActiveGeneration(this.activeGeneration!.id, this.activeJobId || accounting.id, accounting.id, budget.id, this.ctx.connectionUserIds.get(connection.id) || '');
          const inputMessages = boundedConversation(rawHistory, actualPrompt, generationContextLimits(controls.fastMode).historyTokens);
          await tracing.enterSpan('invoke_agent', async (invokeSpan) => {
            invokeSpan.setAttribute('gen_ai.operation.name', 'invoke_agent');
    
            await tracing.enterSpan('chat', async (_chatSpan) => {
              let aiModel: ProviderLanguageModel | null = null;
    
              const env = this.ctx.env;
              validateRuntimeProviders(env);
              const creds = providerCredentials(env);
    
              const requestedModel = data.model || DEFAULT_MODEL_ID;
    
              // Custom models added via the admin page (ids start with cm_).
              // They are OpenAI-compatible: base URL + API key + model id.
              let customModel: { baseUrl: string; modelId: string; apiKey: string; name: string } | null = null;
              if (requestedModel.startsWith('cm_')) {
                try {
                  const cmRes = await this.ctx.env.REGISTRY!.get(this.ctx.env.REGISTRY!.idFromName('auth')).fetch(`https://registry/internal/custom-model/${encodeURIComponent(requestedModel)}`);
                  if (cmRes.ok) {
                    customModel = await cmRes.json() as { baseUrl: string; modelId: string; apiKey: string; name: string };
                  }
                } catch { /* fall through to the allowlist error below */ }
                if (!customModel) {
                  sendError('That custom model is no longer available.');
                  return;
                }
              }
    
              // Exact allowlist match only. No substring dispatch ("includes sonnet")
              // and no default substitution for an unknown id.
              // Custom models get a synthetic allowlist entry so the rest of the
              // pipeline (token caps, logging) works unchanged.
              let resolved: AllowedModel;
              if (customModel) {
                resolved = { id: customModel.modelId, name: customModel.name, provider: 'custom', maxTokens: MAX_OUTPUT_TOKENS, clientSelectable: false };
              } else {
                const allowlisted = resolveModel(requestedModel, data.provider);
                if (!allowlisted) {
                  sendError(`Model "${requestedModel}" is not in the model allowlist`);
                  return;
                }
                resolved = allowlisted;
              }
    
              // Admin kill-switch — fail closed.
              // The live fetch updates the in-memory + DO cache so that a brief
              // registry blip mid-generation falls back to last-known status instead
              // of either failing every iteration or silently ignoring disables.
              const resolvedDisplayName = customModel ? customModel.name : resolved!.name;
              const resolvedModelKey = `${resolved?.provider}:${resolved?.name}`;
              const getKillSwitchStatus = () => resolveKillSwitchStatus(
                async () => {
                  const statusRes = await this.ctx.env.REGISTRY!.get(this.ctx.env.REGISTRY!.idFromName('auth'))
                    .fetch(new Request('https://registry/public/model-status'));
                  if (!statusRes.ok) return null;
                  const body = await statusRes.json() as { integratedModelsEnabled?: boolean; disabledModels?: string[] };
                  const status: KillSwitchStatus = {
                    integratedModelsEnabled: body.integratedModelsEnabled !== false,
                    disabledModels: Array.isArray(body.disabledModels) ? body.disabledModels : [],
                  };
                  this.killSwitchCache = status;
                  void this.ctx.storage.put?.(KILL_SWITCH_CACHE_KEY, status);
                  return status;
                },
                async () => {
                  if (this.killSwitchCache != null) return this.killSwitchCache;
                  const stored = await this.ctx.storage.get?.<KillSwitchStatus>(KILL_SWITCH_CACHE_KEY);
                  if (stored) this.killSwitchCache = stored;
                  return stored ?? null;
                },
              );
              const getDisabledMsg = (status: KillSwitchStatus) => killSwitchRefusal(status, {
                isCustom: !!customModel,
                requestedId: requestedModel,
                displayName: resolvedDisplayName,
                modelKey: resolvedModelKey,
              });
    
              // Fail closed: if the registry is unreachable and there is no prior
              // cached status, refuse rather than silently allowing a disabled model.
              const initialStatus = await getKillSwitchStatus();
              if (initialStatus === null) {
                sendError('Model status could not be verified. Please try again.');
                return;
              }
              const initialRefusal = getDisabledMsg(initialStatus);
              if (initialRefusal) {
                sendError(initialRefusal);
                return;
              }
    
              const assetPaths = new Set<string>();
              const extensions = prepareCapabilities(this.ctx.builderService(this.ctx.senderUserId(connection) || ''), data.attachmentIds, abortController.signal, async files => {
                if (!this.ctx.writeEpoch.accepts(epoch)) throw new Error('Generation was superseded.');
                abortController.signal.throwIfAborted();
                this.ctx.storage.transactionSync!(() => {
                  for (const [path, content] of Object.entries(files)) {
                    const existing = this.ctx.runSql`SELECT content FROM project_files WHERE path=${path}`[0]?.content;
                    if (existing !== undefined && existing !== content) throw new Error('An uploaded asset was modified. Re-upload it to preserve your changes.');
                    if (!this.ctx.upsertFile(path, content)) throw new Error('Asset exceeds project storage limits.');
                  }
                });
                for (const [path, content] of Object.entries(files)) {
                  assetPaths.add(path);
                  const event = JSON.stringify({ type: 'file_updated', path, content });
                  try { connection.send(event); this.ctx.broadcast(event, [connection.id]); } catch (e) { noteSendFailure(e); }
                }
                if (this.activeGeneration?.epoch === epoch) this.activeGeneration.filesChanged = true;
                await this.ctx.backupToR2(this.ctx.senderUserId(connection));
              }, plannerMode);
              const vision = acceptsImageInput(requestedModel);
              systemPrompt += extensions.context;
              if (!vision && extensions.attachments.some(file => file.mime.startsWith('image/'))) {
                const ai = this.ctx.env?.AI;
                if (ai) {
                  const imageFiles = extensions.attachments.filter(f => f.mime.startsWith('image/')).slice(0, 3);
                  const descriptions: string[] = [];
                  for (const img of imageFiles) {
                    if (abortController.signal.aborted) break;
                    try {
                      const visionCall = ai.run('@cf/meta/llama-4-scout-17b-16e-instruct' as any, { messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe this image concisely in 2-3 sentences. Focus on colors, layout, content, and any text visible.' }, { type: 'image_url', image_url: { url: img.dataUrl } }] }], max_tokens: 300 });
                      visionCall.catch(() => {});
                      let visionTimer: ReturnType<typeof setTimeout> | undefined;
                      const visionResult = await withAbortSignal<any>(Promise.race([visionCall, new Promise((_, reject) => { visionTimer = setTimeout(() => reject(new Error('Vision model timed out')), 15_000); })]), abortController.signal).finally(() => clearTimeout(visionTimer));
                      const desc = visionResult?.response || visionResult?.choices?.[0]?.message?.content || '';
                      const safeName = String(img.name || 'image').replace(/["\n\r]/g, '_');
                      if (desc) descriptions.push(`[Image "${safeName}"]: ${desc}`);
                      else descriptions.push(`[Image "${safeName}"]: (description unavailable)`);
                    } catch {
                      const safeName = String(img.name || 'image').replace(/["\n\r]/g, '_');
                      descriptions.push(`[Image "${safeName}"]: (description unavailable)`);
                    }
                  }
                  systemPrompt += `\nImage descriptions from a vision model (the images themselves are not visible to you, but you can use them in the app via use_attachment):\n${descriptions.join('\n')}`;
                } else {
                  systemPrompt += '\nThis model has no verified image-input support. You can use the original image in the app with use_attachment, but cannot see or describe its pixels. For visual analysis ask the user to select Kimi K2.7 Code or Claude Sonnet 6; never invent image content.';
                }
              }
              const nativeMessages = imageMessages(inputMessages, extensions.attachments, vision);
    
              // The client's token request is capped server-side (lib/models).
              const requestedMaxTokens = capTokenLimit(controls.maxTokens, resolved);
    
              const emitCostEstimate = (promptText: string, msgs: Array<{ content: string | unknown }>) => {
                const systemTokens = estimateTokens(promptText);
                const historyTokens = msgs.reduce((sum, m) => {
                  if (typeof m.content === 'string') return sum + estimateTokens(m.content);
                  if (Array.isArray(m.content)) {
                    return sum + (m.content as Array<{ type?: string; text?: string }>).reduce((s, part) => s + (part.type === 'text' && part.text ? estimateTokens(part.text) : part.type === 'image_url' ? 85 : 0), 0);
                  }
                  return sum;
                }, 0);
                const estimatedInputTokens = systemTokens + historyTokens;
                const costEstimate = JSON.stringify({ type: 'cost_estimate', model: resolved.name, estimatedInputTokens, maxOutputTokens: requestedMaxTokens });
                try { connection.send(costEstimate); } catch (e) { noteSendFailure(e); }
              };
    
    
              const toolWrittenPaths = assetPaths;
              const inspectedFiles = new Map<string, string>();
              const agentTools = createToolHandlers({
                runSql: this.ctx.runSql.bind(this),
                writeEpoch: this.ctx.writeEpoch,
                upsertFile: this.ctx.upsertFile.bind(this.ctx),
                isHarnessEntry: isHarnessEntryModule,
                activeGeneration: this.activeGeneration,
                backupToR2: this.ctx.backupToR2.bind(this.ctx),
                broadcast: this.ctx.broadcast.bind(this.ctx),
                senderUserId: this.ctx.senderUserId.bind(this.ctx),
                transact: (fn: () => any) => this.ctx.storage.transactionSync!(fn),
                env: env as { AI?: any },
                connection,
                epoch,
                abortController,
                accounting,
                inspectedFiles,
                toolWrittenPaths,
                actualPrompt,
                plannerMode,
                modes,
                getKillSwitchStatus,
                getDisabledMsg,
                capabilityTools: sdkCapabilities(extensions.capabilities),
              });
              const instrumentedTools = instrumentTools(agentTools, connection, this.ctx.broadcast.bind(this.ctx));
    
    
              const fileOutputRetry = actualPrompt.includes(AUTO_RETRY_FULL_APP_MARKER);
              if (fileOutputRetry) systemPrompt += '\nFILE-OUTPUT RECOVERY: Tool use is disabled for this response. Work from the supplied project source and conversation. Do not emit DSML, function calls, or a plan to inspect files. Return the requested implementation as complete <file path="/...">content</file> blocks. Never claim you ran a tool.';
    
              emitCostEstimate(systemPrompt, nativeMessages);
    
              // 1. Cloudflare Workers AI edge binding
              if (resolved.provider === 'cloudflare') {
                // B4/B5 tool-less parity with the SDK path: question, destructive
                // and ambiguous turns must offer zero file tools regardless of
                // provider. Previously only planner/file-retry disabled them here,
                // so the default Workers AI model could still write files in
                // question mode.
                const toolLess = plannerMode || fileOutputRetry || !!modes?.destructiveMode || !!modes?.questionMode || !!modes?.ambiguousMode;
                // expectFiles stays true for the file-output retry itself: that
                // turn demands files, so a prose-only reply must be treated as an
                // incomplete generation and surface an error.
                const expectFiles = !plannerMode && !modes?.questionMode && !modes?.destructiveMode && !modes?.ambiguousMode;
                const cfResult = await this.runCloudflareWorkersAI(
                  resolved.id,
                  systemPrompt,
                  inputMessages,
                  connection,
                  actualPrompt,
                  requestedMaxTokens,
                  epoch,
                  expectFiles,
                  toolLess ? {} : { ...extensions.capabilities, ...await capabilitiesFromTools(Object.fromEntries(Object.entries(agentTools).filter(([name]) => ['read_file', 'list_files', 'search_files', 'check_syntax', 'write_file', 'edit_file', 'batch_edit', 'delete_file'].includes(name))), abortController.signal) }, extensions.attachments, assetPaths, deferTerminal, maxSteps, controls.fastMode,
                  async () => {
                    const iterStatus = await getKillSwitchStatus();
                    if (iterStatus !== null) {
                      const refusal = getDisabledMsg(iterStatus);
                      if (refusal) { midGenerationKillSwitch = refusal; abortController.abort(); return refusal; }
                    }
                    return null;
                  }
                );
                // P0-4: a queued repair turn means the build is not done — hold the
                // completed status (and the durable job) until the repair turn
                // resolves it via resolveCompletenessRepair().
                if (cfResult.repairMarker && this.noteRepairQueued(accounting.id, actualPrompt, cfResult.repairMarker)) repairQueuedThisTurn = true;
                completed = cfResult.ok && !repairQueuedThisTurn;
                if (abortController.signal.aborted) throw abortController.signal.reason;
                if (!cfResult.ok && this.ctx.writeEpoch.accepts(epoch) && !this.currentAbortController?.signal.aborted) {
                  sendError(`Generation with "${resolved.name}" failed. Try again, or pick a different model.`);
                }
                return;
              }
    
              let maxTokensForModel: number | undefined = undefined;
              // For custom models this stays the synthetic entry (provider 'custom'),
              // so the Bedrock-alias logic below is skipped.
              let model: AllowedModel = resolved;
    
              // Custom admin-added models use an OpenAI-compatible client pointed
              // at their own base URL and API key.
              if (customModel) {
                // Defense-in-depth re-validation: the URL was checked at registration
                // time, but re-checking here catches any record written before the
                // guard existed or modified outside the normal admin flow.
                const { assertSafeCustomModelUrl } = await import('./ssrf');
                const cmUrlError = assertSafeCustomModelUrl(customModel.baseUrl);
                if (cmUrlError) {
                  sendError(`Custom model base URL is not allowed: ${cmUrlError}`);
                  return;
                }
                try {
                  const { createOpenAI } = await import('@ai-sdk/openai');
                  // Wrap fetch to inject missing tool_calls[i].index into SSE stream
                  // (required by the ai-sdk OpenAI parser; Gemini and some other
                  // compatible endpoints omit this field).
                  const patchedFetch: typeof fetch = async (input, init) => {
                    const resp = await fetch(input, init);
                    const ct = resp.headers.get('content-type') ?? '';
                    if (!ct.includes('text/event-stream') || !resp.body) return resp;
                    const decoder = new TextDecoder();
                    const encoder = new TextEncoder();
                    let buf = '';
                    const transform = new TransformStream<Uint8Array, Uint8Array>({
                      transform(chunk, ctrl) {
                        buf += decoder.decode(chunk, { stream: true });
                        const lines = buf.split('\n');
                        buf = lines.pop() ?? '';
                        for (const line of lines) ctrl.enqueue(encoder.encode(fixToolCallIndex(line) + '\n'));
                      },
                      flush(ctrl) { if (buf) ctrl.enqueue(encoder.encode(fixToolCallIndex(buf) + '\n')); },
                    });
                    return new Response(resp.body.pipeThrough(transform), { status: resp.status, headers: resp.headers });
                  };
                  const custom = createOpenAI({ apiKey: customModel.apiKey, baseURL: customModel.baseUrl, compatibility: 'compatible', fetch: patchedFetch } as any);
                  aiModel = custom.chat(customModel.modelId);
                  maxTokensForModel = MAX_OUTPUT_TOKENS;
                } catch (err) {
                  sendError(err instanceof Error ? err.message : 'Custom model is not configured');
                  return;
                }
              } else {
                // Anthropic-family models may be served by the native API or by Bedrock;
                // selectModelTransport picks whichever credential this deployment has.
                model = selectModelTransport(resolved, creds);
    
                try {
                  const built = providerModel(model, env, creds);
                  aiModel = built.aiModel;
                  maxTokensForModel = built.maxTokens;
                } catch (err) {
                  sendError(err instanceof Error ? err.message : 'Model provider is not configured');
                  return;
                }
    
                // No cross-provider fallback. If the required credential is missing,
                // the request fails with a clear message instead of rerouting.
                if (!aiModel) {
                  sendError(`Model "${model.name}" needs ${model.provider} credentials, which are not configured`);
                  return;
                }
              }
    
              // Staging is for fresh full-app builds only. Running the three-stage
              // pipeline for questions, destructive confirmations, clarifying
              // prompts, resumes, or edits to an existing app triples the model
              // calls, shows misleading "Step 1 of 3" notices, and the stage
              // instructions contradict the tool-less mode blocks.
              const isFreshBuild = modes?.isFreshBuild === true;
              // shouldUseStagedPipeline is unit-tested (prompt-mode.test.ts); the
              // VITEST guard stays at the call site so tests can exercise the logic.
              const isStaged = shouldUseStagedPipeline({ plannerMode, modes, resumeChain, isFreshBuild, actualPrompt, fileOutputRetry })
                && !(typeof process !== 'undefined' && process.env?.VITEST);
              const pipelineStages = isStaged ? [
                { stageId: 'architecture', notice: 'Step 1 of 3: Architecture & Schema', extraPrompt: '\n\nSTAGE 1 INSTRUCTION: Write ONLY schema/migration files, shared contract types, and config files (e.g. migrations/*.sql, shared/*.ts, package.json). Do NOT write App.tsx, any /src/components/*.tsx files, or worker/index.ts yet.' },
                { stageId: 'layout', notice: 'Step 2 of 3: Frontend components', extraPrompt: '\n\nSTAGE 2 INSTRUCTION: Write ALL frontend files. Start with /src/App.tsx FIRST (mandatory write order), then write EVERY component file it imports — all /src/components/*.tsx. Write every sub-import too. Do NOT write worker/index.ts or backend routes yet.' },
                { stageId: 'features', notice: 'Step 3 of 3: Backend & finish', extraPrompt: '\n\nSTAGE 3 INSTRUCTION: Write the backend: worker/index.ts routes and any remaining files. All frontend files must already be written before this stage.' }
              ] : [
                { stageId: 'single', notice: 'The app builder is working…', extraPrompt: '' }
              ];
    
              let currentNativeMessages = [...nativeMessages];
    
              try {
                const candidates = model.provider === 'aws'
                  ? (BEDROCK_ALIASES[model.id] || [model.id])
                  : [model.id];
    
                let lastStreamError: unknown = null;
    
                // Custom OpenAI-compatible endpoints vary wildly in tool support.
                // When the tool payload itself is rejected, the stage retries once
                // tool-less — the <file> text protocol still delivers the app.
                let customToolsDisabled = false;
    
                // Atria-Dawn-Preview is fast enough to generate a full app in one
                // pass without the tool loop. Skipping read_file / write_file /
                // check_syntax round-trips cuts generation from ~30 min to ~3 min.
                // On existing projects, direct generation must NOT say "write ALL
                // files" — that contradicts the EXISTING project rules and causes
                // full rewrites. Instead, remind the model it can only see workspace
                // context and must use <edit> for existing files.
                const directGeneration = model.provider === 'atria';
                if (directGeneration) {
                  if (isFreshBuild) {
                    systemPrompt += '\nDIRECT GENERATION: Tool use is disabled. Return the complete implementation as <file path="/...">content</file> blocks in a single response. Write ALL files needed for a working app. Do not emit function calls or plan to inspect files.';
                  } else {
                    systemPrompt += '\nDIRECT GENERATION: Tool use is disabled. You can only see the workspace context above. Change existing files with <edit> blocks (search/replace). Create only genuinely new files with <file> blocks. Never rewrite a file you cannot see in full — say what is missing instead. Do not emit function calls.';
                  }
                }
    
                for (let stageIdx = 0; stageIdx < pipelineStages.length; stageIdx++) {
                  const stage = pipelineStages[stageIdx];
                  const isLastStage = stageIdx === pipelineStages.length - 1;
                  const stageSystemPrompt = systemPrompt + stage.extraPrompt;
                  const stageToolWrittenPaths = new Set(toolWrittenPaths);
    
                  let streamErrorCaught: unknown = null;
                  let stageCompleted = false;
    
                  let transientRetries = 0;
                  for (let idx = 0; idx < candidates.length; idx++) {
                    const currentModelId = candidates[idx];
                    let activeAiModel = aiModel;
                    if (model.provider === 'aws' && currentModelId !== model.id) {
                      activeAiModel = createBedrockClient(creds)(currentModelId);
                    }
    
                    streamErrorCaught = null;
                    let streamedText = '';
                    let displayContent = '';
                    const transcript = new ToolTranscriptStream();
                    // Token-level WS frames cost one send + one client re-render per
                    // token. Coalesce deltas into 50 ms frames instead: ~20 updates a
                    // second reads as smooth typing while cutting frames ~100x. Every
                    // non-stream message (tool_call, files_changed, done, error) must
                    // flush first so ordering is preserved.
                    let pendingFrame = '';
                    let flushTimer: ReturnType<typeof setTimeout> | null = null;
                    const flushFrame = () => {
                      if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
                      if (!pendingFrame) return;
                      const frame = pendingFrame;
                      pendingFrame = '';
                      const message = JSON.stringify({ type: 'stream', chunk: { response: frame, done: false } });
                      try { connection.send(message); } catch (e) { noteSendFailure(e); }
                      try { this.ctx.broadcast(message, [connection.id]); } catch (e) { noteSendFailure(e); }
                    };
                    const sendDisplay = (response: string) => {
                      if (!response) return;
                      displayContent += response;
                      this.rememberGenerationText(response, epoch);
                      pendingFrame += response;
                      if (flushTimer === null) flushTimer = setTimeout(flushFrame, 50);
                    };
                    
                    if (stageIdx > 0) emitCostEstimate(stageSystemPrompt, currentNativeMessages);
                    // F-4: per-stage idle watchdog — abort the stream if no chunk
                    // arrives within the deadline. First chunk gets 120s (hanging
                    // upstream); subsequent chunks get 60s (stalled stream body).
                    let idleTimerFirstChunk = true;
                    let idleTimer: ReturnType<typeof setTimeout> | undefined;
                    const resetIdleTimer = () => {
                      clearTimeout(idleTimer);
                      const ms = idleTimerFirstChunk ? STREAM_FIRST_CHUNK_TIMEOUT_MS : STREAM_IDLE_TIMEOUT_MS;
                      idleTimer = setTimeout(() => {
                        if (!abortController.signal.aborted) {
                          abortController.abort(new Error('The model stream stalled; ran out of time'));
                        }
                      }, ms);
                    };
                    resetIdleTimer();
    
                    const streamOptions: Parameters<typeof streamText>[0] = {
                      model: meteredModel(activeAiModel, () => { accounting.providerCalls++; }),
                      // Anthropic and Bedrock support prompt caching. Split the system prompt
                      // into a stable prefix (base rules, unchanged per project) and a dynamic
                      // suffix (file context, memory, mode blocks). Marking the prefix with
                      // cacheControl means cache hits cover 90%+ of system tokens on follow-up
                      // edits and multi-stage retries. TTL is 5 minutes. Other providers use a
                      // plain string.
                      system: ((): SystemModelMessage | SystemModelMessage[] | string => {
                        if (model.provider === 'anthropic') {
                          if (staticSystemPart) {
                            return [
                              { role: 'system' as const, content: staticSystemPart, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
                              { role: 'system' as const, content: stageSystemPrompt.slice(staticSystemPart.length) },
                            ] satisfies SystemModelMessage[];
                          }
                          return { role: 'system' as const, content: stageSystemPrompt, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } } satisfies SystemModelMessage;
                        }
                        if (model.provider === 'aws') {
                          if (staticSystemPart) {
                            return [
                              { role: 'system' as const, content: staticSystemPart, providerOptions: { bedrock: { cachePoint: { type: 'default' } } } },
                              { role: 'system' as const, content: stageSystemPrompt.slice(staticSystemPart.length) },
                            ] satisfies SystemModelMessage[];
                          }
                          return { role: 'system' as const, content: stageSystemPrompt, providerOptions: { bedrock: { cachePoint: { type: 'default' } } } } satisfies SystemModelMessage;
                        }
                        return stageSystemPrompt;
                      })(),
                      messages: currentNativeMessages,
                      // B4/B5: destructive and question modes are tool-less — the model
                      // answers in text only; zero file operations are possible.
                      tools: plannerMode || fileOutputRetry || directGeneration || customToolsDisabled || modes?.destructiveMode || modes?.questionMode || modes?.ambiguousMode ? undefined : instrumentedTools,
                      toolChoice: fileOutputRetry || directGeneration || customToolsDisabled ? 'none' : 'auto',
                      stopWhen: isStepCount(maxSteps + 1),
                      prepareStep: async ({ stepNumber, messages }) => {
                        // Re-check kill-switch on every tool-loop iteration so an
                        // admin disable mid-generation takes effect before the next
                        // LLM call rather than waiting for the user's next turn.
                        const iterStatus = await getKillSwitchStatus();
                        if (iterStatus !== null) {
                          const refusal = getDisabledMsg(iterStatus);
                          if (refusal) {
                            midGenerationKillSwitch = refusal;
                            abortController.abort();
                            return undefined;
                          }
                        }
                        if (stepNumber >= maxSteps) {
                          return {
                            activeTools: [],
                            toolChoice: 'none',
                            messages: [...messages, { role: 'user', content: 'The tool phase is complete. Finish the original task using the results above. Return remaining implementation as complete file blocks. Report any checks that still need to run.' }],
                          };
                        }
                        return undefined;
                      },
                      maxOutputTokens: requestedMaxTokens ?? maxTokensForModel,
                      maxRetries: 0,
                      abortSignal: abortController.signal,
                      onError: (event) => {
                        const err = event?.error || event;
                        console.error(`streamText error (${model.name}, id=${currentModelId}):`, err);
                        streamErrorCaught = err;
                      },
                      onChunk: (event) => {
                        if (!this.ctx.writeEpoch.accepts(epoch) || abortController.signal.aborted) {
                          abortController.abort();
                          return;
                        }
                        idleTimerFirstChunk = false;
                        resetIdleTimer();
                        // The ai-sdk has shipped three spellings of a text chunk
                        // (textDelta, text, delta); accept all of them.
                        const chunk = (event?.chunk ?? event) as {
                          type?: string; textDelta?: unknown; text?: unknown; delta?: unknown; toolName?: unknown;
                        } | undefined;
                        const textDelta =
                          chunk?.textDelta ??
                          chunk?.text ??
                          chunk?.delta ??
                          (chunk?.type === 'text-delta' ? chunk.text ?? chunk.textDelta : undefined);
    
                        if (chunk?.type === 'text-delta' && textDelta) {
                          streamedText += String(textDelta);
                          sendDisplay(transcript.push(String(textDelta)));
                        }
    
                        if (chunk?.type === 'tool-call') {
                          flushFrame();
                          sendDisplay(toolSummaryMarkup([String(chunk.toolName || 'tool')]));
                          let callArgs: Record<string, unknown> | undefined;
                          try {
                            const raw = (chunk as any).args ?? (chunk as any).input;
                            callArgs = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : undefined;
                          } catch { /* ignore malformed args */ }
                          const safeArgs: Record<string, unknown> = {};
                          if (callArgs?.path) safeArgs.path = callArgs.path;
                          if (callArgs?.query) safeArgs.query = callArgs.query;
                          if (callArgs?.oldPath) safeArgs.oldPath = callArgs.oldPath;
                          if (callArgs?.newPath) safeArgs.newPath = callArgs.newPath;
                          if (callArgs?.url) safeArgs.url = callArgs.url;
                          if (callArgs?.filename) safeArgs.filename = callArgs.filename;
                          const toolMsg = JSON.stringify({ type: 'tool_call', tool: chunk.toolName, args: safeArgs });
                          try { connection.send(toolMsg); } catch (e) { noteSendFailure(e); }
                          try { this.ctx.broadcast(toolMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
                        }
                      }
                    };
    
                    try {
                      try { connection.send(JSON.stringify({ type: 'generation_notice', message: stage.notice, stage: stage.stageId, requestId: data.idempotencyKey })); } catch (e) { noteSendFailure(e); }
                      const result = streamText(streamOptions);
                      const finalText = await withAbortSignal(result.text, abortController.signal);
                      clearTimeout(idleTimer);
                      const usage = await withAbortSignal(result.totalUsage, abortController.signal);
                      this.captureUsage(usage.inputTokens, usage.outputTokens, usage.inputTokenDetails);
                      const inTok = usage.inputTokens ?? 0;
                      const hitTok = usage.inputTokenDetails?.cacheReadTokens ?? 0;
                      const writeTok = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
                      const hitPct = (inTok + hitTok) > 0 ? Math.round(hitTok / (inTok + hitTok) * 100) : 0;
                      console.log(`[gen] input=${inTok} cache_hit=${hitTok}(${hitPct}%) cache_write=${writeTok}`);
                      if (streamErrorCaught) throw streamErrorCaught;
                      if (!this.ctx.writeEpoch.accepts(epoch)) return;
                      flushFrame();
                      const text = stripThinkingBlocks(streamedText || finalText);
                      if (!streamedText) sendDisplay(transcript.push(finalText));
                      sendDisplay(transcript.push('', true));
                      const stageNewPaths = new Set([...toolWrittenPaths].filter(p => !stageToolWrittenPaths.has(p)));
                      if (!text.trim() && (plannerMode || isConversationalPrompt(actualPrompt)) && stageNewPaths.size === 0) throw new Error('The model returned no response. Please retry.');
    
                      const extractionStart = Date.now();
                      const extraction = this.ctx.fileExtractor.extractAndSaveFiles(text, connection, epoch, plannerMode || !!modes?.destructiveMode || !!modes?.questionMode || !!modes?.ambiguousMode, deferTerminal);
                      extraction.writtenPaths = [...new Set([...extraction.writtenPaths, ...stageNewPaths])];
                      extraction.writtenCount = extraction.writtenPaths.length;
                      if (isLastStage) {
                        accounting.generationMs = extractionStart - accounting.startedAt;
                        accounting.extractionMs = Date.now() - extractionStart;
                      }
    
                      // Continuation stages must not appear as user turns: the
                      // [AUTO-CONTINUE] prefix marks them internal (hidden on
                      // history load) and boundedConversation filters them out of
                      // future model context.
                      this.ctx.saveGenerationTurn(stageIdx === 0 ? actualPrompt : '[AUTO-CONTINUE] Continue to the next stage.', displayContent || (stageNewPaths.size ? `Updated ${[...stageNewPaths].join(', ')}.` : ''), epoch);
    
                      if (stageNewPaths.size > 0) {
                        flushFrame();
                        const changed = JSON.stringify({ type: 'files_changed' });
                        try { connection.send(changed); } catch (e) { noteSendFailure(e); }
                        try { this.ctx.broadcast(changed, [connection.id]); } catch (e) { noteSendFailure(e); }
                      }
                      // P0-4: track whether this turn queued a repair/retry turn so the
                      // completed status is held until the repair turn resolves.
                      if (extraction.triggerQueued && this.noteRepairQueued(accounting.id, actualPrompt, extraction.triggerMarker)) repairQueuedThisTurn = true;
                      const retryQueued = this.ctx.fileExtractor.handleIncompleteAppGeneration({ actualPrompt, responseText: text, extraction, connection, expectFiles: !plannerMode && isLastStage, epoch, deferTerminal });
                      if (retryQueued && this.noteRepairQueued(accounting.id, actualPrompt, AUTO_RETRY_FULL_APP_MARKER)) repairQueuedThisTurn = true;
    
                      if (isLastStage) {
                        const doneMsg = JSON.stringify({ type: 'stream', chunk: { response: '', done: true } });
                        // QA B11: ensure the production build entry point exists.
                        // The model cannot write harness entries; the platform creates it.
                        // Skip in question/destructive/ambiguous modes (no app generated).
                        if (!modes?.questionMode && !modes?.destructiveMode && !modes?.ambiguousMode && !plannerMode) {
                          try { this.ctx.ensureEntryPointExists(); } catch { /* build will surface if missing */ }
                          // Final safety net: catch imports that dangle because generation
                          // cut off between batches (per-batch check can't see the future).
                          // Only when this generation wrote files — a greeting or text
                          // reply must never trigger a hidden file-repair turn.
                          if (extraction.writtenCount > 0) {
                            const checksStart = Date.now();
                            try {
                              const allFiles = new Map<string, string>(
                                (this.ctx.runSql<{ path: string; content: string }>`SELECT path, content FROM project_files`)
                                  .map(r => [r.path, r.content ?? ''] as [string, string])
                              );
                              const results = await Promise.all(
                                [
                                  () => this.checkMissingAppEntry(allFiles, connection),
                                  () => this.checkFinalCompleteness(allFiles, connection),
                                  () => this.checkNoPhantomAuthHooks(allFiles, connection),
                                  () => this.checkVerificationPlanFile(allFiles, connection),
                                  () => this.checkApiRouteCoverage(allFiles, connection),
                                ].map(fn => { try { return Promise.resolve(fn()); } catch (e) { console.warn('Post-gen check threw:', e); return Promise.resolve(null); } })
                              );
                              const failures = results.filter((p): p is string => p !== null);
                              if (failures.length > 0) {
                                const combined = failures.join('\n\n---\n\n');
                                const marker = combined.split('\n')[0];
                                deferTerminal(() => {
                                  try { connection.send(JSON.stringify({ type: 'trigger-auto-reply', message: combined })); } catch (e) { noteSendFailure(e); }
                                });
                                if (this.noteRepairQueued(accounting.id, actualPrompt, marker)) repairQueuedThisTurn = true;
                              }
                            } catch (e) { console.warn('Post-gen checks threw:', e); }
                            accounting.checksMs = Date.now() - checksStart;
                          }
                        }
                        // Always send stream.done so the client knows the response
                        // stream has ended. When a repair/retry was queued we do
                        // NOT set completed=true — the job status stays pending
                        // until the repair turn resolves (P0-4).
                        deferTerminal(() => {
                          flushFrame();
                          try { connection.send(doneMsg); } catch (e) { noteSendFailure(e); }
                          try { this.ctx.broadcast(doneMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
                        });
                        if (!repairQueuedThisTurn) {
                          completed = true;
                          if (extraction.writtenCount > 0) {
                            try { this.ctx.saveCheckpoint('After generation'); } catch { /* non-fatal */ }
                          }
                        }
                      } else {
                        currentNativeMessages.push({ role: 'assistant', content: text });
                        currentNativeMessages.push({ role: 'user', content: 'Great. Proceed to the next stage and output the remaining files. Ensure you use the exact same architecture.' });
                      }
                      
                      lastStreamError = null;
                      stageCompleted = true;
                      break;
                    } catch (streamErr) {
                      clearTimeout(idleTimer);
                      flushFrame();
                      const effectiveErr: unknown = streamErrorCaught || streamErr;
                      const errMessage = errorMessage(effectiveErr);
                      lastStreamError = effectiveErr;
                      if (!streamedText && toolWrittenPaths.size === 0 && !abortController.signal.aborted && (/model identifier is invalid/i.test(errMessage) || /ResourceNotFoundException/i.test(errMessage) || /is not authorized/i.test(errMessage) || /reached the end of its life/i.test(errMessage)) && idx + 1 < candidates.length) {
                        console.warn(`Bedrock ID ${currentModelId} failed (${errMessage}); retrying alternate profile ${candidates[idx + 1]}`);
                        continue;
                      }
                      const classification = classifyGenerationError(effectiveErr);
                      // A custom endpoint rejecting the tool payload (400s naming
                      // tools/functions/schema) is not a transient failure — drop
                      // the tools and retry the stage once with plain text output.
                      // Gate on no streamed text AND no tool writes this stage — tool summary
                      // markup sets displayContent even before any real output, poisoning the
                      // original !displayContent check after the first tool call.
                      if (customModel && !customToolsDisabled && !streamedText && toolWrittenPaths.size === stageToolWrittenPaths.size && !abortController.signal.aborted
                        && /\btools?\b|\bfunctions?\b|schema|400|bad request|invalid (?:param|argument|request)/i.test(errMessage)) {
                        customToolsDisabled = true;
                        console.warn(`Custom model ${customModel.name} rejected tool calling; retrying stage "${stage.stageId}" without tools`);
                        try { connection.send(JSON.stringify({ type: 'generation_notice', message: 'This model does not support tool calls — switching to direct file output…', stage: stage.stageId, requestId: data.idempotencyKey })); } catch (e) { noteSendFailure(e); }
                        idx--; // Retry the same candidate; the loop increment restores idx.
                        continue;
                      }
                      // Transient provider failures (rate limit, overload, dropped
                      // connection, timeout) get automatic retries. When partial
                      // output was streamed, a stream_clear resets the client first.
                      if (classification.retryable && !abortController.signal.aborted && transientRetries < GENERATION_TRANSIENT_RETRIES && accounting.providerCalls < MAX_LLM_CALLS_PER_GENERATION) {
                        transientRetries += 1;
                        if (displayContent) {
                          // Text was already streamed to the client — tell it to
                          // discard the partial output so the retry starts clean.
                          const clearMsg = JSON.stringify({ type: 'stream_clear', requestId: data.idempotencyKey });
                          try { connection.send(clearMsg); } catch (e) { noteSendFailure(e); }
                          try { this.ctx.broadcast(clearMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
                          displayContent = '';
                          streamedText = '';
                          // Reset the reconnect buffer so a late-joining client
                          // doesn't see stale partial text from the failed attempt.
                          if (this.activeGeneration && this.activeGeneration.epoch === epoch) {
                            this.activeGeneration.response = '';
                            this.activeGeneration.truncated = false;
                          }
                        }
                        console.warn(`Transient provider error for ${model.name} (${classification.category}: ${errMessage}); retrying stage "${stage.stageId}" (attempt ${transientRetries + 1})`);
                        try { connection.send(JSON.stringify({ type: 'generation_notice', message: `${classification.userMessage} Retrying…`, stage: stage.stageId, requestId: data.idempotencyKey })); } catch (e) { noteSendFailure(e); }
                        // Tests cannot wait out real exponential backoff.
                        const retryDelayMs = typeof process !== 'undefined' && process.env?.VITEST ? 10 : 1_000 * 2 ** transientRetries;
                        await new Promise<void>((resolve) => {
                          const timer = setTimeout(resolve, retryDelayMs);
                          abortController.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
                        });
                        if (abortController.signal.aborted) throw abortController.signal.reason ?? new Error('Generation stopped');
                        idx--; // Retry the same candidate; the loop increment restores idx.
                        continue;
                      }
                      if (classification.category === 'unknown') throw new Error(errMessage);
                      throw new GenerationUserError(classification, effectiveErr);
                    }
                  }
                  
                  if (!stageCompleted && lastStreamError) {
                    break;
                  }
                }
    
                if (lastStreamError) {
                  throw new Error(errorMessage(lastStreamError));
                }
              } finally {
                // Inner cleanup handled by outer finally block
              }
            });
          });
        } catch (err) {
          // Kill-switch fired in the tool loop's prepareStep: abort was called
          // after setting midGenerationKillSwitch. Send the specific refusal
          // message and treat the run as a non-retryable failure (the model is
          // disabled; retrying would hit the same wall).
          if (midGenerationKillSwitch !== null) {
            sendError(midGenerationKillSwitch);
            jobOutcome = { kind: 'failed', error: midGenerationKillSwitch };
            return;
          }
          // FIX (high): the catch here used to call runCloudflareWorkersAI with a
          // hardcoded '@cf/meta/llama-3.3-70b-instruct-fp8-fast'. That silently
          // substituted a different model for the one the user selected and was
          // billed for — directly contradicting the zero-fallback policy enforced
          // everywhere else in this file, and invalidating any per-model testing.
          // A failure is now reported as a failure.
          const aborted = (err instanceof Error && err.name === 'AbortError') || !this.ctx.writeEpoch.accepts(epoch);
          if (aborted) {
            console.log('Generation aborted by user or timeout');
            // A timeout aborts with the custom 'Generation exceeded …' error as
            // the reason; a user stop (or disconnect stop) aborts with no reason.
            const reason = abortController.signal.reason;
            const timedOut = reason instanceof Error && /Generation exceeded/.test(reason.message);
            jobOutcome = {
              kind: 'interrupted',
              error: timedOut
                ? 'The builder ran out of time before finishing your app.'
                : 'The build was stopped.',
            };
            return;
          }
          console.error('Error handling message in ChatAgent:', err);
          let cleanError = ((err instanceof Error ? err.message : '') || 'Failed to process AI generation.').replace(/^undefined:\s*/i, '');
          // Never surface raw provider internals (e.g. "8005: Internal server error",
          // "AiError: 3046", stack traces) in chat or history — use the classifier's
          // user-facing message for those. Meaningful messages the code already
          // produced (e.g. "Quota exceeded", "The model returned no response") are
          // left alone. The raw error stays in console.error above.
          if (!(err instanceof AiBudgetError) && !(err instanceof GenerationUserError)
            && /\b[38]\d{3}\b|internal server error|AiError/i.test(cleanError)) {
            try {
              const classified = classifyGenerationError(err);
              if (classified.category !== 'unknown' && classified.userMessage) cleanError = classified.userMessage;
            } catch { /* keep raw as fallback */ }
          }
          if (err instanceof AiBudgetError && err.status === 429) {
            // Preserve the user's prompt in the server-side conversation history even
            // when the concurrent generation limit is exceeded, so it survives a
            // page reload and cross-device sessions. Skipped when a turn was already
            // saved for this epoch (e.g. a completed stage before a later failure).
            if (this.turnSavedForEpoch !== epoch) {
              try { this.ctx.saveGenerationTurn(actualPrompt, cleanError, epoch); } catch { }
            }
            // Distinguish daily-budget exhaustion from concurrent-generation capacity
            // so the frontend can give the right guidance (midnight UTC reset vs.
            // wait-for-running-apps). Never conflate the two.
            const code = err.kind === 'daily' ? 'daily_budget_exhausted' : err.kind === 'concurrency' ? 'concurrency_limited' : 'rate_limited';
            sendError(cleanError, code);
            // Quota, concurrency and rate limits are account states, not
            // interruptions — resuming would just hit the same wall.
            jobOutcome = { kind: 'failed', error: cleanError };
          } else {
            // A failed first prompt used to vanish from the server-side
            // conversation: only the 429 branch above preserved it. Without this,
            // a new tab or device loading history — or the next turn's model
            // context — never sees what the user asked. (Aborts return earlier;
            // an intentional stop stays unsaved.)
            if (this.turnSavedForEpoch !== epoch) {
              try { this.ctx.saveGenerationTurn(actualPrompt, cleanError, epoch); } catch { }
            }
            sendError(cleanError, err instanceof GenerationUserError ? err.code : undefined);
            // Resume only what a fresh attempt could plausibly fix: the
            // classifier's retryable categories (rate limit, overload, dropped
            // connection, provider timeout). Auth, context-length and unknown
            // hard failures stay terminal.
            if (err instanceof GenerationUserError) {
              const retryable = err.category === 'rate_limited' || err.category === 'overloaded'
                || err.category === 'network' || err.category === 'timeout';
              jobOutcome = { kind: retryable ? 'interrupted' : 'failed', error: cleanError };
            } else {
              const info = classifyGenerationError(err);
              jobOutcome = { kind: info.retryable ? 'interrupted' : 'failed', error: info.retryable ? info.userMessage : cleanError };
            }
          }
        } finally {
          clearTimeout(genTimeout);
          clearInterval(accessTimer);
          const completedSource = completed && this.ctx.writeEpoch.accepts(epoch) ? this.ctx.readAllProjectFiles() : null;
          await budget.end().catch(() => { console.warn('AI lease cleanup will retry through expiry.'); });
          if (this.activeBudget === budget) this.activeBudget = null;
          let completedRevision: string | undefined;
          if (completedSource && this.ctx.writeEpoch.accepts(epoch)) {
            try {
              const snapshot = await sourceSnapshot(completedSource);
              completedRevision = snapshot.revision;
              if (this.ctx.writeEpoch.accepts(epoch)) this.ctx.runSql`UPDATE generation_usage SET source_revision=${snapshot.revision} WHERE id=${accounting.id}`;
            } catch { /* A response without runnable source has no app-verification claim. */ }
          }
          // Stop may arrive while the lease or source revision is being finalized.
          // Record the terminal outcome only after those asynchronous operations.
          completed = completed && this.ctx.writeEpoch.accepts(epoch) && !abortController.signal.aborted;
          // P0-4: a queued repair turn means this turn is not terminal. Keep the
          // usage row open ('running') and the durable job open — the repair turn
          // resolves both via resolveCompletenessRepair(). Only metering is
          // recorded here; no 'completed'/'failed' verdict is written yet. An
          // explicit stop or a superseded epoch wins: the queued repair's trigger
          // is never flushed, so normal terminal handling applies.
          const repairPending = repairQueuedThisTurn && this.ctx.writeEpoch.accepts(epoch) && !abortController.signal.aborted;
          if (repairPending) {
            try { this.ctx.runSql`UPDATE generation_usage SET input_tokens=${accounting.inputTokens},output_tokens=${accounting.outputTokens} WHERE id=${accounting.id}`; } catch { /* Inference results remain available if metering storage fails. */ }
          } else {
            try { this.ctx.runSql`UPDATE generation_usage SET finished_at=${Date.now()},status=${completed ? 'completed' : abortController.signal.aborted ? 'stopped' : 'failed'},input_tokens=${accounting.inputTokens},output_tokens=${accounting.outputTokens} WHERE id=${accounting.id}`; } catch { /* Inference results remain available if metering storage fails. */ }
          }
          try { this.ctx.runSql`UPDATE generation_usage SET first_response_at=${accounting.firstResponseAt},provider_calls=${accounting.providerCalls} WHERE id=${accounting.id}`; } catch { console.warn('Generation latency could not be saved.'); }
          try {
            const promptCategory = plannerMode ? 'planner' : modes?.questionMode ? 'question' : modes?.destructiveMode ? 'destructive' : modes?.ambiguousMode ? 'ambiguous' : modes?.isIncrementalEdit ? 'edit' : 'build';
            const repairTypes: string[] = [];
            if (this.truncationRetries > 0) repairTypes.push('truncation');
            if (this.syntaxRepairAttempts > 0) repairTypes.push('syntax');
            if (this.finalCompletenessRepairAttempts > 0) repairTypes.push('completeness');
            const filesWritten = completed ? Object.keys(this.ctx.readAllProjectFiles()).length : null;
            this.ctx.runSql`UPDATE generation_usage SET prompt_category=${promptCategory},files_written=${filesWritten},retry_count=${accounting.providerCalls > 1 ? accounting.providerCalls - 1 : 0},repair_types=${repairTypes.length ? repairTypes.join(',') : null},generation_ms=${accounting.generationMs},extraction_ms=${accounting.extractionMs},checks_ms=${accounting.checksMs},edit_chars=${accounting.editChars},rewrite_chars=${accounting.rewriteChars},cache_read_tokens=${accounting.cacheReadTokens},cache_write_tokens=${accounting.cacheWriteTokens} WHERE id=${accounting.id}`;
          } catch { /* Analytics columns are best-effort */ }
          if (!repairPending) {
            const aeStatus = completed ? 'completed' : abortController.signal.aborted ? 'stopped' : 'failed';
            const repairTypes: string[] = [];
            if (this.truncationRetries > 0) repairTypes.push('truncation');
            if (this.syntaxRepairAttempts > 0) repairTypes.push('syntax');
            if (this.finalCompletenessRepairAttempts > 0) repairTypes.push('completeness');
            const aeCategory = plannerMode ? 'planner' : modes?.questionMode ? 'question' : modes?.destructiveMode ? 'destructive' : modes?.ambiguousMode ? 'ambiguous' : modes?.isIncrementalEdit ? 'edit' : 'build';
            writeGenerationEvent(this.ctx.env.ANALYTICS, {
              userId: outcomeScope.ownerId,
              modelId: String(data.model || DEFAULT_MODEL_ID).slice(0, 200),
              status: aeStatus,
              promptCategory: aeCategory,
              repairTypes,
              ttftMs: accounting.firstResponseAt != null ? accounting.firstResponseAt - accounting.startedAt : -1,
              totalMs: accounting.generationMs ?? (Date.now() - accounting.startedAt),
              inputTokens: accounting.inputTokens ?? 0,
              outputTokens: accounting.outputTokens ?? 0,
              filesWritten: completed ? Object.keys(this.ctx.readAllProjectFiles()).length : 0,
              repairCount: this.truncationRetries + this.syntaxRepairAttempts + this.finalCompletenessRepairAttempts,
              providerCalls: accounting.providerCalls,
            });
          }
          if (!repairPending) {
            const genLogStatus = completed ? 'completed' : abortController.signal.aborted ? 'stopped' : 'failed';
            structuredLog(completed || abortController.signal.aborted ? 'info' : 'warn', 'generation_outcome', {
              projectId: outcomeScope.projectId, userId: outcomeScope.ownerId, status: genLogStatus,
              totalMs: accounting.generationMs ?? (Date.now() - accounting.startedAt),
              inputTokens: accounting.inputTokens ?? 0, outputTokens: accounting.outputTokens ?? 0,
              repairCount: this.truncationRetries + this.syntaxRepairAttempts + this.finalCompletenessRepairAttempts,
            });
          }
          if (measureGeneration && !repairPending) await this.ctx.queueProductOutcome({ ...outcomeScope, kind: completed ? 'generation_completed' : 'generation_failed', at: Date.now(), ...(completed && completedRevision ? { revision: completedRevision } : {}) });
          if (completed && !repairPending && completedRevision && completedSource) {
            this.triggerDevBuild(completedSource, completedRevision, outcomeScope.ownerId, connection);
          }
          if (this.activeAccounting === accounting) this.activeAccounting = null;
          if (this.activeGeneration?.epoch === epoch) this.activeGeneration = null;
          if (this.currentAbortController === abortController) this.currentAbortController = null;
          if (!completed) this.ctx.idempotency?.release(data.idempotencyKey);
          // Durable resume bookkeeping. Runs before the terminal events flush so
          // the client learns the job is resumable right after the error itself.
          // Best-effort: bookkeeping never breaks generation teardown.
          try {
            const jobs = this.generationJobs();
            if (completed) {
              jobs.complete(accounting.id);
            } else if (repairPending) {
              // P0-4: leave the job 'running' — the repair turn resolves it. It
              // must NOT fall through to the defensive interrupt below, which
              // would falsely tell the client the build stopped.
            } else if (jobOutcome) {
              if (jobOutcome.kind === 'failed') jobs.fail(accounting.id, jobOutcome.error);
              else jobs.interrupt(accounting.id, jobOutcome.error);
              // Always tell the client the terminal job state: a resumable
              // interruption offers one-click resume; a hard failure explicitly
              // clears any stale resume offer (resuming would hit the same wall).
              const job = jobs.get(accounting.id);
              const resumable = jobOutcome.kind === 'interrupted' && !!job && jobs.canResume(job);
              deferTerminal(() => {
                const jobError = jobOutcome?.error ?? job?.error;
                const payload = JSON.stringify({
                  type: 'generation_interrupted',
                  // A terminal failure carries no job: there is nothing to resume.
                  job: resumable && job ? {
                    id: job.id,
                    completedFiles: job.completedFiles.length,
                    error: jobError,
                    resumesLeft: Math.max(0, MAX_RESUMES - job.resumeCount),
                    // Live interruptions from connection drops or transient provider
                    // errors auto-resume on the client (bounded by MAX_RESUMES) —
                    // the user didn't ask to stop, so don't make them click.
                    autoResume: !!jobError && /connection dropped|internal error|temporarily overloaded|too much traffic|took too long to respond|ran out of time/i.test(jobError),
                  } : null,
                  resumable,
                });
                try { connection.send(payload); } catch (e) { noteSendFailure(e); }
                try { this.ctx.broadcast(payload, [connection.id]); } catch (e) { noteSendFailure(e); }
              });
            } else {
              // Defensive: reached the finally with no recorded outcome (an early
              // return above the catch). Leave the saved files resumable.
              jobs.interrupt(accounting.id, 'The build stopped before finishing. Your saved files are safe — you can resume.');
            }
          } catch { /* resume state is auxiliary; the files themselves are saved */ }
          // P0-4: if this turn was a queued repair, resolve the parent turn's
          // bookkeeping now that the repair outcome is known.
          this.resolveCompletenessRepair(actualPrompt, accounting.id, completed, jobOutcome, abortController.signal.aborted);
          this.clearActiveGenerationState();
          if (this.activeJobId === accounting.id) this.activeJobId = null;
          // No asynchronous cleanup remains after completion/retry is visible.
          // A client may immediately send its next turn after receiving these events.
          if (this.ctx.writeEpoch.accepts(epoch)) for (const publish of terminalEvents) publish();
        }
  }

  private triggerDevBuild(files: Record<string, string>, revision: string, ownerId: string, connection: PipelineConnection) {
    const hasBackend = Object.keys(files).some(p => {
      const clean = p.replace(/^\//, '');
      return clean === 'worker/index.ts' || clean === 'worker/index.js' || clean === 'worker/index.mjs' || clean === 'src/worker.ts';
    });
    if (!hasBackend) return;
    const runtime = this.ctx.env.RUNTIME as { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> } | undefined;
    if (!runtime || !ownerId) return;
    const payload = devJobPayload(files, true);
    this.ctx.waitUntil(
      runtime.fetch(new Request('https://runtime/jobs?environment=development', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-bh-project': this.ctx.name, 'x-bh-owner': ownerId },
        body: JSON.stringify(payload),
      }))
      .then(async (res: Response) => {
        const result = await res.json().catch(() => ({})) as Record<string, unknown>;
        const job = result.job as Record<string, unknown> | undefined;
        if (res.status === 429) {
          const msg = JSON.stringify({ type: 'runtime_build_status', status: 'queued', revision });
          try { connection.send(msg); } catch (e) { noteSendFailure(e); }
          try { this.ctx.broadcast(msg, [connection.id]); } catch (e) { noteSendFailure(e); }
          const chatMsg = JSON.stringify({ type: 'generation_notice', message: 'Files saved. The preview is waiting for a free build slot.' });
          try { connection.send(chatMsg); } catch (e) { noteSendFailure(e); }
          try { this.ctx.broadcast(chatMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
          this.scheduleCapacityRetry(revision, ownerId, connection, 0);
          return;
        }
        const msg = JSON.stringify({
          type: 'runtime_build_status',
          status: res.ok ? 'triggered' : 'failed',
          revision,
          ...(job?.id ? { jobId: job.id } : {}),
          ...(result.deduplicated ? { deduplicated: true } : {}),
          ...(!res.ok ? { error: (result as any).error ?? `Runtime returned ${res.status}` } : {}),
        });
        try { connection.send(msg); } catch (e) { noteSendFailure(e); }
        try { this.ctx.broadcast(msg, [connection.id]); } catch (e) { noteSendFailure(e); }
        if (res.ok && job?.id) {
          void this.ctx.storage.put?.('server_build_check', { jobId: job.id, revision });
          this.scheduleBuildStatusCheck(job.id as string, connection, 0);
        }
        if (!res.ok) {
          const errDetail = typeof (result as any).error === 'string' ? (result as any).error : `HTTP ${res.status}`;
          const chatMsg = JSON.stringify({ type: 'generation_notice', message: `Files saved, but the app failed to build: ${errDetail}` });
          try { connection.send(chatMsg); } catch (e) { noteSendFailure(e); }
          try { this.ctx.broadcast(chatMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
        }
      })
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('Server-triggered dev build failed:', errMsg);
        const msg = JSON.stringify({ type: 'runtime_build_status', status: 'failed', revision, error: errMsg });
        try { connection.send(msg); } catch (e) { noteSendFailure(e); }
        try { this.ctx.broadcast(msg, [connection.id]); } catch (e) { noteSendFailure(e); }
        const chatMsg = JSON.stringify({ type: 'generation_notice', message: `Files saved, but the app failed to build: ${errMsg}` });
        try { connection.send(chatMsg); } catch (e) { noteSendFailure(e); }
        try { this.ctx.broadcast(chatMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
      })
    );
  }

  private scheduleBuildStatusCheck(jobId: string, connection: PipelineConnection, attempt: number) {
    if (attempt >= 20) return;
    this.ctx.waitUntil(
      new Promise<void>(r => setTimeout(r, 30_000)).then(async () => {
        const runtime = this.ctx.env.RUNTIME as { fetch(input: RequestInfo): Promise<Response> } | undefined;
        if (!runtime) return;
        const pending = await this.ctx.storage.get?.('server_build_check') as { jobId: string } | undefined;
        if (!pending || pending.jobId !== jobId) return;
        const res = await runtime.fetch(new Request('https://runtime/status?environment=development', {
          headers: { 'x-bh-project': this.ctx.name, 'x-bh-owner': '' },
          signal: AbortSignal.timeout(5_000),
        }));
        if (!res.ok) return;
        const status = await res.json() as { jobs?: Array<{ id: string; status: string; message?: string }> };
        const job = status.jobs?.find(j => j.id === jobId);
        if (!job) { await this.ctx.storage.delete?.('server_build_check'); return; }
        if (['queued', 'running', 'stopping'].includes(job.status)) {
          this.scheduleBuildStatusCheck(jobId, connection, attempt + 1);
          return;
        }
        await this.ctx.storage.delete?.('server_build_check');
        if (job.status !== 'failed') return;
        const error = job.message || 'Build failed';
        const chatMsg = JSON.stringify({ type: 'generation_notice', message: `Files saved, but the app failed to build: ${error}` });
        try { connection.send(chatMsg); } catch (e) { noteSendFailure(e); }
        try { this.ctx.broadcast(chatMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
      }).catch(() => {})
    );
  }

  private static CAPACITY_BACKOFF = [30_000, 60_000, 120_000, 240_000, 480_000] as const;

  scheduleCapacityRetry(revision: string, ownerId: string, connection: PipelineConnection, attempt: number) {
    const backoff = GenerationPipeline.CAPACITY_BACKOFF;
    if (attempt >= backoff.length) {
      void this.ctx.storage.delete?.('server_build_check');
      const msg = JSON.stringify({ type: 'runtime_build_status', status: 'failed', revision, error: 'All build slots are still busy.' });
      try { connection.send(msg); } catch (e) { noteSendFailure(e); }
      try { this.ctx.broadcast(msg, [connection.id]); } catch (e) { noteSendFailure(e); }
      const chatMsg = JSON.stringify({ type: 'generation_notice', message: 'All build slots are still busy after several retries. You can retry from the preview panel when a slot frees up.' });
      try { connection.send(chatMsg); } catch (e) { noteSendFailure(e); }
      try { this.ctx.broadcast(chatMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
      return;
    }
    void this.ctx.storage.put?.('server_build_check', { retry: true, attempt, revision, ownerId });
    this.ctx.waitUntil(
      new Promise<void>(r => setTimeout(r, backoff[attempt])).then(async () => {
        const pending = await this.ctx.storage.get?.('server_build_check') as { retry?: boolean; revision?: string } | undefined;
        if (!pending?.retry || pending.revision !== revision) return;
        const runtime = this.ctx.env.RUNTIME as { fetch(input: RequestInfo): Promise<Response> } | undefined;
        if (!runtime) return;
        const files = this.ctx.readAllProjectFiles();
        const payload = devJobPayload(files, true);
        const res = await runtime.fetch(new Request('https://runtime/jobs?environment=development', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-bh-project': this.ctx.name, 'x-bh-owner': ownerId },
          body: JSON.stringify(payload),
        }));
        if (res.status === 429) {
          this.scheduleCapacityRetry(revision, ownerId, connection, attempt + 1);
          return;
        }
        const result = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (res.ok && result.job) {
          const job = result.job as Record<string, unknown>;
          void this.ctx.storage.put?.('server_build_check', { jobId: job.id as string, revision });
          const msg = JSON.stringify({ type: 'runtime_build_status', status: 'triggered', revision, jobId: job.id });
          try { connection.send(msg); } catch (e) { noteSendFailure(e); }
          try { this.ctx.broadcast(msg, [connection.id]); } catch (e) { noteSendFailure(e); }
          this.scheduleBuildStatusCheck(job.id as string, connection, 0);
        } else {
          void this.ctx.storage.delete?.('server_build_check');
          const errDetail = typeof (result as any).error === 'string' ? (result as any).error : `HTTP ${res.status}`;
          const chatMsg = JSON.stringify({ type: 'generation_notice', message: `Files saved, but the app failed to build: ${errDetail}` });
          try { connection.send(chatMsg); } catch (e) { noteSendFailure(e); }
          try { this.ctx.broadcast(chatMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
        }
      }).catch(() => {})
    );
  }

  async runCloudflareWorkersAI(
    modelName: string,
    systemPrompt: string,
    inputMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
    connection: PipelineConnection,
    actualPrompt: string,
    requestedMaxTokens?: number,
    epoch?: number,
    expectFiles = true,
    capabilities: AgentCapabilities = {},
    attachments: BuilderAttachment[] = [],
    assetPaths = new Set<string>(),
    deferTerminal: (event: () => void) => void = event => event(),
    maxSteps = 6,
    fastMode = true,
    onKillSwitch?: () => Promise<string | null>
  ): Promise<{ ok: boolean; repairMarker: string | null }> {
    let cfTimeout: ReturnType<typeof setTimeout> | undefined;
    let cfFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const abortController = this.currentAbortController ?? new AbortController();
    const ownsController = !this.currentAbortController;
    try {
      const env = this.ctx.env;
      if (!env || !env.AI) return { ok: false, repairMarker: null };
      const accounting = this.activeAccounting;
      // Budget was already reserved once at the start of runGeneration.
      // The previous per-call reserve() was a sequential registry hop on every
      // Workers AI invocation (token-ladder retries, tool-loop steps, sub-model
      // calls). Removing it here cuts those network round-trips entirely.
      const runAI = async (model: string, input: Record<string, unknown>, options: { signal: AbortSignal }) => {
        options.signal.throwIfAborted();
        if (accounting) accounting.providerCalls++;
        try { connection.send(JSON.stringify({ type: 'generation_notice', message: 'The app builder is working…', stage: 'model', requestId: this.activeGeneration?.id })); } catch (e) { noteSendFailure(e); }
        // These models document reasoning as enabled by default. Apply the
        // user's fast-mode choice to tool turns as well as the final answer.
        const request = modelSupportsThinking(model) ? { ...input, chat_template_kwargs: { enable_thinking: !fastMode } } : input;
        return env.AI.run(model, request, options);
      };

      if (ownsController) {
        this.currentAbortController = abortController;
        cfTimeout = setTimeout(
          () => abortController.abort(new Error(`Workers AI exceeded ${AI_TIMEOUT_MS / 1000}s`)),
          AI_TIMEOUT_MS
        );
      }

      // Only ever invoke an allowlisted @cf/ id — never an arbitrary client string.
      const cfEntry = resolveModel(modelName, 'cloudflare');
      if (!cfEntry) {
        console.error(`Refusing to invoke non-allowlisted Workers AI model: ${modelName}`);
        return { ok: false, repairMarker: null };
      }
      const cfModel = cfEntry.id;

      // The caller already supplies ranked, bounded source context. Do not append it twice.
      const messages = cfImageMessages([{ role: 'system', content: systemPrompt }, ...inputMessages], attachments, acceptsImageInput(modelName));

      // Retrying the *same* model at a lower token limit is legitimate. Trying a
      // *different* model is a silent substitution, so the candidate list is now
      // just the requested model. If it cannot serve the request, we report it.
      let aiResponse: WorkersAIStreamResponse | null = null;
      let attempts = 0;
      let lastError: unknown;

      const ladder = requestedMaxTokens
        ? [requestedMaxTokens, ...TOKEN_LADDER.filter(l => l < requestedMaxTokens)]
        : TOKEN_LADDER;

      let outputContent = '';
      let displayContent = '';
      const transcript = new ToolTranscriptStream();
      let pendingFrame = '';
      const flushFrame = () => {
        if (cfFlushTimer !== null) { clearTimeout(cfFlushTimer); cfFlushTimer = null; }
        if (!pendingFrame) return;
        const frame = pendingFrame;
        pendingFrame = '';
        const msg = JSON.stringify({ type: 'stream', chunk: { response: frame, done: false } });
        try { connection.send(msg); } catch (e) { noteSendFailure(e); }
        try { this.ctx.broadcast(msg, [connection.id]); } catch (e) { noteSendFailure(e); }
      };
      const emitDisplay = (token: string) => {
        if (!token) return;
        displayContent += token;
        this.rememberGenerationText(token, epoch);
        pendingFrame += token;
        if (cfFlushTimer === null) cfFlushTimer = setTimeout(flushFrame, 50);
      };
      const emit = (token: string) => {
        outputContent += token;
        emitDisplay(transcript.push(token));
      };
      let toolInputTokens = 0; let toolOutputTokens = 0;
      const cleanMessages = messages.map(m => {
        if (Array.isArray(m.content)) {
          const text = (m.content as Array<{ type?: string; text?: string }>).filter(p => p.type === 'text').map(p => p.text || '').join('\n');
          return { ...m, content: text };
        }
        return { ...m };
      });
      if (Object.keys(capabilities).length) {
        try {
          const answer = await runCapabilityLoop(input => runAI(cfModel, { ...input, max_tokens: requestedMaxTokens || 32768 }, { signal: abortController.signal }), messages, capabilities, abortController.signal, usage => { toolInputTokens += usage.prompt_tokens ?? usage.input_tokens ?? 0; toolOutputTokens += usage.completion_tokens ?? usage.output_tokens ?? 0; this.captureUsage(toolInputTokens, toolOutputTokens); }, name => {
            if (accounting && accounting.firstResponseAt === null) accounting.firstResponseAt = Date.now();
            flushFrame();
            const event = JSON.stringify({ type: 'tool_call', tool: name });
            try { connection.send(event); this.ctx.broadcast(event, [connection.id]); } catch (e) { noteSendFailure(e); }
          }, emit, { maxSteps, onToolResult: (name, success) => {
            const evt = JSON.stringify({ type: 'tool_result', tool: name, success });
            try { connection.send(evt); this.ctx.broadcast(evt, [connection.id]); } catch (e) { noteSendFailure(e); }
          } });
          // Tool turns already streamed through the same transcript and file
          // collector. Finalize once without replaying the completed response.
          if (answer !== null) aiResponse = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); controller.close(); } });
        } catch (toolErr) {
          const msg = errorMessage(toolErr);
          if (abortController.signal.aborted || !/schema|oneOf|5006|not met|type mismatch|tool/i.test(msg)) throw toolErr;
          console.warn('Tool capability loop hit schema error; falling back to plain generation:', msg);
          messages.length = 0;
          messages.push(...cleanMessages);
        }
      }

      for (const tokenLimit of ladder) {
        if (aiResponse) break;
        if (attempts >= MAX_CF_ATTEMPTS) break;
        if (accounting && accounting.providerCalls >= MAX_LLM_CALLS_PER_GENERATION) { console.warn(`Global LLM call cap (${MAX_LLM_CALLS_PER_GENERATION}) reached; stopping CF retries`); break; }
        if ((typeof epoch === 'number' && !this.ctx.writeEpoch.accepts(epoch)) || this.currentAbortController?.signal.aborted) return { ok: false, repairMarker: null };
        if (onKillSwitch) { const refusal = await onKillSwitch(); if (refusal) return { ok: false, repairMarker: null }; }
        attempts++;
        try {
          console.log(`Running Workers AI ${cfModel} (max_tokens=${tokenLimit}, attempt ${attempts})`);
          try {
            aiResponse = await withAbortSignal(
              runAI(cfModel, {
                messages,
                stream: true,
                max_tokens: tokenLimit,
                max_completion_tokens: tokenLimit,
                chat_template_kwargs: { enable_thinking: false }
              }, { signal: abortController.signal }),
              abortController.signal
            ) as WorkersAIStreamResponse;
          } catch (error) {
            if (abortController.signal.aborted || !/chat_template_kwargs|enable_thinking|unexpected.*(?:parameter|argument)|unsupported.*(?:parameter|argument)/i.test(String(error))) throw error;
            aiResponse = await withAbortSignal(
              runAI(cfModel, {
                messages,
                stream: true,
                max_tokens: tokenLimit,
                max_completion_tokens: tokenLimit
              }, { signal: abortController.signal }),
              abortController.signal
            ) as WorkersAIStreamResponse;
          }
          if (aiResponse) break;
        } catch (limitErr) {
          const msg = errorMessage(limitErr);
          lastError = limitErr;
          if (abortController.signal.aborted || !/max[_ ](?:completion[_ ])?tokens|context (?:length|window)|token (?:limit|budget)|too many tokens/i.test(msg)) throw limitErr;
          console.warn(`Model ${cfModel} at limit ${tokenLimit} failed:`, msg);
        }
      }

      if (!aiResponse) {
        throw lastError ?? new Error(`Workers AI model ${cfModel} returned no response.`);
      }

      const decoder = new TextDecoder();
      let sseBuffer = '';
      let receivedDone = false;

      // One parsed SSE payload (or object chunk) from a Workers AI stream. The
      // binding has shipped both `usage.prompt_tokens`/`completion_tokens` and
      // `input_tokens`/`output_tokens` spellings, and errors arrive as either a
      // string or an object — hence the wide field types with runtime checks.
      const extractToken = (obj: unknown): string | undefined => {
        if (!obj || typeof obj !== 'object') return undefined;
        const payload = obj as {
          usage?: { prompt_tokens?: unknown; input_tokens?: unknown; completion_tokens?: unknown; output_tokens?: unknown };
          error?: { message?: unknown } | string;
          success?: boolean;
          errors?: Array<{ message?: unknown }>;
          response?: unknown;
          choices?: Array<{ delta?: { content?: unknown }; text?: unknown }>;
        };
        if (payload.usage) {
          const input = payload.usage.prompt_tokens ?? payload.usage.input_tokens;
          const output = payload.usage.completion_tokens ?? payload.usage.output_tokens;
          this.captureUsage(typeof input === 'number' ? toolInputTokens + input : undefined, typeof output === 'number' ? toolOutputTokens + output : undefined);
        }
        if (payload.error || payload.success === false) {
          const error = (typeof payload.error === 'object' ? payload.error?.message : payload.error) ?? payload.errors?.[0]?.message ?? 'Workers AI streaming failed';
          throw new Error(String(error));
        }
        if (payload.response != null) return String(payload.response);
        const content = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.text;
        if (content != null) return String(content);
        return undefined;
      };

      const reader = typeof aiResponse.getReader === 'function' ? aiResponse.getReader() : null;
      const iterator = reader
        ? { next: () => reader.read(), return: () => reader.cancel() }
        : aiResponse[Symbol.asyncIterator]?.();
      if (!iterator) throw new Error('Workers AI returned an invalid stream.');
      let streamFinished = false;
      try {
      while (true) {
        const next = await withAbortSignal<any>(iterator.next(), abortController.signal);
        if (next.done) {
          streamFinished = true;
          break;
        }
        const rawChunk = next.value;
        if ((typeof epoch === 'number' && !this.ctx.writeEpoch.accepts(epoch)) || this.currentAbortController?.signal.aborted) {
          console.log('Workers AI generation stopped by user or timeout');
          return { ok: false, repairMarker: null };
        }

        const directText = extractToken(rawChunk);
        if (directText) {
          emit(directText);
          continue;
        }

        const textChunk = typeof rawChunk === 'string'
          ? rawChunk
          : decoder.decode(rawChunk, { stream: true });

        sseBuffer += textChunk;
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '[DONE]') {
            receivedDone = true;
            break;
          }
          const token = extractToken(JSON.parse(jsonStr));
          if (token) emit(token);
        }
        if (receivedDone) break;
      }
      } finally {
        if (!streamFinished && iterator.return) void Promise.resolve(iterator.return()).catch(() => {});
        if (reader && streamFinished) reader.releaseLock();
      }

      // Flush a trailing SSE frame left in the buffer at stream end.
      sseBuffer += decoder.decode();
      if (sseBuffer.trim().startsWith('data:')) {
        const jsonStr = sseBuffer.trim().slice(5).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          const token = extractToken(JSON.parse(jsonStr));
          if (token) emit(token);
        }
      }

      if ((typeof epoch === 'number' && !this.ctx.writeEpoch.accepts(epoch)) || this.currentAbortController?.signal.aborted) {
        return { ok: false, repairMarker: null };
      }

      if (!outputContent.trim() && (!expectFiles || isConversationalPrompt(actualPrompt)) && assetPaths.size === 0) throw new Error('The model returned no response. Please retry.');
      emitDisplay(transcript.push('', true));
      flushFrame();
      // expectFiles is false exactly for tool-less turns (planner, question,
      // destructive, ambiguous): scan the reply for diagnostics, never write.
      const extractionStart = Date.now();
      const extraction = this.ctx.fileExtractor.extractAndSaveFiles(outputContent, connection, epoch, !expectFiles, deferTerminal);
      extraction.writtenPaths = [...new Set([...extraction.writtenPaths, ...assetPaths])];
      extraction.writtenCount = extraction.writtenPaths.length;
      if (accounting) { accounting.generationMs = extractionStart - accounting.startedAt; accounting.extractionMs = Date.now() - extractionStart; }
      this.ctx.saveGenerationTurn(actualPrompt, displayContent || (assetPaths.size ? `Updated ${[...assetPaths].join(', ')}.` : ''), epoch);
      const cfRetryQueued = this.ctx.fileExtractor.handleIncompleteAppGeneration({
        actualPrompt,
        responseText: outputContent,
        extraction,
        connection,
        expectFiles,
        epoch,
        deferTerminal,
      });
      // P0-4: track the queued repair marker so the caller can hold the
      // completed status until the repair turn resolves. Always send
      // stream.done so the client knows the response stream has ended.
      // Post-generation checks: parity with the SDK path. Run on every
      // file-writing turn so the CF path gets the same safety nets.
      let postGenMarker: string | null = null;
      if (expectFiles && extraction.writtenCount > 0) {
        const checksStart = Date.now();
        try {
          const allFiles = new Map<string, string>(
            (this.ctx.runSql<{ path: string; content: string }>`SELECT path, content FROM project_files`)
              .map(r => [r.path, r.content ?? ''] as [string, string])
          );
          const results = await Promise.all(
            [
              () => this.checkMissingAppEntry(allFiles, connection),
              () => this.checkFinalCompleteness(allFiles, connection),
              () => this.checkNoPhantomAuthHooks(allFiles, connection),
              () => this.checkVerificationPlanFile(allFiles, connection),
              () => this.checkApiRouteCoverage(allFiles, connection),
            ].map(fn => { try { return Promise.resolve(fn()); } catch (e) { console.warn('Post-gen check threw:', e); return Promise.resolve(null); } })
          );
          const failures = results.filter((p): p is string => p !== null);
          if (failures.length > 0) {
            const combined = failures.join('\n\n---\n\n');
            postGenMarker = combined.split('\n')[0];
            deferTerminal(() => {
              try { connection.send(JSON.stringify({ type: 'trigger-auto-reply', message: combined })); } catch (e) { noteSendFailure(e); }
            });
          }
        } catch (e) { console.warn('Post-gen checks threw:', e); }
        if (accounting) accounting.checksMs = Date.now() - checksStart;
      }

      const cfRepairMarker = extraction.triggerQueued && extraction.triggerMarker ? extraction.triggerMarker
        : cfRetryQueued ? AUTO_RETRY_FULL_APP_MARKER
        : postGenMarker;
      const doneMsg = JSON.stringify({ type: 'stream', chunk: { response: '', done: true } });
      deferTerminal(() => {
        try { connection.send(doneMsg); } catch (e) { noteSendFailure(e); }
        try { this.ctx.broadcast(doneMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
      });
      if (!cfRepairMarker && extraction.writtenCount > 0) {
        try { this.ctx.saveCheckpoint('After generation'); } catch { /* non-fatal */ }
      }
      return { ok: true, repairMarker: cfRepairMarker };
    } catch (e) {
      if ((typeof epoch === 'number' && !this.ctx.writeEpoch.accepts(epoch)) || this.currentAbortController?.signal.aborted) {
        return { ok: false, repairMarker: null };
      }
      console.error('Cloudflare Workers AI execution failed:', e);
      throw e;
    } finally {
      if (cfFlushTimer !== null) clearTimeout(cfFlushTimer);
      if (cfTimeout) clearTimeout(cfTimeout);
      if (ownsController && this.currentAbortController === abortController) this.currentAbortController = null;
    }
  }
}
