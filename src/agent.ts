import { AUTH_CACHE_TTL, BACKEND_READY_POSITIVE_TTL, BACKEND_READY_NEGATIVE_TTL, DISCONNECT_STOP_DELAY } from './lib/timeouts';
import { isEmptyAssistantResponse } from './lib/assistant-response';
import { recordProductOutcome, type OutcomeEvent } from './lib/product-outcomes';
import { writeGenerationEvent } from './lib/cf-analytics';
import { structuredLog } from './lib/structured-log';

import type { BuilderAttachment } from './lib/builder-attachments';
import { BuilderService } from './lib/builder-service';
import { Agent, type Connection } from 'agents';
import { tracing } from 'cloudflare:workers';
import { transform } from 'sucrase';
import { normalizePath, isNodeModulesPath } from './lib/utils';
import { formatToolTranscript, isSystemContinuation, ToolTranscriptStream, toolSummaryMarkup } from './lib/chat-transcript';
import { BACKEND_NOT_RUNNING, usesSimulatedApi } from './lib/preview-mode';
import { createTypeScriptStarter } from './lib/project-starters';
import { prepareModuleSource, buildTranspileErrorModule } from './lib/preview-module-transform';
import { executeBackendRequest, InMemoryDataStore } from './lib/backend-runner';
import { getRequestUserId, getRegistry, isProjectOwner, USER_ID_HEADER, USER_ID_QUERY_PARAM, SESSION_HASH_QUERY_PARAM } from './lib/auth';
import { AI_TIMEOUT_MS, DEFAULT_MODEL_ID, MAX_OUTPUT_TOKENS, MODEL_ALLOWLIST, STREAM_FIRST_CHUNK_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_MS, capTokenLimit, resolveModel, withAbortSignal, killSwitchRefusal, resolveKillSwitchStatus, type AllowedModel, type KillSwitchStatus } from './lib/models';
import { validateRuntimeProviders } from './lib/runtime-config';
import { BEDROCK_ALIASES, createBedrockClient, providerCredentials, providerModel, selectModelTransport, type ProviderLanguageModel } from './lib/provider-clients';
import { buildDynamicImportMap as buildDynamicImportMapModule, isHarnessEntry as isHarnessEntryModule } from './lib/preview-import-map';
import { buildSystemPrompt as buildSystemPromptModule, buildSystemPromptParts as buildSystemPromptPartsModule } from './lib/system-prompt';
import { ensureHtmlDoctype } from './lib/html-normalize';
import { BusyLock, IdempotencyStore, WriteEpoch, dedupeAdjacent } from './lib/concurrency';
import { RateLimiter } from './lib/rate-limit';
import { AGENT_MIGRATIONS, runMigrations } from './lib/migrations';
import { MAX_SNAPSHOT_TOTAL_BYTES } from './lib/file-snapshot';
import { isStarterApp, relativeProjectImport, selectAppEntry } from './lib/preview-entry';
import { getAppSessionToken } from './lib/app-session';
import { isPublicPreviewFile, isPublicPreviewRead, PREVIEW_ACCESS_HEADER } from './lib/project-access';
import { isolatedPreviewHtml, previewFiles } from './lib/preview-isolation';
import { isConversationalPrompt, isDestructivePrompt, isQuestionPrompt, isAmbiguousPrompt, shouldAutoPlannerMode, shouldUseStagedPipeline } from './lib/prompt-mode';
import { isBlockedSecretFile } from './lib/secret-files';
import { boundedConversation, contextFileAllowed, estimateTokens, fileContextRank } from './lib/agent-context';
import { generationControls, generationContextLimits } from './lib/generation-controls';
import { needsBackend, hostingAvailability } from './lib/generation-target';
import { managedAppScaffold } from './lib/managed-app-scaffold';
import type { RuntimeStatus } from './runtime/types';
import { AiBudget, AiBudgetError, aiBudgetEndpoint, meteredModel } from './lib/ai-budget';
import { sourceSnapshot } from './runtime/source';
import { GenerationUserError, classifyGenerationError, errorMessage } from './lib/generation-errors';
import { checkShrinkage, isShrinkIntentional, isConfigWriteBlocked, logWritePath, SHRINK_OK_MARKER, isBackendWritePath, isAppFirstBackendPath } from './lib/write-guard';
import { FileExtractor, AUTO_RETRY_FULL_APP_MARKER, MAX_FILE_BYTES, type ExtractionSummary } from './lib/file-extractor';
import { GenerationPipeline, COMPLETENESS_REPAIR_MARKER, PHANTOM_HOOK_REPAIR_MARKER, VERIFY_FILE_REPAIR_MARKER, ROUTE_COVERAGE_REPAIR_MARKER, APP_ENTRY_REPAIR_MARKER, type ClientMessage } from './lib/generation-pipeline';
export { findUnterminatedBlock, TRUNCATION_RETRY_MESSAGE, AUTO_RETRY_FULL_APP_MARKER, MAX_FILE_BYTES, type ExtractionSummary } from './lib/file-extractor';
export { PHANTOM_HOOK_REPAIR_MARKER, VERIFY_FILE_REPAIR_MARKER, COMPLETENESS_REPAIR_MARKER, ROUTE_COVERAGE_REPAIR_MARKER, APP_ENTRY_REPAIR_MARKER, GenerationPipeline, type GenerationPipelineContext } from './lib/generation-pipeline';




// A failed WebSocket send used to vanish into an empty catch block, so a client
// that missed `done`, `error` or `file_updated` looked like a model bug. Count
// and log (rate-limited) instead; the send itself stays best-effort.
let sendFailureCount = 0;
function noteSendFailure(error: unknown): void {
  sendFailureCount += 1;
  if (sendFailureCount <= 5 || sendFailureCount % 100 === 0) {
    console.warn(`WebSocket send failed (#${sendFailureCount}):`, error instanceof Error ? error.message : String(error));
  }
}
import { SourceHistory, sourceChanges } from './lib/source-history';
import { readJson } from './runtime/integrations';
import { MAX_GENERATION_RESUME_CHARS, type GenerationSession } from './lib/generation-session';
import { GenerationJobs, MAX_RESUMES } from './lib/generation-jobs';
import {
  STARTER_APP_JSX,
  STARTER_MAIN_JSX,
  buildCssJsModule,
  buildHarnessModuleSrc,
  buildMissingComponentStub,
} from './lib/preview-templates';
import { isStepCount, streamText, type SystemModelMessage } from 'ai';

/**
 * Files that must never leave this Durable Object, even to the project owner.
 * The agent instructs generated apps to store secrets in /server/.env (see the
 * system prompt), so any path that returns file *content* to a caller has to
 * filter through `isBlockedSecretFile`.
 *
 * FIX (critical): previously this was applied only on the static asset path in
 * onRequest. `/preview/:id/api/files` called readAllProjectFiles() and returned
 * the entire workspace as JSON — including /server/.env with JWT_SECRET and
 * DATABASE_URL in plaintext. The filter now lives inside the reader itself, so
 * every call site inherits it and a new route cannot reintroduce the leak.
 */
const FORWARDABLE_BACKEND_HEADERS = new Set([
  'content-type',
  'content-length',
  'accept',
  'accept-language',
  'accept-encoding',
  'user-agent',
  USER_ID_HEADER,
]);

/**
 * Copy only the headers the simulated backend may see. Exported so the
 * filtering is testable without standing up a Durable Object; the request
 * handler applies it to every proxied `/api/*` call from a preview.
 */
export function selectForwardableHeaders(headers: Headers, store?: InMemoryDataStore): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (FORWARDABLE_BACKEND_HEADERS.has(lower)) out[lower] = value;
  });
  const appToken = getAppSessionToken(headers);
  if (appToken && store?.findAll('sessions').some(session => session.token === appToken && session.active !== false)) {
    out.authorization = `Bearer ${appToken}`;
  }
  return out;
}

export { applyPreviewCappedHeader } from './lib/preview-store-utils';
import { applyPreviewCappedHeader, evaluateStoreCaps, orphanedTableNames, computeNextHydratedNames } from './lib/preview-store-utils';

// The error card, the preview index.html, the harness module and the starter
// files are large string literals that never touch `this`. They live in
// lib/preview-templates.ts so this file stays a class rather than a template
// repository. That module's header explains why the `\${...}` sequences inside
// them must stay escaped: they are evaluated in the browser, not here, and
// src/__tests__/p6-preview-source.test.ts pins that to the generated output.

// ---------------------------------------------------------------------------
// Model resolution lives in lib/models.ts (MODEL_ALLOWLIST). Substring dispatch
// ("includes sonnet") and default substitution for unknown ids are gone: every
// invocation resolves to an exact allowlist entry or the request is refused.
// ---------------------------------------------------------------------------



export { isBackendWritePath, isAppFirstBackendPath } from './lib/write-guard';
import { createToolHandlers, instrumentTools } from './lib/agent-tools';
export { createToolHandlers, instrumentTools, type ToolContext, type ToolConnection } from './lib/agent-tools';


// A files_snapshot page is bounded in both rows and total bytes so no single
// project can produce a WS frame large enough to stall the client.
const MAX_FILES_PAGE = 200;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;


/**
 * Ceiling on one client-supplied prompt. Generations are billed by the token,
 * so an unbounded prompt is an unbounded cost; 32k characters is well past
 * anything a real brief needs and the client surfaces the limit as an error
 * rather than silently truncating the user's words.
 */
const MAX_PROMPT_CHARS = 32_000;

/** A single sync may not rewrite the whole workspace at once. */
const MAX_FILES_PER_SYNC = 500;

/** Hard ceiling on stored turns; older ones are pruned on write (see below). */
const MAX_STORED_MESSAGES = 1_000;
/** How much history is shipped on connect; the rest is paged on demand. */
const HISTORY_ON_CONNECT = 50;

/** Concurrent sockets one user may hold to a single project. */
const MAX_CONNECTIONS_PER_USER = 5;

/**
 * Ceiling on a single generation. A hung model call would otherwise leave the
 * busy lock held forever and the project unable to accept another prompt; the
 * lock releases and the client can retry.
 */
const GENERATION_LOCK_TIMEOUT_MS = AI_TIMEOUT_MS + 5_000;

/**
 * Per-user generation metering. The WebSocket path never goes through the
 * Worker's rate buckets — the auth gate at onBeforeConnect is ownership only —
 * so without this a single client could drive unbounded inference against one
 * project. Like the Worker's buckets, this is per-isolate and therefore an
 * upper bound, not a global quota.
 */
const GENERATION_LIMITER = new RateLimiter({
  generation: { limit: 30, windowMs: 60_000 },
  builderDiscovery: { limit: 10, windowMs: 60_000 },
  builderUpload: { limit: 40, windowMs: 60_000 },
});

/**
 * Coerces a client-supplied paging value into an integer within [min, max],
 * falling back to `dflt` when it is missing or not a number. Used for get_files
 * limit/offset, which must never be trusted to be finite or in range.
 */
function clampInt(value: unknown, min: number, max: number, dflt: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * Parses an Origin header without throwing.
 *
 * FIX: `new URL(origin).origin` was called unguarded inside the corsHeaders
 * IIFE, so a malformed Origin header (or one a proxy mangled) threw before any
 * handler ran and turned a preview request into an opaque 500.
 */
function safeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ChatAgentEnv {
  // Structural binding types — @cloudflare/workers-types clashes with the DOM
  // lib in this tsconfig, so bindings declare only the surface this agent uses.
  AI: { run(model: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown> };
  RUNTIME: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  PROJECT_BACKUPS: {
    put(key: string, value: string, options?: { customMetadata?: Record<string, string> }): Promise<unknown>;
    get(key: string): Promise<{ customMetadata?: Record<string, string>; text(): Promise<string>; json(): Promise<{ files?: Array<{ path?: unknown; content?: unknown }>; ownerId?: unknown }> } | null>;
    delete(key: string): Promise<void>;
  };
  REGISTRY: { get(id: unknown): { fetch(input: string | Request, init?: RequestInit): Promise<Response> }; idFromName(name: string): unknown };
  SESSION_SECRET: string;
  REQUIRED_MODEL_PROVIDERS?: string;
  BRAINHALF_SERVICES?: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
  BRAINHALF_SERVICE_TOKEN?: string;
  ANALYTICS?: { writeDataPoint(event: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };
  [key: string]: unknown;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ChatAgent extends Agent<ChatAgentEnv> {
  private erasing = false;
  private pendingBackups = new Set<Promise<void>>();

  /**
   * Cache the last backend-readiness result to avoid a 15 s fetch on every prompt
   * that mentions a database or API. A 60 s TTL is long enough to batch rapid
   * follow-up prompts and short enough to notice a runtime coming online.
   */
  private backendReadyCache: { ready: boolean; expiresAt: number } | null = null;

  private prewarmBackendReadiness(userId: string) {
    if (this.backendReadyCache && this.backendReadyCache.expiresAt > Date.now()) return;
    const runtime = this.env?.RUNTIME;
    if (!runtime) return;
    runtime.fetch(new Request('https://runtime/status?environment=development&readiness=1', {
      headers: { 'x-bh-project': this.name, 'x-bh-owner': userId },
      signal: AbortSignal.timeout(5_000),
    })).then(async (res: Response) => {
      const ready = !!res?.ok && hostingAvailability(await res.json() as RuntimeStatus).state === 'ready';
      const now = Date.now();
      this.backendReadyCache = { ready, expiresAt: now + (ready ? BACKEND_READY_POSITIVE_TTL : BACKEND_READY_NEGATIVE_TTL) };
    }).catch((e) => { console.warn('Backend readiness prewarm failed:', e instanceof Error ? e.message : e); });
  }

  private checkServerBuildFailure(connection: Connection, attempt = 0) {
    const runtime = this.env?.RUNTIME;
    if (!runtime) return;
    const check = this.ctx.storage.get<{ jobId?: string; revision?: string; retry?: boolean; attempt?: number; ownerId?: string }>('server_build_check')
      .then(async (pending) => {
        if (!pending) return;
        if (pending.retry && pending.revision && pending.ownerId) {
          this.pipeline.scheduleCapacityRetry(pending.revision, pending.ownerId, connection, pending.attempt ?? 0);
          return;
        }
        if (!pending.jobId) return;
        const res = await runtime.fetch(new Request('https://runtime/status?environment=development', {
          headers: { 'x-bh-project': this.name, 'x-bh-owner': pending.ownerId ?? '' },
          signal: AbortSignal.timeout(5_000),
        }));
        if (!res.ok) return;
        const status = await res.json() as { jobs?: Array<{ id: string; status: string; message?: string }> };
        const job = status.jobs?.find(j => j.id === pending.jobId);
        if (!job) { await this.ctx.storage.delete('server_build_check'); return; }
        if (['queued', 'running', 'stopping'].includes(job.status)) {
          if (attempt < 20) {
            this.ctx.waitUntil(
              new Promise<void>(r => setTimeout(r, 30_000)).then(() => this.checkServerBuildFailure(connection, attempt + 1))
            );
          }
          return;
        }
        await this.ctx.storage.delete('server_build_check');
        if (job.status !== 'failed') return;
        const error = job.message || 'Build failed';
        const msg = JSON.stringify({ type: 'generation_notice', message: `Files saved, but the app failed to build: ${error}` });
        try { connection.send(msg); } catch { /* client may already be gone */ }
        try { this.broadcast(msg, [connection.id]); } catch { /* best effort */ }
      })
      .catch(() => {});
    this.ctx.waitUntil(check);
  }

  private abortGeneration() {
    // Broadcast a terminal event to all clients BEFORE bumping the epoch.
    // Without this, runGeneration's finally block finds writeEpoch.accepts()
    // false and suppresses all terminal messages — clients wait forever in
    // isGenerating === true.
    if (this.currentAbortController) {
      try {
        this.broadcast(JSON.stringify({ type: 'generation_interrupted', resumable: false, job: null }));
      } catch { /* best effort */ }
    }
    this.writeEpoch.begin();
    this.currentAbortController?.abort();
    this.activeGeneration = null;
  }
  private generationJobs() {
    return new GenerationJobs((sql, ...params) => this.runSql(sql.split('?') as unknown as TemplateStringsArray, ...params));
  }

  private _fileExtractor: FileExtractor | null = null;
  private get fileExtractor(): FileExtractor {
    return this._fileExtractor ??= new FileExtractor(this as unknown as import('./lib/file-extractor').FileExtractorContext);
  }

  private _pipeline: GenerationPipeline | null = null;
  private get pipeline(): GenerationPipeline {
    const self = this;
    return this._pipeline ??= new GenerationPipeline({
      runSql: this.runSql.bind(this),
      get env() { return self.env; },
      storage: {
        put: (k: string, v: unknown) => this.ctx.storage.put?.(k, v),
        get: <T>(k: string) => (this.ctx.storage as any).get?.(k) as T | undefined,
        delete: (k: string) => this.ctx.storage.delete?.(k),
        transactionSync: <R>(fn: () => R) => this.ctx.storage.transactionSync!(fn),
      },
      waitUntil: (p: Promise<unknown>) => this.ctx.waitUntil(p),
      fileExtractor: this.fileExtractor,
      name: this.name,
      writeEpoch: this.writeEpoch,
      idempotency: this.idempotency,
      connectionUserIds: this.connectionUserIds,
      broadcast: (msg: string, exclude?: string[]) => this.broadcast(msg, exclude),
      backupToR2: (ownerId?: string) => this.backupToR2(ownerId),
      getConnections: () => this.getConnections(),
      authorizeConnection: (conn: any, forceRefresh?: boolean) => this.authorizeConnection(conn, forceRefresh),
      abortGeneration: () => this.abortGeneration(),
      senderUserId: (conn: any) => this.senderUserId(conn),
      queueProductOutcome: (event: any) => this.queueProductOutcome(event),
      saveCheckpoint: (label: string) => this.saveCheckpoint(label),
      readAllProjectFiles: () => this.readAllProjectFiles(),
      saveGenerationTurn: (prompt: string, response: string, epoch?: number) => this.saveGenerationTurn(prompt, response, epoch),
      ensureEntryPointExists: () => this.ensureEntryPointExists(),
      upsertFile: (path: string, content: string) => this.upsertFile(path, content),
      builderService: (ownerId: string) => this.builderService(ownerId),
    });
  }
  private get activeBudget() { return this.pipeline.activeBudget; }
  private set activeBudget(v: AiBudget | null) { this.pipeline.activeBudget = v; }
  private get currentAbortController() { return this.pipeline.currentAbortController; }
  private set currentAbortController(v: AbortController | null) { this.pipeline.currentAbortController = v; }
  private disconnectStopTimer: ReturnType<typeof setTimeout> | undefined;
  private get activeGeneration() { return this.pipeline.activeGeneration; }
  private set activeGeneration(v: (GenerationSession & { epoch: number }) | null) { this.pipeline.activeGeneration = v; }
  private get activeJobId() { return this.pipeline.activeJobId; }
  private set activeJobId(v: string | null) { this.pipeline.activeJobId = v; }
  private get activeAccounting() { return this.pipeline.activeAccounting; }
  private set activeAccounting(v: { id: string; startedAt: number; inputTokens: number | null; outputTokens: number | null; firstResponseAt: number | null; providerCalls: number; generationMs: number | null; extractionMs: number | null; checksMs: number | null; editChars: number; rewriteChars: number; cacheReadTokens: number; cacheWriteTokens: number } | null) { this.pipeline.activeAccounting = v; }
  private get truncationRetries() { return this.pipeline.truncationRetries; }
  private set truncationRetries(v: number) { this.pipeline.truncationRetries = v; }
  private get syntaxRepairAttempts() { return this.pipeline.syntaxRepairAttempts; }
  private set syntaxRepairAttempts(v: number) { this.pipeline.syntaxRepairAttempts = v; }
  private get finalCompletenessRepairAttempts() { return this.pipeline.finalCompletenessRepairAttempts; }
  private set finalCompletenessRepairAttempts(v: number) { this.pipeline.finalCompletenessRepairAttempts = v; }
  private get phantomHookRepairAttempts() { return this.pipeline.phantomHookRepairAttempts; }
  private set phantomHookRepairAttempts(v: number) { this.pipeline.phantomHookRepairAttempts = v; }
  private get verifyFileRepairAttempts() { return this.pipeline.verifyFileRepairAttempts; }
  private set verifyFileRepairAttempts(v: number) { this.pipeline.verifyFileRepairAttempts = v; }
  private get apiRouteCoverageRepairAttempts() { return this.pipeline.apiRouteCoverageRepairAttempts; }
  private set apiRouteCoverageRepairAttempts(v: number) { this.pipeline.apiRouteCoverageRepairAttempts = v; }
  private get appEntryRepairAttempts() { return this.pipeline.appEntryRepairAttempts; }
  private set appEntryRepairAttempts(v: number) { this.pipeline.appEntryRepairAttempts = v; }
  private get flipFlopGuard() { return this.pipeline.flipFlopGuard; }
  private set flipFlopGuard(v: import('./lib/repair-budget').FlipFlopGuard) { this.pipeline.flipFlopGuard = v; }
  private get repairLog() { return this.pipeline.repairLog; }
  private set repairLog(v: import('./lib/repair-budget').RepairLog) { this.pipeline.repairLog = v; }
  private get killSwitchCache() { return this.pipeline.killSwitchCache; }
  private set killSwitchCache(v: KillSwitchStatus | null) { this.pipeline.killSwitchCache = v; }
  private get pendingCompletenessRepair() { return this.pipeline.pendingCompletenessRepair; }
  private set pendingCompletenessRepair(v: { parentJobId: string; marker: string } | null) { this.pipeline.pendingCompletenessRepair = v; }
  private get turnSavedForEpoch() { return this.pipeline.turnSavedForEpoch; }
  private set turnSavedForEpoch(v: number) { this.pipeline.turnSavedForEpoch = v; }
  private get generationBranchId() { return this.pipeline.generationBranchId; }
  private set generationBranchId(v: string) { this.pipeline.generationBranchId = v; }


  /**
   * A brand-new user prompt breaks every auto-repair streak: counters only
   * track consecutive repairs within one retry chain, which the server
   * recognizes via its own continuation prompts. Every bounded repair counter
   * must be reset here — a counter left out stays exhausted for the rest of
   * the agent's lifetime and its check silently stops repairing.
   */
  private resetRepairCounters(): void { this.pipeline.resetRepairCounters(); }

  private persistActiveGeneration(generationSessionId: string, jobId: string, accountingId: string, budgetId: string, budgetOwner: string): void { this.pipeline.persistActiveGeneration(generationSessionId, jobId, accountingId, budgetId, budgetOwner); }

  private persistRepairCounters(): void { this.pipeline.persistRepairCounters(); }

  private clearActiveGenerationState(): void { this.pipeline.clearActiveGenerationState(); }

  private recoverOrphanedGeneration(): void { this.pipeline.recoverOrphanedGeneration(this.activeGeneration); }


  private captureUsage(input: unknown, output: unknown, inputDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number } | null) { this.pipeline.captureUsage(input, output, inputDetails); }

  private generationSnapshot(): GenerationSession | undefined { return this.pipeline.generationSnapshot(); }

  private rememberGenerationText(text: string, epoch?: number) { this.pipeline.rememberGenerationText(text, epoch); }

  /**
   * Generation concurrency guards. See lib/concurrency.ts:
   * - `generationLock` refuses a second in-flight generation instead of letting
   *   two of them interleave file writes.
   * - `writeEpoch` is bumped when a generation starts; a write that observes an
   *   older epoch belongs to a generation the user already replaced (stop then
   *   re-prompt) and is discarded.
   * - `idempotency` stops a reconnect's redelivered message from generating twice.
   */
  private readonly generationLock = new BusyLock();
  private readonly writeEpoch = new WriteEpoch();
  private readonly idempotency = new IdempotencyStore();

  /**
   * The preview runtime's simulated database. One instance *per Durable Object*
   * (i.e. per project), never a module-level singleton — a module singleton is
   * shared by every project that lands in the same isolate, so a POST
   * /api/users in project A would be readable as GET /api/users in project B.
   */
  private readonly previewStore = new InMemoryDataStore();
  // Tracks whether the store has been loaded from SQLite since last wake.
  // Reset to false when the DO instance is created (constructor or hibernation wake).
  private previewStoreLoaded = false;
  // true when the last persistPreviewStore() call was skipped due to the row or
  // byte cap; cleared when a later persist succeeds. Exposed to clients via the
  // X-BH-Preview-Capped response header and the preview_store_capped WS event.
  private previewStoreCapped = false;
  // 'rows' when row cap exceeded, 'bytes' when any table exceeded the byte cap, null when not capped.
  private previewCappedReason: 'rows' | 'bytes' | null = null;
  // Tables successfully loaded from SQLite in the current instance lifetime.
  // Used by persistPreviewStore to delete DB rows for tables that have since
  // been removed from memory (e.g. app reset after a schema change).
  private hydratedTableNames = new Set<string>();

  /**
   * Per-connection authenticated user ids. The Worker verifies the session token
   * and project ownership *before* the request reaches this Durable Object and
   * injects x-auth-user-id; a missing header means the request bypassed the
   * gate, so we refuse it. Every entry point fails closed.
   */
  private connectionUserIds: Map<string, string> = new Map();

  /**
   * Runs a statement. Accepts a tagged template (the usual case) or a plain
   * string — the migration runner deals in plain strings because its statements
   * come from a table, not from source text. A plain string is wrapped in a
   * single-element template array because the SDK's sql tag reduces over it.
   */
  private runSql<Row = Record<string, any>>(strings: TemplateStringsArray | string, ...values: any[]): Row[] {
    if (this.erasing) throw new Error('Project deleted');
    if (typeof strings === 'string') {
      return [...this.sql<Row>([strings] as unknown as TemplateStringsArray, ...values)];
    }
    return [...this.sql<Row>(strings, ...values)];
  }

  /** Runs `closure` inside the DO's synchronous storage transaction. */
  private transact<R>(closure: () => R): R {
    return this.ctx.storage.transactionSync(closure);
  }

  /**
   * Applies pending schema migrations. Split from seeding so a workspace can be
   * restored from R2 *between* the two: restoring after the seed would trip the
   * "already initialized" check and silently discard the backup, while restoring
   * before the tables exist would throw and be swallowed.
   */
  private ensureSchema() {
    try {
      const applied = runMigrations(
        AGENT_MIGRATIONS,
        statement => this.runSql(statement),
        <R,>(closure: () => R): R => this.transact(closure)
      );
      if (applied > 0) console.log(`Schema migrations applied: ${applied}`);
      if (!this.idempotency.has('__wired__')) {
        this.idempotency.setSql((sql: string, ...params: any[]) => this.runSql(sql.split('?') as unknown as TemplateStringsArray, ...params));
      }
    } catch (e) {
      console.warn('Schema migration note:', e);
    }
  }

  /**
   * Lazily hydrates previewStore from SQLite on the first preview /api/* request
   * after a DO wake. Subsequent calls within the same instance are no-ops.
   */
  private hydratePreviewStore(): void {
    if (this.previewStoreLoaded) return;
    this.previewStoreLoaded = true;
    this.hydratedTableNames = new Set();
    let rows: Array<{ table_name: string; rows_json: string; next_id: number }>;
    try {
      rows = this.runSql<{ table_name: string; rows_json: string; next_id: number }>`SELECT table_name, rows_json, next_id FROM preview_store`;
    } catch (e) {
      // "no such table" is expected on pre-v15 deploys or when a preview request
      // arrives before ensureSchema() runs. Any other error is unexpected.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/no such table/i.test(msg)) console.warn('Preview store could not be read:', msg);
      return;
    }
    for (const row of rows) {
      try {
        const items: unknown = JSON.parse(row.rows_json);
        if (!Array.isArray(items)) throw new Error('rows_json is not an array');
        this.previewStore.loadTable(row.table_name, items, row.next_id);
        this.hydratedTableNames.add(row.table_name.toLowerCase());
      } catch (e) {
        // Log but do NOT load an empty table in place of the corrupt one.
        // persistPreviewStore uses INSERT OR REPLACE, so the corrupt DB row is
        // preserved until a real mutation creates the same table with valid data.
        // Corrupt tables are intentionally NOT added to hydratedTableNames so
        // they are never deleted from the DB by the orphan-sweep below.
        console.warn(`Preview table "${row.table_name}" has corrupt data — skipped:`, e instanceof Error ? e.message : e);
      }
    }
    // Re-evaluate caps against the freshly loaded data so previewStoreCapped is
    // accurate immediately after wake — before the first mutating request arrives.
    const capReason = evaluateStoreCaps(
      this.previewStore.serialize(),
      ChatAgent.MAX_PREVIEW_PERSIST_ROWS,
      ChatAgent.MAX_PREVIEW_TABLE_BYTES,
    );
    if (capReason !== null) {
      this.previewStoreCapped = true;
      this.previewCappedReason = capReason;
    }
  }

  /**
   * Persists the current previewStore snapshot to SQLite after every mutating
   * preview API call (POST/PUT/PATCH/DELETE). GET requests skip this to avoid
   * unnecessary writes — reads cannot change store state.
   *
   * Write-through trade-off: persisting after every request adds one
   * synchronous SQLite transaction per mutating call. The alternative — a
   * debounce timer — risks losing the last mutations if the DO hibernates
   * before the timer fires. For a DO that can hibernate the moment a request
   * completes, write-through is the only safe choice.
   *
   * Size caps: if total rows exceed MAX_PREVIEW_PERSIST_ROWS the whole persist
   * is skipped. If any single table's JSON blob exceeds MAX_PREVIEW_TABLE_BYTES
   * that table is skipped individually. Both cases set previewStoreCapped so the
   * caller can add X-BH-Preview-Capped to the response. The flag is cleared the
   * next time a persist succeeds within both caps.
   *
   * Uses INSERT OR REPLACE (not DELETE+INSERT) so tables that failed hydration
   * due to corrupt rows_json are not overwritten until a real mutation touches
   * that table. If preview_store does not exist yet (request arrived before
   * ensureSchema ran), the INSERT throws and the outer catch handles it silently.
   */
  private static readonly MAX_PREVIEW_PERSIST_ROWS = 5_000;
  // 256 KB per table JSON blob; prevents one table with enormous row objects
  // from filling storage even when total row count is below MAX_PREVIEW_PERSIST_ROWS.
  // Per-table skip (not all-or-nothing) because tables are typically independent
  // REST resources — one oversized table should not block others from persisting.
  private static readonly MAX_PREVIEW_TABLE_BYTES = 256 * 1024;
  private persistPreviewStore(): void {
    try {
      const tables = this.previewStore.serialize();
      const totalRows = tables.reduce((sum, t) => sum + t.rows.length, 0);
      if (totalRows > ChatAgent.MAX_PREVIEW_PERSIST_ROWS) {
        if (!this.previewStoreCapped || this.previewCappedReason !== 'rows') {
          console.warn(`Preview store row cap exceeded (${totalRows}/${ChatAgent.MAX_PREVIEW_PERSIST_ROWS}); data will not survive hibernation`);
          this.broadcastPreviewCapped(true, 'rows');
        }
        this.previewStoreCapped = true;
        this.previewCappedReason = 'rows';
        return;
      }
      const inMemoryNames = new Set(tables.map(t => t.name.toLowerCase()));
      const byteCappedNames = new Set<string>();
      this.transact(() => {
        for (const { name, rows, nextId } of tables) {
          const blob = JSON.stringify(rows);
          if (blob.length > ChatAgent.MAX_PREVIEW_TABLE_BYTES) {
            if (!this.previewStoreCapped) {
              console.warn(`Preview table "${name}" exceeds byte cap (${blob.length}/${ChatAgent.MAX_PREVIEW_TABLE_BYTES} bytes); not persisted`);
            }
            byteCappedNames.add(name.toLowerCase());
            continue;
          }
          // INSERT OR REPLACE so tables that failed hydration (corrupt rows_json)
          // are not overwritten until a real mutation touches the same table name.
          this.runSql`INSERT OR REPLACE INTO preview_store (table_name, rows_json, next_id) VALUES (${name}, ${blob}, ${nextId})`;
        }
        // Remove rows for tables that were successfully hydrated but are no longer
        // in memory (e.g. app regenerated with a different schema, or after reset).
        // Tables with corrupt rows_json are not in hydratedTableNames and are
        // therefore preserved — their stale DB row remains until a real mutation.
        for (const name of orphanedTableNames(this.hydratedTableNames, inMemoryNames)) {
          this.runSql`DELETE FROM preview_store WHERE table_name = ${name}`;
        }
      });
      this.hydratedTableNames = computeNextHydratedNames(this.hydratedTableNames, inMemoryNames, byteCappedNames);
      const byteCapped = byteCappedNames.size > 0;
      const newReason = byteCapped ? 'bytes' as const : null;
      const stateChanged = byteCapped !== this.previewStoreCapped || (byteCapped && newReason !== this.previewCappedReason);
      if (stateChanged) this.broadcastPreviewCapped(byteCapped, byteCapped ? 'bytes' : undefined);
      this.previewStoreCapped = byteCapped;
      this.previewCappedReason = newReason;
    } catch { /* auxiliary; preview data is best-effort */ }
  }

  private broadcastPreviewCapped(capped: boolean, reason?: 'rows' | 'bytes'): void {
    try {
      const msg = JSON.stringify({ type: 'preview_store_capped', capped, ...(capped && reason ? { reason } : {}) });
      for (const conn of this.getConnections()) {
        try { conn.send(msg); } catch { /* stale connection */ }
      }
    } catch { /* auxiliary */ }
  }

  private builderService(ownerId: string) {
    return new BuilderService((sql, ...params) => this.runSql(sql.split('?') as unknown as TemplateStringsArray, ...params), this.name, ownerId, this.env.SESSION_SECRET || '', work => this.transact(work));
  }

  private sourceHistory() {
    return new SourceHistory((sql, ...params) => this.runSql(sql.split('?') as unknown as TemplateStringsArray, ...params));
  }

  private saveCheckpoint(label: string) {
    return this.transact(() => this.sourceHistory().save(this.readAllProjectFiles(), this.getFilesRevision(), label));
  }

  /**
   * Reads one bounded page of the workspace files.
   *
   * Both snapshot sites used to run `SELECT path, content FROM project_files`
   * unbounded and ship every row in a single WS frame. This object serves one
   * project, so the row count is not unbounded in practice, but nothing stopped
   * a single huge file from producing a frame large enough to stall the client.
   * The page is capped by *both* row count and byte count.
   *
   * `includeSecrets` defaults to false. Only the R2 backup passes true, because
   * a backup that silently drops /server/.env is not a backup — and it never
   * leaves Cloudflare's storage. Every caller that returns content to a client
   * takes the default.
   */
  private readProjectFilesPage(
    limit: number,
    offset: number,
    includeSecrets = false
  ): { files: Record<string, string>; total: number; truncated: boolean; nextOffset: number; hasMore: boolean } {
    const totalRows = [...this.sql`SELECT COUNT(*) as count FROM project_files`];
    const total = totalRows.length ? Number(totalRows[0].count) : 0;

    const files: Record<string, string> = Object.create(null);
    let nextOffset = offset;
    if (total === 0) return { files, total, truncated: false, nextOffset, hasMore: false };

    // Stable ordering keeps paging meaningful: without ORDER BY, SQLite is free
    // to return rows in any order, so a second page could repeat page one.
    const rows = [...this.sql`
      SELECT path, content FROM project_files
      ORDER BY path ASC
      LIMIT ${limit} OFFSET ${offset}
    `];
    let bytes = 1024;
    let truncated = false;
    for (const r of rows) {
      const path = String(r.path);
      nextOffset += 1;
      if (!includeSecrets && isBlockedSecretFile(path)) {
        continue;
      }
      const content = String(r.content ?? '');
      const fileBytes = new TextEncoder().encode(JSON.stringify({ [path]: content })).length;
      if (fileBytes + 1024 > MAX_SNAPSHOT_BYTES) throw new Error(`File ${path} exceeds the snapshot page size`);
      if (bytes + fileBytes > MAX_SNAPSHOT_BYTES) {
        nextOffset -= 1;
        truncated = true;
        break;
      }
      bytes += fileBytes;
      files[path] = content;
    }
    return { files, total, truncated, nextOffset, hasMore: nextOffset < total };
  }

  private getFilesRevision(): number {
    const rows = this.runSql`SELECT revision FROM project_file_revision WHERE id = 1`;
    if (!rows.length) throw new Error('Workspace revision storage is unavailable');
    return Number(rows[0].revision);
  }

  private collectProjectFiles(includeSecrets: boolean): Record<string, string> {
    const files: Record<string, string> = Object.create(null);
    let offset = 0;
    let bytes = 0;
    while (true) {
      const page = this.readProjectFilesPage(MAX_FILES_PAGE, offset, includeSecrets);
      bytes += new TextEncoder().encode(JSON.stringify(page.files)).length;
      if (bytes > MAX_SNAPSHOT_TOTAL_BYTES) throw new Error('Workspace exceeds the safe transfer size');
      Object.assign(files, page.files);
      if (!page.hasMore) return files;
      if (page.nextOffset <= offset) throw new Error('Workspace pagination did not advance');
      offset = page.nextOffset;
    }
  }

  /**
   * Reads the whole workspace as a path→content map, with secret files removed.
   *
   * Several call sites (the /api/files route, the generic /api/ route and the
   * preview index) each inlined this same loop. The row limit is effectively
   * unbounded here — these are HTTP responses where the caller needs every file
   * — so it is the *byte* ceiling that bounds the result, not the paging cap.
   */
  private readAllProjectFiles(): Record<string, string> {
    return this.collectProjectFiles(false);
  }

  /** Backup-only reader: includes secrets, never returned over HTTP or WS. */
  private readAllProjectFilesForBackup(): Record<string, string> {
    return this.collectProjectFiles(true);
  }

  /**
   * The `/api/*` hand-off to the simulated backend. `executeBackendRequest`
   * reads only `/server/*` on this path — it parses `/server/.env` for
   * process.env and validates the server sources — so the client sources and
   * every other file stay in the Durable Object. The previous call passed the
   * whole workspace into a context that had no use for most of it. R2 backups
   * still use `readAllProjectFilesForBackup`, because a restore that drops a
   * file silently breaks the user's app.
   */
  private readServerFilesForBackend(): Record<string, string> {
    const all = this.readAllProjectFilesForBackup();
    return Object.fromEntries(
      Object.entries(all).filter(([path]) => path.startsWith('/server/') || path.startsWith('server/'))
    );
  }

  /**
   * Builds the "here is the project so far" context block a model receives.
   *
   * Both generation paths (streamText and Cloudflare Workers AI) need the same
   * thing — a bounded, ranked view of the workspace — and each had its own copy
   * of it. What genuinely differs is which files are pinned to the front, how
   * they rank, how many to send, and how much text to spend, so those are the
   * parameters and the algorithm exists once.
   *
   * `charBudget`, when set, trims an over-long file in place and stops once the
   * budget is spent; when omitted, whole files are emitted.
   *
   * Secret files are excluded here too: a .env in the prompt is a .env in the
   * provider's logs, and the model is explicitly told never to echo secrets.
   */
  private buildFilesContext(opts: {
    pinned: Set<string>;
    rank: (path: string) => number;
    maxFiles: number;
    charBudget?: number;
    header: string;
    mentioned?: Set<string>;
    changed?: Set<string>;
  }): string {
    try {
      const pathRows = this.runSql<{ path: string }>`SELECT path FROM project_files`;
      const mentioned = opts.mentioned ?? new Set<string>();
      const changed = opts.changed ?? new Set<string>();

      // Apply the same filtering as before: pinned files bypass node_modules/main.js exclusions.
      const allFiltered = pathRows
        .map(r => String(r.path))
        .filter(contextFileAllowed)
        .filter(path => !/^\/src\/assets\/uploads\/[^/]+\.\d+\.js$/.test(path))
        .filter(p => opts.pinned.has(p) || (!isNodeModulesPath(p) && !/\bmain\.[^.]+$/.test(p)));

      if (allFiltered.length === 0) return '';

      const isPriority = (p: string) => opts.pinned.has(p) || mentioned.has(p) || changed.has(p);

      // Priority files get full content; others are listed path-only so the model
      // knows they exist and can read_file them on demand.
      const priorityPaths = allFiltered
        .filter(isPriority)
        .sort((a, b) => opts.rank(a) - opts.rank(b))
        .slice(0, opts.maxFiles);

      const otherPaths = allFiltered
        .filter(p => !isPriority(p))
        .sort((a, b) => opts.rank(a) - opts.rank(b))
        .slice(0, 300);

      const parts: string[] = [];

      if (priorityPaths.length > 0) {
        const rows = this.runSql<{ path: string; content: string }>`SELECT path, content FROM project_files WHERE path IN (SELECT value FROM json_each(${JSON.stringify(priorityPaths)}))`;
        rows.sort((left, right) => priorityPaths.indexOf(left.path) - priorityPaths.indexOf(right.path));
        if (opts.charBudget === undefined) {
          for (const r of rows) parts.push(`File: ${r.path}\n\`\`\`\n${r.content}\n\`\`\``);
        } else {
          let charBudget = opts.charBudget;
          for (const r of rows) {
            const source = String(r.content || '');
            const content = source.length > 16_000 ? source.slice(0, 16_000) + '\n[File shortened — do not overwrite this file without seeing it in full]' : source;
            if (content.length > charBudget) {
              parts.push(`File: ${r.path}\n\`\`\`\n${content.slice(0, charBudget)}\n// ... [trimmed for length]\n\`\`\``);
              break;
            }
            charBudget -= content.length;
            parts.push(`File: ${r.path}\n\`\`\`\n${content}\n\`\`\``);
            if (charBudget <= 0) break;
          }
        }
      }

      if (otherPaths.length > 0) {
        parts.push(`OTHER PROJECT FILES (use read_file to view):\n${otherPaths.join('\n')}`);
      }

      if (parts.length === 0) return '';
      return `\n\n${opts.header}\n${parts.join('\n\n')}\n`;
    } catch (e) {
      console.warn('Could not load existing files for context:', e);
      return '';
    }
  }

  private getLastWrittenPaths(): Set<string> {
    try {
      const rows = this.runSql<{ completed_files: string }>`SELECT completed_files FROM generation_jobs WHERE status = 'complete' ORDER BY updated_at DESC LIMIT 1`;
      if (rows.length > 0 && rows[0].completed_files) {
        const files: unknown = JSON.parse(rows[0].completed_files);
        return new Set(Array.isArray(files) ? (files as string[]) : []);
      }
    } catch { /* non-fatal */ }
    return new Set<string>();
  }

  private getFilesFromPrompt(prompt: string): Set<string> {
    const mentioned = new Set<string>();
    try {
      const paths = this.runSql<{ path: string }>`SELECT path FROM project_files`.map(r => String(r.path));
      for (const p of paths) {
        const name = p.split('/').pop() ?? '';
        if ((name && prompt.includes(name)) || prompt.includes(p)) mentioned.add(p);
      }
    } catch { /* non-fatal */ }
    return mentioned;
  }

  /**
   * Drops the oldest turns once the table exceeds the cap. Nothing reads beyond
   * the recent tail — the model's context window is LIMIT 12 and the client gets
   * the last HISTORY_ON_CONNECT — so rows past the cap are inert storage cost.
   * Runs on the write path, not on a timer.
   */
  private pruneMessages() {
    const rows = [...this.sql`SELECT COUNT(*) as count FROM messages`];
    const total = Number(rows[0]?.count ?? 0);
    if (total <= MAX_STORED_MESSAGES) return;
    // Keep the newest cap: delete everything below the cutoff id in one
    // statement rather than row by row.
    this.runSql`DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ${MAX_STORED_MESSAGES})`;
  }

  /** Seeds the starter template when the workspace is genuinely empty. */
  private seedStarterIfEmpty() {
    try {
      const countRows = [...this.sql`SELECT COUNT(*) as count FROM project_files`];
      if (countRows.length === 0 || countRows[0].count === 0) {
        // One transaction: a partially seeded workspace renders a broken preview.
        this.transact(() => {
          for (const [path, content] of Object.entries(createTypeScriptStarter())) {
            this.runSql`INSERT OR IGNORE INTO project_files (path, content) VALUES (${path}, ${content});`;
          }
        });
      }
    } catch (e) {
      console.warn('SQLite init note:', e);
    }
  }

  private prepareManagedApp(connection: Connection, prompt: string, target: 'managed' | 'export', epoch: number) {
    const before = this.readAllProjectFiles();
    const after = managedAppScaffold(prompt, before, target);
    if (after === before || !this.writeEpoch.accepts(epoch)) return;
    const removed = Object.keys(before).filter(path => !(path in after));
    const changed = Object.entries(after).filter(([path, content]) => before[path] !== content);
    this.transact(() => {
      for (const path of removed) this.runSql`DELETE FROM project_files WHERE path=${normalizePath(path)}`;
      for (const [path, content] of changed) {
        if (!this.upsertFile(normalizePath(path), content)) throw new Error('Backend setup exceeds the project file limit.');
      }
    });
    for (const event of [
      ...removed.map(path => ({ type: 'file_deleted', path: normalizePath(path) })),
      ...changed.map(([path, content]) => ({ type: 'file_updated', path: normalizePath(path), content })),
    ]) {
      const payload = JSON.stringify(event);
      connection.send(payload); this.broadcast(payload, [connection.id]);
    }
  }

  private saveTurn(prompt: string, response: string) {
    if (!prompt || !response) return;
    try {
      const branch = this.generationBranchId;
      this.transact(() => {
        this.runSql`INSERT INTO messages (role, content, branch_id) VALUES ('user', ${prompt}, ${branch});`;
        this.runSql`INSERT INTO messages (role, content, branch_id) VALUES ('assistant', ${response}, ${branch});`;
      });
    } catch (e) {
      console.warn('Failed saving turn to SQLite:', e);
    }
  }

  /**
   * Persists one user/assistant turn and records which generation epoch it
   * belongs to, so a failure handler can preserve the user's prompt without
   * duplicating a turn that was already saved for the same epoch.
   */
  private saveGenerationTurn(prompt: string, response: string, epoch?: number) {
    if (typeof epoch === 'number') this.turnSavedForEpoch = epoch;
    this.saveTurn(prompt, response);
  }

  private backupKey(): string {
    const id = this.name || this.ctx?.id?.toString?.() || 'default';
    return `backup-${id}.json`;
  }

  /**
   * The verified user behind a socket, or undefined if the connection has
   * dropped out of the map. Passed to `backupToR2` so the backup records who
   * owns the files it is about to store.
   */
  private senderUserId(connection: Connection): string | undefined {
    return this.connectionUserIds?.get(connection.id);
  }

  private getConnectionBranch(connection: Connection): string {
    try {
      const state = connection.state as { branchId?: string } | null;
      return state?.branchId || 'main';
    } catch { return 'main'; }
  }

  private setConnectionBranch(connection: Connection, branchId: string): void {
    try {
      const state = (connection.state as Record<string, unknown>) || {};
      connection.setState({ ...state, branchId });
    } catch (e) { console.warn('Failed to set branch state:', e); }
  }

  private backupToR2(ownerId?: string): Promise<void> {
    if (this.erasing) return Promise.resolve();
    this.pendingBackups ||= new Set();
    const work = this.writeBackup(ownerId);
    this.pendingBackups.add(work);
    void work.finally(() => this.pendingBackups.delete(work));
    return work;
  }
  private async writeBackup(ownerId?: string) {
    try {
      const r2 = this.env.PROJECT_BACKUPS;
      if (!r2) return;
      // The backup is the one reader that keeps secrets: a restore that drops
      // /server/.env silently breaks the user's app. It never leaves R2.
      const files = this.readAllProjectFilesForBackup();
      const timestamp = Date.now();
      const state = JSON.stringify({
        files: Object.entries(files).map(([path, content]) => ({ path, content })),
        timestamp,
        // Written so a restore can refuse a backup that belongs to somebody
        // else. The registry tombstone already stops a deleted project's id
        // being re-claimed; this is the defence-in-depth version of the same
        // check, and it is what makes the backup safe to leave in place.
        ownerId: ownerId ?? null,
        version: 2
      });
      await r2.put(this.backupKey(), state, {
        // Mirrored in custom metadata so it is visible without downloading the
        // object, and so an owner mismatch is detectable before any file body
        // is read into the isolate.
        customMetadata: { ownerId: ownerId ?? '', backedUpAt: new Date(timestamp).toISOString() }
      });
    } catch (e) {
      structuredLog('error', 'r2_backup_failed', { projectId: this.name, cause: e instanceof Error ? e.message : String(e) });
    }
  }

  private async restoreFromR2(currentUserId: string | null) {
    try {
      const r2 = this.env.PROJECT_BACKUPS;
      if (!r2) return;

      const countRows = [...this.sql`SELECT COUNT(*) as count FROM project_files`];
      // FIX: the guard was `> 1`, so a workspace holding exactly one file was
      // treated as empty and the restore overwrote it. Any existing file means
      // this object is already initialized.
      if (countRows.length > 0 && Number(countRows[0]?.count) > 0) {
        return;
      }

      const key = this.backupKey();
      const obj = await r2.get(key);
      if (!obj) return;

      // A backup that names a different owner is not ours to restore. It can
      // only exist if a project id moved between users, which the registry no
      // longer allows — so it is orphaned storage, and purging it here is the
      // cheapest place to reclaim it. A backup with no ownerId predates this
      // check; restoring it preserves existing work, and the tombstone guard
      // is still what makes that safe.
      const storedOwner = String(obj.customMetadata?.ownerId ?? '');
      if (storedOwner && currentUserId && storedOwner !== currentUserId) {
        console.warn(`Refused to restore backup owned by ${storedOwner} for user ${currentUserId}; purging orphaned backup`);
        try { await r2.delete(key); } catch (purgeErr) { console.warn('Failed to purge orphaned backup:', purgeErr); }
        return;
      }

      const state = await obj.json();
      const backupFiles = state?.files;
      if (backupFiles && Array.isArray(backupFiles)) {
        // Owner recorded in the body is checked too, so a copied object whose
        // metadata was stripped is still not restorable by the wrong user.
        const bodyOwner = (state as { ownerId?: unknown }).ownerId;
        if (typeof bodyOwner === 'string' && bodyOwner && currentUserId && bodyOwner !== currentUserId) {
          console.warn(`Refused to restore backup whose body names owner ${bodyOwner}`);
          return;
        }
        this.transact(() => {
          for (const file of backupFiles) {
            if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
            this.runSql`INSERT INTO project_files (path, content) VALUES (${normalizePath(file.path)}, ${file.content})
                       ON CONFLICT(path) DO UPDATE SET content=excluded.content;`;
          }
        });
        console.log('Restored from R2 backup successfully.');
      }
    } catch (e) {
      console.error('Failed to restore from R2', e);
    }
  }

  async onConnect(connection: Connection, ctx?: { request: Request }) {
    // A reconnect must cancel any pending abort that was scheduled when the
    // previous socket closed. Without this the timer fires after DISCONNECT_STOP_DELAY
    // even though a client is now connected.
    if (this.disconnectStopTimer) {
      clearTimeout(this.disconnectStopTimer);
      this.disconnectStopTimer = undefined;
    }
    if (this.erasing) { try { connection.close(4404, 'Project deleted'); } catch {} return; }
    // Fail closed: no verified user id on the upgrade request means the
    // connection bypassed the Worker's auth gate.
    const userId = ctx?.request ? getRequestUserId(ctx.request) : null;
    if (userId === 'QUOTA_EXCEEDED') {
      try { connection.close(4409, 'Quota exceeded'); } catch {}
      return;
    }
    if (userId === 'FORBIDDEN' || !userId) {
      structuredLog('warn', 'ws_rejected_unauth', { projectId: this.name });
      try { connection.close(4401, 'Unauthorized'); } catch { }
      return;
    }
    // A user with many tabs or a reconnect loop can otherwise hold an unbounded
    // number of sockets on one project. Counted before the id is recorded.
    const openForUser = [...this.connectionUserIds.values()].filter((u) => u === userId).length;
    if (openForUser >= MAX_CONNECTIONS_PER_USER) {
      structuredLog('warn', 'ws_rejected_conn_limit', { projectId: this.name, userId, openCount: openForUser });
      try { connection.close(4429, 'Too many open connections'); } catch { }
      return;
    }

    this.connectionUserIds.set(connection.id, userId);
    // Persist userId through DO hibernation. After a DO is evicted and revived,
    // connectionUserIds (in-memory Map) is empty, but connection.state survives
    // via Cloudflare's serializeAttachment API. onMessage reads it as fallback.
    const sessionHash = ctx?.request ? new URL(ctx.request.url).searchParams.get(SESSION_HASH_QUERY_PARAM) : null;
    if (!sessionHash || !/^[a-f0-9]{64}$/.test(sessionHash)) {
      this.connectionUserIds.delete(connection.id);
      try { connection.close(4401, 'Reconnect to verify your session'); } catch {}
      return;
    }
    try { connection.setState({ userId, sessionHash, branchId: 'main' }); } catch (e) { console.warn('Failed to persist connection state:', e instanceof Error ? e.message : e); }
    // Skip authorizeConnection here: the worker's onBeforeConnect already
    // verified session + ownership milliseconds ago. The per-message check
    // in onMessage still runs on every subsequent message, so logout and
    // ownership changes take effect without a stale authorization window.
    if (this.erasing) { try { connection.close(4404, 'Project deleted'); } catch {} return; }

    try {
      this.ensureSchema();
      const preRestoreCount = Number(([...this.sql`SELECT COUNT(*) as count FROM project_files`][0]?.count) ?? 0);
      if (preRestoreCount > 0) {
        // Files already in SQLite — R2 restore will short-circuit. Send history
        // immediately so the client can start the workspace sync without waiting
        // for the redundant R2 round-trip.
        this.sendHistoryMessage(connection, false);
        this.prewarmBackendReadiness(userId);
        this.checkServerBuildFailure(connection);
      } else {
        // Cold start or new project: R2 may have a backup to restore.
        await this.restoreFromR2(userId);
        if (this.erasing) return;
        // Check emptiness BEFORE seeding the starter template — the client uses
        // workspaceEmpty to skip the snapshot handshake on brand-new projects.
        const postRestoreCount = Number(([...this.sql`SELECT COUNT(*) as count FROM project_files`][0]?.count) ?? 0);
        this.seedStarterIfEmpty();
        this.sendHistoryMessage(connection, postRestoreCount === 0);
        this.prewarmBackendReadiness(userId);
        this.checkServerBuildFailure(connection);
      }
    } catch (err) {
      console.error('[onConnect] CRITICAL: uncaught exception in onConnect body:', err);
      // Don't rethrow — the SDK will close the socket with 1011 if we do, which
      // the client sees as 1006 and retries. Instead we close explicitly with a
      // message so the client can surface the error rather than looping forever.
      try { connection.send(JSON.stringify({ type: 'error', error: 'Session initialisation failed. Please refresh.' })); } catch (e) { noteSendFailure(e); }
    }
  }

  private sendHistoryMessage(connection: Connection, workspaceEmpty: boolean) {
    // A Durable Object can be evicted or restarted while a generation was
    // marked running: the in-memory session is gone but the job row survives.
    // Surface those orphans as resumable instead of letting them vanish.
    // Best-effort; history delivery must never fail because of it.
    let resumableJob: { id: string; completedFiles: number; error: string | null; resumesLeft: number; autoResume?: boolean } | null = null;
    this.recoverOrphanedGeneration();
    try {
      const jobs = this.generationJobs();
      if (!this.activeGeneration) {
        jobs.markOrphanedRunning('The connection dropped while the builder was working. Your saved files are safe — you can resume.');
      }
      const resumable = jobs.latestResumable();
      if (resumable) {
        resumableJob = {
          id: resumable.id,
          completedFiles: resumable.completedFiles.length,
          error: resumable.error,
          resumesLeft: Math.max(0, MAX_RESUMES - resumable.resumeCount),
          // Connection drops and transient provider errors (not user stops) auto-resume
          // on reconnect: the user didn't ask to stop, so don't make them click.
          // Bounded by MAX_RESUMES.
          autoResume: !!resumable.error && /connection dropped|internal error|temporarily overloaded|too much traffic|took too long to respond|ran out of time/i.test(resumable.error),
        };
      }
    } catch { /* resumable state is auxiliary */ }
    try {
      const branchId = this.getConnectionBranch(connection);
      const totalRows = [...this.sql`SELECT COUNT(*) as count FROM messages WHERE branch_id = ${branchId}`];
      const total = Number(totalRows[0]?.count ?? 0);
      const rows = total > HISTORY_ON_CONNECT
        ? [...this.sql`SELECT role, content FROM messages WHERE branch_id = ${branchId} ORDER BY id DESC LIMIT ${HISTORY_ON_CONNECT}`].reverse()
        : [...this.sql`SELECT role, content FROM messages WHERE branch_id = ${branchId} ORDER BY id ASC`];
      const transcript = rows.map(row => ({ ...row,
        content: row.role === 'assistant' ? formatToolTranscript(String(row.content || '')) : row.content,
        internal: row.role === 'user' && isSystemContinuation(String(row.content || '')),
      }));
      connection.send(JSON.stringify({ type: 'history', data: transcript, total, truncated: total > rows.length, workspaceSync: 'snapshot-v2', workspaceEmpty, generation: this.generationSnapshot(), resumableJob, activeBranch: branchId, previewStoreCapped: this.previewStoreCapped, previewCappedReason: this.previewCappedReason }));
    } catch (e) {
      console.warn('Failed retrieving history onConnect:', e);
      try { connection.send(JSON.stringify({ type: 'history', data: [], workspaceSync: 'snapshot-v2', workspaceEmpty, generation: this.generationSnapshot(), resumableJob, activeBranch: 'main', previewStoreCapped: this.previewStoreCapped, previewCappedReason: this.previewCappedReason })); } catch (e2) { noteSendFailure(e2); }
    }
    try { connection.send(JSON.stringify({ type: 'files_changed', revision: this.getFilesRevision() })); } catch (e) { noteSendFailure(e); }
  }

  async onClose(connection: Connection) {
    this.connectionUserIds.delete(connection.id);
    this.pendingAuth.delete(connection.id);
    this.authCache.delete(connection.id);
    if (this.connectionUserIds.size === 0) {
      clearTimeout(this.disconnectStopTimer);
      this.disconnectStopTimer = setTimeout(() => {
        if (this.connectionUserIds.size === 0) this.abortGeneration();
      }, DISCONNECT_STOP_DELAY);
    }
  }

  /** Writes one file, rejecting oversized content and protected paths. */
  private upsertFile(path: string, content: string): boolean {
    // Full HTML documents must carry a doctype or browsers render the app in
    // quirks mode. Idempotent; also applied by the write tool so its cached
    // copy matches what is stored.
    content = ensureHtmlDoctype(path, content);
    if (isBlockedSecretFile(path)) {
      // A generated app may legitimately author /server/.env; it is stored, but
      // never served. Storage is allowed, reads are filtered.
    }
    if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) {
      console.warn(`Refusing oversized file ${path} (${content.length} bytes)`);
      return false;
    }
    this.runSql`INSERT INTO project_files (path, content) VALUES (${path}, ${content})
               ON CONFLICT(path) DO UPDATE SET content=excluded.content, updated_at=CURRENT_TIMESTAMP;`;
    // Durable per-file checkpoint for resumable generations. Guarded by
    // activeJobId so non-generation writes (sync, restore) are not tracked.
    // Best-effort: tracking must never break a file write.
    if (this.activeJobId) {
      try { this.generationJobs().markFileComplete(this.activeJobId, path); }
      catch { /* file is saved; only the resume checkpoint missed */ }
    }
    return true;
  }

  /**
   * Platform-level safeguard: ensures deterministic scaffold files exist.
   * Bolt-style — pure boilerplate (main.tsx, index.html, tsconfig, vite
   * config, AppBoundary) is injected by the platform so the model never
   * spends tokens writing it. Called after generation completes.
   * Writes directly via SQL to avoid tracking as model-generated files.
   */
  private ensureEntryPointExists(): void {
    const starter = createTypeScriptStarter();
    const has = (p: string): boolean => {
      const row = this.sql`SELECT 1 FROM project_files WHERE path = ${p} OR path = ${p.slice(1)} LIMIT 1`;
      return [...row].length > 0;
    };
    const scaffold: Record<string, string> = {};
    if (!has('/src/main.tsx') && !has('/src/main.jsx')) {
      if (starter['/src/main.tsx']) scaffold['/src/main.tsx'] = starter['/src/main.tsx'];
    }
    for (const p of ['/index.html', '/tsconfig.json', '/vite.config.ts', '/src/components/AppBoundary.tsx'] as const) {
      if (!has(p) && starter[p]) scaffold[p] = starter[p];
    }
    for (const [path, content] of Object.entries(scaffold)) {
      this.runSql`INSERT INTO project_files (path, content) VALUES (${path}, ${content})
                 ON CONFLICT(path) DO UPDATE SET content=excluded.content, updated_at=CURRENT_TIMESTAMP;`;
    }
  }

  /** True for the preview harness entry point, which this object owns. */
  private isHarnessEntry(cleanPath: string): boolean {
    return isHarnessEntryModule(cleanPath);
  }

  private missingFileCandidates(missing: Array<{ importer: string; specifier: string; resolvedPath: string }>): string[] {
    return this.fileExtractor.missingFileCandidates(missing);
  }

  /**
   * Post-generation completeness check. The per-batch dangling-import check in
   * extractAndSaveFiles can miss files when generation cuts off between batches
   * (e.g. App.tsx written in batch 1, AuthPage.tsx never written because the
   * build ended early). This runs once after the final stage completes, scanning
   * ALL project files for unresolvable imports. Missing files trigger one bounded
   * [AUTO-FIX] repair; if that was already used, the user gets a clear warning
   * listing exactly what's missing instead of a silent broken preview.
   *
   * Returns true when a repair turn was queued (P0-4): the caller must then
   * hold the completed status until the repair turn resolves.
   */
  private checkFinalCompleteness(allFiles: Map<string, string>, connection: Connection): string | null { return this.pipeline.checkFinalCompleteness(allFiles, connection); }

  /**
   * R-3: When a fresh build writes files but leaves the App entry as the
   * starter placeholder (or absent entirely), the app is functionally blank.
   * `checkFinalCompleteness` can't catch this because nothing *imports*
   * App.tsx — it's the root. Queue one bounded repair turn demanding the entry.
   */
  private checkMissingAppEntry(allFiles: Map<string, string>, connection: Connection): string | null { return this.pipeline.checkMissingAppEntry(allFiles, connection); }

  private verifyFinalCompleteness(connection: Connection, defer?: (event: () => void) => void): boolean { return this.pipeline.verifyFinalCompleteness(connection, defer); }

  /**
   * Post-generation check: detect files that call useAuth, AuthProvider, or
   * AuthContext without any file in the project defining them. When found,
   * queue a repair turn that replaces the phantom references with direct
   * session-API calls.
   */
  private checkNoPhantomAuthHooks(allFiles: Map<string, string>, connection: Connection): string | null { return this.pipeline.checkNoPhantomAuthHooks(allFiles, connection); }

  private verifyNoPhantomAuthHooks(connection: Connection, defer?: (event: () => void) => void): boolean { return this.pipeline.verifyNoPhantomAuthHooks(connection, defer); }

  /**
   * Post-generation check: validate brainhalf.verify.json using the same Zod
   * schema the publisher uses. Triggers a repair turn when:
   *   (a) the file is missing but a worker backend (/worker/index.ts) exists, or
   *   (b) the file is present but fails schema validation (< 3 steps, no write
   *       step, no database assertion, etc.).
   * Capped at one repair attempt so a model that cannot produce a valid file
   * does not loop; the user sees a generation notice and can prompt manually.
   */
  private checkVerificationPlanFile(allFiles: Map<string, string>, connection: Connection): string | null { return this.pipeline.checkVerificationPlanFile(allFiles, connection); }

  private verifyVerificationPlanFile(connection: Connection, defer?: (event: () => void) => void): boolean { return this.pipeline.verifyVerificationPlanFile(connection, defer); }

  /**
   * Post-generation check: every fetch('/api/...') call in /src/ files must
   * have a matching route handler in /worker/index.ts. When uncovered routes
   * are found, queues one bounded repair turn that adds the missing handlers.
   */
  private checkApiRouteCoverage(allFiles: Map<string, string>, connection: Connection): string | null { return this.pipeline.checkApiRouteCoverage(allFiles, connection); }

  private verifyApiRouteCoverage(connection: Connection, defer?: (event: () => void) => void): boolean { return this.pipeline.verifyApiRouteCoverage(connection, defer); }

  /**
   * P0-4: record that a turn queued a repair/retry turn. First marker wins per
   * turn (the client honors a single trigger-auto-reply per response). If this
   * turn IS itself a pending repair that queued a follow-up, the original
   * parent transfers to the new repair instead of nesting. Returns true when
   * this call recorded the turn's repair.
   */
  private noteRepairQueued(jobId: string, actualPrompt: string, marker: string | null): boolean { return this.pipeline.noteRepairQueued(jobId, actualPrompt, marker); }

  /**
   * P0-4: resolves the parent turn's bookkeeping when a queued repair turn
   * finishes. The parent was left 'running' with its usage row open (never
   * marked completed before the repair outcome was known). Only the turn whose
   * prompt carries the queued repair's marker can resolve it.
   */
  private resolveCompletenessRepair(actualPrompt: string, accountingId: string, completed: boolean, jobOutcome: { kind: 'failed' | 'interrupted'; error: string } | null, aborted: boolean): void { this.pipeline.resolveCompletenessRepair(actualPrompt, accountingId, completed, jobOutcome, aborted); }

  private pendingAuth = new Map<string, Promise<boolean>>();
  private authCache = new Map<string, { ok: boolean; ts: number }>();

  /** Recheck the originating session and current ACL, including after hibernation. */
  private authorizeConnection(connection: Connection, forceRefresh = false): Promise<boolean> {
    const cached = this.authCache.get(connection.id);
    if (!forceRefresh && cached && cached.ok && Date.now() - cached.ts < AUTH_CACHE_TTL) {
      return Promise.resolve(true);
    }
    const existing = this.pendingAuth.get(connection.id);
    if (existing) return existing;
    const promise = this.doAuthorizeConnection(connection).then((ok) => {
      if (ok) this.authCache.set(connection.id, { ok, ts: Date.now() });
      else this.authCache.delete(connection.id);
      return ok;
    }).finally(() => {
      this.pendingAuth.delete(connection.id);
    });
    this.pendingAuth.set(connection.id, promise);
    return promise;
  }

  private async doAuthorizeConnection(connection: Connection): Promise<boolean> {
    const state = connection.state as { userId?: string; sessionHash?: string; transientAuthFailures?: number } | null;
    const uri = connection.uri ? new URL(connection.uri) : null;
    const userId = state?.userId || uri?.searchParams.get(USER_ID_QUERY_PARAM);
    const sessionHash = state?.sessionHash || uri?.searchParams.get(SESSION_HASH_QUERY_PARAM);
    if (userId && sessionHash && /^[a-f0-9]{64}$/.test(sessionHash)) {
      try {
        const [sessionRes, ownerOk] = await Promise.all([
          getRegistry(this.env).fetch(`https://registry/sessions/${sessionHash}`),
          isProjectOwner(this.env, this.name, userId),
        ]);
        if (sessionRes.ok && (await sessionRes.json() as { userId?: string }).userId === userId && ownerOk) {
          this.connectionUserIds.set(connection.id, userId);
          // Reset transient failure counter on a confirmed success.
          if ((state?.transientAuthFailures ?? 0) > 0) {
            try { connection.setState({ ...state, transientAuthFailures: 0 }); } catch {}
          }
          return true;
        }
        // Definitive rejection: Registry responded but session or ownership check failed.
      } catch (e) {
        // Transient failure: Registry timeout, 5xx, DO cold start.
        // Tolerate 1 consecutive transient before failing closed so that
        // a brief Registry hiccup does not kill a running generation.
        console.warn('Auth check failed (transient):', e instanceof Error ? e.message : e);
        const failures = (state?.transientAuthFailures ?? 0) + 1;
        try { connection.setState({ ...state, transientAuthFailures: failures }); } catch {}
        if (failures < 2) return true;
        console.warn(`Auth check failed ${failures} times consecutively on ${connection.id}; failing closed`);
      }
    }
    // Definitive rejection or missing credentials or 3 consecutive transient failures.
    this.connectionUserIds.delete(connection.id);
    try { connection.close(4401, 'Session expired or project access revoked'); } catch {}
    return false;
  }

  async onMessage(connection: Connection, message: string) {
    const requestEpoch = this.writeEpoch.value;
    try {
      if (this.erasing) return;
      // Ping doubles as an auth liveness check — bypass the cache so logout
      // revocation is reflected on the next heartbeat without a 30-second lag.
      if (message === '{"type":"ping"}') this.authCache.delete(connection.id);
      if (!await this.authorizeConnection(connection)) return;
      if (this.erasing) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch {
        try { connection.send(JSON.stringify({ type: 'error', error: 'Malformed message payload' })); } catch (e) { noteSendFailure(e); }
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const data = parsed as ClientMessage;

      this.ensureSchema();

      if (data.type === 'ping') {
        try { connection.send(JSON.stringify({ type: 'pong' })); } catch (e) { noteSendFailure(e); }
        return;
      }

      if (data.type === 'get_files') {
        const requestId = typeof data.requestId === 'string' && /^[\w-]{1,80}$/.test(data.requestId) ? data.requestId : crypto.randomUUID();
        try {
          // A caller may page through the workspace; the defaults cap a single
          // message so one enormous project cannot produce a multi-MB WS frame.
          const limit = clampInt(data.limit, 1, MAX_FILES_PAGE, MAX_FILES_PAGE);
          const offset = clampInt(data.offset, 0, Number.MAX_SAFE_INTEGER, 0);
          const revision = this.getFilesRevision();
          if ((offset > 0 && data.revision === undefined) || (data.revision !== undefined && data.revision !== revision)) {
            connection.send(JSON.stringify({ type: 'files_snapshot_stale', requestId }));
            return;
          }
          const page = this.readProjectFilesPage(limit, offset);
          connection.send(JSON.stringify({
            type: 'files_snapshot',
            protocol: 2,
            requestId,
            revision,
            ...page,
            limit,
            offset,
          }));
        } catch (e) {
          console.error('Error handling get_files:', e);
          connection.send(JSON.stringify({ type: 'files_snapshot_error', requestId, error: 'Workspace snapshot unavailable; existing files were preserved.' }));
        }
        return;
      }

      if (data.type === 'stop') {
        // Bump the epoch so any in-flight generation's late file writes are
        // discarded, then abort the stream itself.
        this.abortGeneration();
        const stoppedMsg = JSON.stringify({ type: 'stopped' });
        try { connection.send(stoppedMsg); } catch (e) { noteSendFailure(e); }
        try { this.broadcast(stoppedMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
        return;
      }

      if (data.type === 'clear') {
        try {
          const branchId = this.getConnectionBranch(connection);
          this.runSql`DELETE FROM messages WHERE branch_id = ${branchId};`;
          const clearedMsg = JSON.stringify({ type: 'history', data: [], clearedBranch: branchId });
          try { connection.send(clearedMsg); } catch (e) { noteSendFailure(e); }
          try { this.broadcast(clearedMsg, [connection.id]); } catch (e) { noteSendFailure(e); }
        } catch (e) {
          console.error('Error clearing history:', e);
        }
        return;
      }

      if (data.type === 'rewrite_history' && Array.isArray(data.messages)) {
        try {
          // Delete-then-reinsert in one transaction. Without it a failure halfway
          // leaves an empty history — the conversation is gone but not replaced.
          // Adjacent duplicates are dropped so a re-sent edit does not inflate
          // the context window with identical turns.
          // B1: drop poisoned turns (empty/placeholder assistant replies from
          // failed attempts) so they can never re-enter the model context.
          const messages = dedupeAdjacent(
            data.messages
              .filter((m): m is { role: 'user' | 'assistant' | 'ai'; content: string } =>
                m !== null && (m.role === 'user' || m.role === 'assistant' || m.role === 'ai') && typeof m.content === 'string')
              .filter(m => m.role === 'user' || !isEmptyAssistantResponse(m.content))
              .map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: String(m.content).slice(0, 200_000) }))
          );
          const branchId = this.getConnectionBranch(connection);
          this.transact(() => {
            this.runSql`DELETE FROM messages WHERE branch_id = ${branchId};`;
            for (const msg of messages) {
              this.runSql`INSERT INTO messages (role, content, branch_id) VALUES (${msg.role}, ${msg.content}, ${branchId});`;
            }
          });
        } catch (e) {
          console.error('Error rewriting history:', e);
        }
        return;
      }

      if (data.type === 'fork_conversation') {
        try {
          const currentBranch = this.getConnectionBranch(connection);
          const forkName = typeof data.name === 'string' ? data.name.slice(0, 100) : `Fork ${Date.now()}`;
          const forkId = `branch_${crypto.randomUUID()}`;
          const currentMessages = this.runSql<{ role: string; content: string }>`SELECT role, content FROM messages WHERE branch_id = ${currentBranch} ORDER BY id ASC`;
          const forkPoint = typeof data.messageIndex === 'number' ? Math.max(0, Math.min(data.messageIndex, currentMessages.length)) : currentMessages.length;
          this.transact(() => {
            this.runSql`INSERT INTO conversation_branches (id, name, parent_branch_id, fork_message_id, created_at) VALUES (${forkId}, ${forkName}, ${currentBranch}, ${forkPoint}, ${Date.now()})`;
            for (let i = 0; i < forkPoint; i++) {
              this.runSql`INSERT INTO messages (role, content, branch_id) VALUES (${currentMessages[i].role}, ${currentMessages[i].content}, ${forkId})`;
            }
          });
          this.setConnectionBranch(connection, forkId);
          const evt = JSON.stringify({ type: 'branch_created', branchId: forkId, name: forkName, messageCount: forkPoint });
          try { connection.send(evt); } catch (e) { noteSendFailure(e); }
        } catch (e) {
          try { connection.send(JSON.stringify({ type: 'error', error: 'Failed to fork conversation' })); } catch {}
          console.error('Fork conversation error:', e);
        }
        return;
      }

      if (data.type === 'switch_branch' && typeof data.branchId === 'string') {
        try {
          const branchExists = this.runSql`SELECT id FROM conversation_branches WHERE id = ${data.branchId}`;
          if (!branchExists.length) {
            try { connection.send(JSON.stringify({ type: 'error', error: 'Branch not found' })); } catch {}
            return;
          }
          this.setConnectionBranch(connection, data.branchId);
          const totalRows = this.runSql<{ count: number }>`SELECT COUNT(*) as count FROM messages WHERE branch_id = ${data.branchId}`;
          const total = Number(totalRows[0]?.count ?? 0);
          const branchMessages = total > HISTORY_ON_CONNECT
            ? this.runSql<{ role: string; content: string }>`SELECT role, content FROM messages WHERE branch_id = ${data.branchId} ORDER BY id DESC LIMIT ${HISTORY_ON_CONNECT}`.reverse()
            : this.runSql<{ role: string; content: string }>`SELECT role, content FROM messages WHERE branch_id = ${data.branchId} ORDER BY id ASC`;
          const transcript = branchMessages.map(row => ({
            ...row,
            content: row.role === 'assistant' ? formatToolTranscript(String(row.content || '')) : row.content,
            internal: row.role === 'user' && isSystemContinuation(String(row.content || '')),
          }));
          connection.send(JSON.stringify({ type: 'branch_switched', branchId: data.branchId, history: transcript, total, truncated: total > branchMessages.length }));
        } catch (e) {
          console.error('Switch branch error:', e);
          try { connection.send(JSON.stringify({ type: 'error', error: 'Failed to switch branch' })); } catch {}
        }
        return;
      }

      if (data.type === 'list_branches') {
        try {
          const branches = this.runSql<{ id: string; name: string; parent_branch_id: string | null; created_at: number; messageCount: number }>`SELECT b.id, b.name, b.parent_branch_id, b.created_at, COUNT(m.id) as messageCount FROM conversation_branches b LEFT JOIN messages m ON m.branch_id = b.id GROUP BY b.id ORDER BY b.created_at ASC`;
          const result = branches.map(b => ({ ...b, messageCount: Number(b.messageCount ?? 0) }));
          connection.send(JSON.stringify({ type: 'branches_list', branches: result, activeBranch: this.getConnectionBranch(connection) }));
        } catch (e) {
          console.error('List branches error:', e);
          try { connection.send(JSON.stringify({ type: 'error', error: 'Failed to list branches' })); } catch {}
        }
        return;
      }

      if (data.type === 'delete_branch' && typeof data.branchId === 'string') {
        try {
          if (data.branchId === 'main') {
            try { connection.send(JSON.stringify({ type: 'error', error: 'Cannot delete the main branch' })); } catch {}
            return;
          }
          if (this.generationLock?.isHeld && this.generationBranchId === data.branchId) {
            try { connection.send(JSON.stringify({ type: 'error', error: 'Cannot delete a branch while it has an active generation' })); } catch {}
            return;
          }
          this.transact(() => {
            this.runSql`DELETE FROM messages WHERE branch_id = ${data.branchId}`;
            this.runSql`UPDATE conversation_branches SET parent_branch_id = NULL WHERE parent_branch_id = ${data.branchId}`;
            this.runSql`DELETE FROM conversation_branches WHERE id = ${data.branchId}`;
          });
          for (const conn of this.getConnections()) {
            if (this.getConnectionBranch(conn) === data.branchId) {
              this.setConnectionBranch(conn, 'main');
            }
          }
          const evt = JSON.stringify({ type: 'branch_deleted', branchId: data.branchId });
          try { connection.send(evt); } catch (e) { noteSendFailure(e); }
          try { this.broadcast(evt, [connection.id]); } catch (e) { noteSendFailure(e); }
        } catch (e) {
          console.error('Delete branch error:', e);
          try { connection.send(JSON.stringify({ type: 'error', error: 'Failed to delete branch' })); } catch {}
        }
        return;
      }

      if (data.type === 'sync_files' && data.files && typeof data.files === 'object') {
        // P0-1: never let an editor sync interleave with an active generation's
        // file writes — the stale tree would overwrite just-generated files and
        // the build would still report success. The client refreshes and retries
        // after the build, same as a revision conflict.
        if (this.generationLock?.isHeld) {
          try { connection.send(JSON.stringify({ type: 'files_sync_conflict', revision: this.getFilesRevision(), reason: 'generation_in_progress' })); } catch { }
          return;
        }
        if (data.expected_revision !== undefined && data.expected_revision !== this.getFilesRevision()) {
          connection.send(JSON.stringify({ type: 'files_sync_conflict', revision: this.getFilesRevision() }));
          return;
        }
        const syncFiles = data.files;
        const syncCount = Object.keys(syncFiles).length;
        if (syncCount > MAX_FILES_PER_SYNC) {
          try {
            connection.send(JSON.stringify({
              type: 'error',
              error: `Sync refused: ${syncCount} files exceeds the ${MAX_FILES_PER_SYNC} per-message limit. Sync in batches.`,
            }));
          } catch { }
          return;
        }
        try {
          // A replace_all with no files is almost certainly corrupted client
          // state — it would DELETE every file and write nothing, destroying
          // the project and overwriting R2 with an empty backup.
          if (data.replace_all && Object.keys(syncFiles).length === 0) {
            try { connection.send(JSON.stringify({ type: 'error', error: 'Refusing replace_all with empty file set' })); } catch (e) { noteSendFailure(e); }
            return;
          }
          // FIX: `replace_all` previously ran DELETE and then a bare loop of
          // inserts. A failure partway through left the workspace empty — the
          // old project deleted, the new one only half written. One transaction.
          this.transact(() => {
            if (data.replace_all) {
              if (data.preserve_secrets === true) {
                const storedPaths = this.runSql`SELECT path FROM project_files`;
                for (const row of storedPaths) {
                  if (!isBlockedSecretFile(row.path)) this.runSql`DELETE FROM project_files WHERE path = ${row.path}`;
                }
              } else {
                this.runSql`DELETE FROM project_files;`;
              }
            }
            for (const [path, content] of Object.entries(syncFiles)) {
              if (typeof content !== 'string') continue;
              const cleanPath = normalizePath(path);
              if (this.isHarnessEntry(cleanPath)) continue;
              this.upsertFile(cleanPath, content);
            }
          });
          connection.send(JSON.stringify({ type: 'files_synced', revision: this.getFilesRevision() }));
          this.backupToR2(this.senderUserId(connection)).catch(console.error);
        } catch (e) {
          console.error('Error syncing files to SQLite:', e);
          try { connection.send(JSON.stringify({ type: 'error', error: 'File sync failed; workspace unchanged' })); } catch (e) { noteSendFailure(e); }
        }
        return;
      }

      if (this.writeEpoch.value !== requestEpoch) return;
      if (data.workspaceFiles && typeof data.workspaceFiles === 'object') {
        // P0-1/P0-2: the auto-sync path previously ignored expected_revision
        // and ran during active generations, letting a stale editor tree
        // clobber just-generated files. Same protection as explicit sync_files.
        if (this.generationLock?.isHeld) {
          try { connection.send(JSON.stringify({ type: 'files_sync_conflict', revision: this.getFilesRevision(), reason: 'generation_in_progress' })); } catch { }
          return;
        }
        if (data.expected_revision !== undefined && data.expected_revision !== this.getFilesRevision()) {
          try { connection.send(JSON.stringify({ type: 'files_sync_conflict', revision: this.getFilesRevision() })); } catch { }
          return;
        }
        // Bounded the same way as an explicit sync: an editor that posts its
        // whole tree on every keystroke burst would otherwise rewrite the
        // workspace without limit.
        const workspaceFiles = data.workspaceFiles;
        if (Object.keys(workspaceFiles).length > MAX_FILES_PER_SYNC) {
          try {
            connection.send(JSON.stringify({
              type: 'error',
              error: `Sync refused: too many files in one message (limit ${MAX_FILES_PER_SYNC}).`,
            }));
          } catch { }
          return;
        }
        try {
          this.transact(() => {
            for (const [path, content] of Object.entries(workspaceFiles)) {
              if (typeof content !== 'string') continue;
              const cleanPath = normalizePath(path);
              if (this.isHarnessEntry(cleanPath)) continue;
              this.upsertFile(cleanPath, content);
            }
          });
          this.backupToR2(this.senderUserId(connection)).catch(console.error);
        } catch (e) {
          console.error('Error auto-syncing workspaceFiles into SQLite:', e);
        }
      }

      // Chains a resumed generation to the interrupted job it continues.
      // Consumed at job creation below; null for brand-new prompts.
      let resumeChain: { parentJobId: string; resumeCount: number; initialFiles: string[] } | null = null;

      if (data.type === 'resume_generation') {
        const jobs = this.generationJobs();
        const requestedId = typeof (data as { jobId?: unknown }).jobId === 'string' ? String((data as { jobId: unknown }).jobId) : '';
        const job = (requestedId ? jobs.get(requestedId) : null) ?? jobs.latestResumable();
        if (!job || !jobs.canResume(job)) {
          try {
            connection.send(JSON.stringify({
              type: 'error',
              error: requestedId
                ? 'That build can no longer be resumed. Send your request again to start a fresh build.'
                : 'There is no interrupted build to resume. Send your request to start building.',
            }));
          } catch { }
          return;
        }
        // Cumulative files across the resume chain: walk up through parents
        // so a second resume still knows about the first attempt's files.
        // The root job's prompt is the original user request — a resumed job
        // stores the generated continuation, which must not be reused as the
        // "original" on a later resume.
        const cumulative: string[] = [];
        const seen = new Set<string>();
        let cursor: { completedFiles: string[]; parentJobId: string | null; prompt: string } | null = job;
        let rootPrompt = job.prompt;
        let depth = 0;
        while (cursor && depth < 8) {
          for (const p of cursor.completedFiles) {
            if (!seen.has(p)) { seen.add(p); cumulative.push(p); }
          }
          if (cursor.parentJobId) {
            const parent = jobs.get(cursor.parentJobId);
            if (parent) rootPrompt = parent.prompt;
            cursor = parent;
          } else {
            cursor = null;
          }
          depth++;
        }
        // Scan completed files for unresolved local imports so the model knows
        // exactly what pending files to generate next instead of hanging or guessing.
        const pendingFiles: string[] = [];
        try {
          const existingPathRows = this.runSql<{ path: string }>`SELECT path FROM project_files`;
          const existingSet = new Set(existingPathRows.map(r => r.path));
          for (const cPath of cumulative) {
            existingSet.add(cPath);
          }

          const fileExts = ['.tsx', '.ts', '.jsx', '.js', '.css'];
          for (const p of cumulative) {
            if (!p.endsWith('.tsx') && !p.endsWith('.ts') && !p.endsWith('.jsx') && !p.endsWith('.js')) continue;
            const content = this.runSql<{ content: string }>`SELECT content FROM project_files WHERE path = ${p}`[0]?.content;
            if (!content) continue;

            const importRegex = /(?:import|export)\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"](\.[^'"]+)['"]/g;
            let match: RegExpExecArray | null;
            const dir = p.substring(0, p.lastIndexOf('/')) || '/';
            while ((match = importRegex.exec(content)) !== null) {
              const rel = match[1];
              const parts = (dir + '/' + rel).split('/').filter(Boolean);
              const stack: string[] = [];
              for (const seg of parts) {
                if (seg === '.') continue;
                if (seg === '..') {
                  if (stack.length > 0) stack.pop();
                } else {
                  stack.push(seg);
                }
              }
              const resolvedBase = '/' + stack.join('/');
              const candidates = [
                resolvedBase,
                ...fileExts.map(ext => resolvedBase + ext),
                ...fileExts.map(ext => resolvedBase + '/index' + ext),
              ];
              const found = candidates.some(cand => existingSet.has(cand));
              if (!found) {
                const targetPath = (resolvedBase.startsWith('/src/components') || p.endsWith('.tsx'))
                  ? resolvedBase + '.tsx'
                  : resolvedBase + '.ts';
                if (!pendingFiles.includes(targetPath)) {
                  pendingFiles.push(targetPath);
                }
              }
            }
          }
        } catch (scanErr) {
          console.warn('Failed scanning pending imports on resume:', scanErr);
        }

        const pendingList = pendingFiles.length > 0
          ? `\nCRITICAL MISSING FILES (These are imported by completed files but not yet written):\n` +
            pendingFiles.slice(0, 30).map(p => `- ${p}`).join('\n') +
            `\nYou MUST write these missing files first so the project compiles and runs cleanly.\n\n`
          : '';

        // The completed files are already durable in project_files; list them
        // so the model writes only what is missing. Cap the list so the
        // continuation prompt stays bounded.
        const doneList = cumulative.slice(0, 120).map(p => `- ${p}`).join('\n');
        const doneNote = cumulative.length > 120 ? `\n(and ${cumulative.length - 120} more)` : '';
        const resumePrompt =
          `[AUTO-CONTINUE] Continue building the app requested here: "${rootPrompt.slice(0, 2000)}".\n\n` +
          `The previous build was interrupted after saving ${cumulative.length} file(s). ` +
          `These files are already complete and saved — DO NOT rewrite them:\n${doneList}${doneNote}\n\n` +
          pendingList +
          `Write ONLY the remaining files needed to finish the app. Do not modify the completed files ` +
          `unless one of them is broken and blocks the app from working.`;
        resumeChain = { parentJobId: job.id, resumeCount: job.resumeCount + 1, initialFiles: cumulative };
        data.prompt = resumePrompt;
        try {
          connection.send(JSON.stringify({
            type: 'generation_notice',
            message: `Picking up where the build stopped (${cumulative.length} file(s) already saved)…`,
            resumedFrom: job.id,
          }));
        } catch { }
      }

      let actualPrompt = String(data.prompt || data.message || 'Hello');
      let plannerMode = false;
      if (actualPrompt.startsWith('/plan ')) {
        actualPrompt = actualPrompt.substring(6).trim();
        plannerMode = true;
      } else if (shouldAutoPlannerMode(actualPrompt)) {
        plannerMode = true;
      }
      // B4: wipe-the-project requests run tool-less — the model can only ask
      // for confirmation in text; zero file operations are possible this turn.
      // B5: plain-text questions are answered in chat with zero file writes.
      // Ambiguous build requests ("make something cool") also run tool-less so
      // the model asks what to build instead of launching a blind generation.
      const destructiveMode = !plannerMode && isDestructivePrompt(actualPrompt);
      const questionMode = !plannerMode && !destructiveMode && isQuestionPrompt(actualPrompt);
      const ambiguousMode = !plannerMode && !destructiveMode && !questionMode && isAmbiguousPrompt(actualPrompt);

      if (actualPrompt.length > MAX_PROMPT_CHARS) {
        // Bounded before any inference is purchased: the client surfaces the
        // limit instead of the model silently truncating a huge brief.
        try {
          connection.send(JSON.stringify({
            type: 'error',
            error: `Prompt is ${actualPrompt.length} characters; the limit is ${MAX_PROMPT_CHARS}. Shorten it and try again.`,
          }));
        } catch { }
        return;
      }

      // Meter per user, not per connection: a client that opens several sockets
      // to the same project would otherwise multiply its quota. Counted only for
      // real prompts — get_files/sync traffic does not buy inference.
      const senderId = this.connectionUserIds.get(connection.id);
      if (senderId) {
        const rate = GENERATION_LIMITER.check('generation', senderId);
        if (!rate.ok) {
          try {
            connection.send(JSON.stringify({
              type: 'error',
              error: `Too many prompts. Try again in about ${rate.retryAfter}s.`,
            }));
          } catch { }
          return;
        }
      }

      const executionTarget = data.executionTarget === 'export' ? 'export' : 'managed';
      if (!plannerMode && executionTarget === 'managed' && needsBackend(actualPrompt, this.readAllProjectFiles())) {
        let ready = false;
        const now = Date.now();
        if (this.backendReadyCache && this.backendReadyCache.expiresAt > now) {
          ready = this.backendReadyCache.ready;
        } else {
          const runtime = this.env?.RUNTIME;
          // 3 s timeout: prewarmBackendReadiness fires on connect, so this is
          // normally a cache hit. If the prewarm hasn't landed yet, 3 s is enough
          // for the runtime to respond without blocking the user noticeably.
          const available = runtime && senderId ? await runtime.fetch(new Request('https://runtime/status?environment=development&readiness=1', { headers: { 'x-bh-project': this.name, 'x-bh-owner': senderId }, signal: AbortSignal.timeout(3_000) })) : null;
          ready = !!available?.ok && hostingAvailability(await available.json() as RuntimeStatus).state === 'ready';
          // Cache positive results for 60 s (the runtime won't vanish that fast).
          // Cache negative results for only 5 s so a user who retries after the
          // runtime comes online is not rejected by stale state for a full minute.
          this.backendReadyCache = { ready, expiresAt: now + (ready ? BACKEND_READY_POSITIVE_TTL : BACKEND_READY_NEGATIVE_TTL) };
        }
        if (this.erasing || this.writeEpoch.value !== requestEpoch) return;
        if (!ready) {
          connection.send(JSON.stringify({ type: 'error', code: 'hosting_unavailable', error: 'Online app services are unavailable right now. Please try again shortly, or download the app to host elsewhere.' }));
          return;
        }
        if (!await this.authorizeConnection(connection)) return;
      }
      // A stop, deletion, revocation, or newer generation during the readiness
      // request invalidates this prompt before any inference is reserved.
      if (this.erasing || this.writeEpoch.value !== requestEpoch) return;

      // A reconnect redelivers the last message; without an idempotency key the
      // user gets two generations for one prompt. Claim before taking the lock so
      // a duplicate is refused without serialising behind an in-flight job.
      const requestKey = typeof data.idempotencyKey === 'string' ? data.idempotencyKey : null;
      if (!this.idempotency.claim(requestKey)) {
        const dup = JSON.stringify({ type: 'error', error: 'Duplicate request ignored (idempotency key already seen)' });
        try { connection.send(dup); } catch (e) { noteSendFailure(e); }
        return;
      }

      // Bound the stored conversation: a project with a thousand turns would
      // otherwise keep every one of them forever, and the context window only
      // ever reads the recent tail anyway.
      try {
        this.pruneMessages();
      } catch (e) {
        console.warn('Failed to prune message history:', e);
      }

      // Early ack so the client switches from "Connecting to AI model..." to
      // "Thinking..." as soon as the server has accepted the prompt.
      try { connection.send(JSON.stringify({ type: 'generation_notice', message: 'Thinking...' })); } catch (e) { noteSendFailure(e); }

      // Refuse a second concurrent generation rather than letting two of them
      // interleave their file writes. The client is told why and can retry.
      // The lock has a timeout so a generation that never settles cannot hold
      // the project hostage — the user can always prompt again.
      let lockResult: { value: void } | { reason: string };
      let generationStarted = false;
      try {
        lockResult = await this.generationLock.run(`generate:${actualPrompt.slice(0, 60)}`, async () => {
          this.generationBranchId = this.getConnectionBranch(connection);
          const epoch = this.writeEpoch.begin();
          if (!plannerMode) {
            try { this.saveCheckpoint('Before agent changes'); }
            catch { console.warn('Automatic source checkpoint could not be saved'); }
            this.prepareManagedApp(connection, actualPrompt, executionTarget, epoch);
          }
          const contextLimits = generationContextLimits(generationControls(data).fastMode);

          // State awareness: determine whether the project has real (non-starter) content.
          // Check all files, not just App.tsx — a backend-heavy project may have
          // worker/index.ts and migrations but a tiny or missing App.tsx.
          const existingAppRow = this.runSql<{ content: string }>`SELECT content FROM project_files WHERE path = '/src/App.tsx' OR path = '/src/App.jsx' LIMIT 1`[0];
          const hasNonStarterApp = Boolean(existingAppRow && !isStarterApp(existingAppRow.content) && existingAppRow.content.length > 200);
          const hasNonStarterFiles = hasNonStarterApp
            || this.runSql<{ cnt: number }>`SELECT COUNT(*) as cnt FROM project_files WHERE path NOT IN ('/src/App.tsx', '/src/App.jsx', '/src/main.tsx', '/index.html', '/package.json', '/tsconfig.json', '/vite.config.ts', '/src/components/AppBoundary.tsx') AND length(content) > 100`[0]?.cnt > 0;
          const isFreshBuild = !hasNonStarterFiles;
          const isIncrementalEdit = hasNonStarterFiles && !actualPrompt.startsWith('[AUTO-CONTINUE]');

          // Persistent memory summary of active components and backend endpoints
          let projectMemory = '';
          try {
            const allFiles = this.runSql<{ path: string }>`SELECT path FROM project_files`;
            if (allFiles.length > 0) {
              const components = allFiles
                .filter(f => f.path.startsWith('/src/components/'))
                .map(f => f.path.replace('/src/components/', ''));
              const backendFiles = allFiles
                .filter(f => f.path.startsWith('/worker/') || f.path.startsWith('/migrations/'))
                .map(f => f.path);
              const memoryParts: string[] = [];
              if (components.length > 0) memoryParts.push(`- Existing UI Components: ${components.join(', ')}`);
              if (backendFiles.length > 0) memoryParts.push(`- Existing Backend Files: ${backendFiles.join(', ')}`);

              const workerContent = this.runSql<{ content: string }>`SELECT content FROM project_files WHERE path = '/worker/index.ts'`[0]?.content;
              if (workerContent) {
                const routeMatches = [...workerContent.matchAll(/(?:app|router)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/gi)];
                if (routeMatches.length > 0) {
                  const routes = Array.from(new Set(routeMatches.map(m => `${m[1].toUpperCase()} ${m[2]}`))).slice(0, 15);
                  memoryParts.push(`- Known Backend API Endpoints: ${routes.join(', ')}`);
                }
              }
              if (memoryParts.length > 0) {
                projectMemory = `Active Project Architecture & Components:\n${memoryParts.join('\n')}`;
              }
            }
          } catch (e) {
            console.warn('Could not construct project memory summary:', e);
          }

          // Model handoff continuity notice if model was changed
          let modelHandoff = '';
          try {
            const currentModel = String(data.model || DEFAULT_MODEL_ID);
            const prevModelRow = this.runSql<{ model: string }>`SELECT model FROM generation_usage WHERE model IS NOT NULL AND model != '' ORDER BY started_at DESC LIMIT 1`[0];
            if (prevModelRow && prevModelRow.model && prevModelRow.model !== currentModel) {
              modelHandoff = `You are continuing a project that was previously generated with model "${prevModelRow.model}". Now generating with "${currentModel}". Maintain full continuity with existing components, styles, APIs, and conventions. Do NOT rewrite or discard existing working files.`;
            }
          } catch (e) {
            console.warn('Could not check model handoff:', e);
          }

          const filesContext = this.buildFilesContext({
            pinned: new Set(['/src/App.tsx', '/src/App.jsx', '/package.json', '/worker/index.ts', '/brainhalf.verify.json']),
            rank: path => fileContextRank(path, actualPrompt), maxFiles: contextLimits.maxFiles, charBudget: contextLimits.sourceChars,
            header: 'CURRENT PROJECT BASELINE FILES (Inspect these files carefully and build upon them):',
            mentioned: this.getFilesFromPrompt(actualPrompt),
            changed: this.getLastWrittenPaths(),
          });
          const fbApiKey = typeof this.env.FIREBASE_API_KEY === 'string' ? this.env.FIREBASE_API_KEY.trim() : '';
          const firebaseConfig = fbApiKey
            ? {
                apiKey: fbApiKey,
                authDomain: typeof this.env.FIREBASE_AUTH_DOMAIN === 'string' ? this.env.FIREBASE_AUTH_DOMAIN : '',
                projectId: typeof this.env.FIREBASE_PROJECT_ID === 'string' ? this.env.FIREBASE_PROJECT_ID : '',
                storageBucket: typeof this.env.FIREBASE_STORAGE_BUCKET === 'string' ? this.env.FIREBASE_STORAGE_BUCKET : '',
                messagingSenderId: typeof this.env.FIREBASE_MESSAGING_SENDER_ID === 'string' ? this.env.FIREBASE_MESSAGING_SENDER_ID : '',
                appId: typeof this.env.FIREBASE_APP_ID === 'string' ? this.env.FIREBASE_APP_ID : '',
              }
            : undefined;
          const { staticPart, dynamicPart } = this.buildSystemPromptParts({
            filesContext, plannerMode, executionTarget,
            questionMode, destructiveMode, ambiguousMode,
            isIncrementalEdit, isFreshBuild, projectMemory, modelHandoff,
            projectId: this.name,
            firebaseConfig,
          });
          const systemPrompt = staticPart + dynamicPart;
          generationStarted = true;
          return this.runGeneration(connection, data, systemPrompt, actualPrompt, epoch, plannerMode, resumeChain, { destructiveMode, questionMode, ambiguousMode, isIncrementalEdit, isFreshBuild }, staticPart);
        }, GENERATION_LOCK_TIMEOUT_MS, this.currentAbortController ?? undefined);
      } catch (genErr) {
        // runGeneration's finally releases when !completed. If we never reached
        // runGeneration (e.g. prepareManagedApp threw), release here instead.
        if (!generationStarted) this.idempotency.release?.(requestKey);
        throw genErr;
      }

      if (lockResult && 'reason' in lockResult) {
        this.idempotency.release?.(requestKey);
        const busy = JSON.stringify({ type: 'error', error: `A generation is already in progress (${lockResult.reason}). Send 'stop' first.` });
        try { connection.send(busy); } catch (e) { noteSendFailure(e); }
        return;
      }
      return;
    } catch (e) {
      console.error('Error handling message:', e);
      try { connection.send(JSON.stringify({ type: 'error', error: errorMessage(e) || 'Internal error' })); } catch (e) { noteSendFailure(e); }
    }
  }

  /**
   * The single source of truth for the agent's system prompt.
   *
   * FIX: there used to be two near-identical prompts — one assembled in
   * onMessage and a second, separately maintained `tailoredSystemPrompt` inside
   * runCloudflareWorkersAI. The Workers AI path took a `_systemPrompt` argument
   * and threw it away, so PLANNER MODE and the caller's file context never
   * reached that model at all, and the two copies had already drifted (the
   * Workers AI copy carried router and import rules the main one lacked).
   * They are now one function, and the differences that are real — how much
   * file context to include — are handled by the caller's `filesContext`.
   */
  private buildSystemPrompt(opts: {
    filesContext: string;
    plannerMode: boolean;
    executionTarget?: 'managed' | 'export';
    questionMode?: boolean;
    destructiveMode?: boolean;
    ambiguousMode?: boolean;
    isIncrementalEdit?: boolean;
    isFreshBuild?: boolean;
    toolsAvailable?: boolean;
    projectMemory?: string;
    modelHandoff?: string;
  }): string {
    return buildSystemPromptModule(opts);
  }

  private buildSystemPromptParts(opts: {
    filesContext: string;
    plannerMode: boolean;
    executionTarget?: 'managed' | 'export';
    questionMode?: boolean;
    destructiveMode?: boolean;
    ambiguousMode?: boolean;
    isIncrementalEdit?: boolean;
    isFreshBuild?: boolean;
    toolsAvailable?: boolean;
    projectMemory?: string;
    modelHandoff?: string;
    projectId?: string;
    firebaseConfig?: { apiKey: string; authDomain: string; projectId: string; storageBucket: string; messagingSenderId: string; appId: string };
  }): { staticPart: string; dynamicPart: string } {
    return buildSystemPromptPartsModule(opts);
  }

  /**
   * One generation pass, extracted from onMessage so the busy lock and epoch
   * guards wrap it cleanly. History is read *inside* the lock so a generation
   * that waited always sees the freshest conversation, and writes check `epoch`
   * before landing so a superseded generation cannot clobber a newer app.
   */
  private outcomeDelivery?: Promise<void>;
  private async queueProductOutcome(event: OutcomeEvent) {
    try {
      this.runSql`INSERT OR IGNORE INTO product_outbox(id,event) VALUES (${event.id + ':' + event.kind},${JSON.stringify(event)})`;
      // Register recovery before contacting the registry. The outbox survives restarts.
      await this.scheduleEvery(60, 'flushProductOutcomes');
      this.ctx.waitUntil(this.flushProductOutcomes().catch(() => { console.warn('Outcome delivery will retry from the outbox.'); }));
    } catch { console.warn('Product outcome recording unavailable'); }
  }
  async flushProductOutcomes(): Promise<void> {
    if (this.outcomeDelivery) return this.outcomeDelivery;
    if (this.erasing) return;
    const work = (async () => {
      const events = this.runSql`SELECT id,event FROM product_outbox ORDER BY rowid LIMIT 20`;
      for (const row of events) {
        if (this.erasing || !await recordProductOutcome(this.env, JSON.parse(String(row.event)))) return;
        this.runSql`DELETE FROM product_outbox WHERE id=${row.id}`;
      }
      if (!this.runSql`SELECT id FROM product_outbox LIMIT 1`.length) {
        for (const schedule of await this.listSchedules({ type: 'interval' })) {
          if (schedule.callback === 'flushProductOutcomes') await this.cancelSchedule(schedule.id);
        }
      }
    })();
    this.outcomeDelivery = work;
    try { await work; } finally { this.outcomeDelivery = undefined; }
  }

  private async runGeneration(
    connection: Connection,
    data: ClientMessage,
    systemPrompt: string,
    actualPrompt: string,
    epoch: number,
    plannerMode: boolean,
    resumeChain?: { parentJobId: string; resumeCount: number; initialFiles: string[] } | null,
    modes?: { destructiveMode?: boolean; questionMode?: boolean; ambiguousMode?: boolean; isIncrementalEdit?: boolean; isFreshBuild?: boolean },
    staticSystemPart?: string
  ): Promise<void> {
    return this.pipeline.run(connection, data, systemPrompt, actualPrompt, epoch, plannerMode, resumeChain, modes, staticSystemPart);
  }
  private async runCloudflareWorkersAI(...args: Parameters<GenerationPipeline['runCloudflareWorkersAI']>): Promise<{ ok: boolean; repairMarker: string | null }> {
    return this.pipeline.runCloudflareWorkersAI(...args);
  }

  private buildDynamicImportMap(files: Array<{ path: string, content: string }>): string {
    return buildDynamicImportMapModule(files);
  }

  private isLikelyShortNonAppReply(prompt: string, responseText: string): boolean {
    return this.fileExtractor.isLikelyShortNonAppReply(prompt, responseText);
  }

  private handleIncompleteAppGeneration(opts: {
    actualPrompt: string;
    responseText: string;
    extraction: ExtractionSummary;
    connection: Connection;
    expectFiles?: boolean;
    epoch?: number;
    deferTerminal?: (event: () => void) => void;
  }): boolean {
    return this.fileExtractor.handleIncompleteAppGeneration(opts);
  }

  private extractAndSaveFiles(text: string, connection: Connection, epoch?: number, extractOnly = false, defer: (event: () => void) => void = event => event()): ExtractionSummary {
    return this.fileExtractor.extractAndSaveFiles(text, connection, epoch, extractOnly, defer);
  }

  onError(error: unknown) {
    console.error('WebSocket connection error:', error);
  }

  async onRequest(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
      return super.onRequest(request);
    }

    // Fail closed for every HTTP path into this Durable Object.
    if (!getRequestUserId(request)) {
      console.warn('Rejected unauthenticated HTTP request to ChatAgent');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);

    if (url.pathname === '/internal/erase' && request.method === 'POST') {
      const projectId = request.headers.get('x-bh-project');
      if (!projectId || (this.name && this.name !== projectId)) return Response.json({ error: 'Invalid cleanup scope' }, { status: 403 });
      const identity = await getRegistry(this.env).fetch(`https://registry/projects/deletion-owner?projectId=${encodeURIComponent(projectId)}`);
      if (!identity.ok || (await identity.json() as { ownerId?: string }).ownerId !== getRequestUserId(request)) return Response.json({ error: 'Deletion has not been authorized' }, { status: 403 });
      this.erasing = true;
      this.abortGeneration();
      for (const connection of this.getConnections()) { try { connection.close(4404, 'Project deleted'); } catch {} }
      const deadline = Date.now() + 5_000;
      while (this.generationLock.isHeld && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      if (this.generationLock.isHeld) return Response.json({ error: 'Generation is still stopping' }, { status: 503 });
      await Promise.allSettled([...(this.pendingBackups || [])]);
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.connectionUserIds.clear();
      this.previewStore.reset();
      this.previewStoreLoaded = false;
      return Response.json({ ok: true });
    }
    if (this.erasing) return Response.json({ error: 'Project deleted' }, { status: 410 });

    if (url.pathname === '/internal/stop' && request.method === 'POST') {
      // P0-5: defense in depth — the worker already gates this route, but the
      // DO verifies ownership itself, fail-closed like /internal/erase. The
      // worker's stop call carries no x-bh-project header, so fall back to
      // this object's own name (the project id).
      const stopProjectId = request.headers.get('x-bh-project') || this.name;
      const stopUserId = getRequestUserId(request);
      if (!stopProjectId || (this.name && this.name !== stopProjectId)) return Response.json({ error: 'Invalid stop scope' }, { status: 403 });
      if (!stopUserId || !(await isProjectOwner(this.env, stopProjectId, stopUserId))) return Response.json({ error: 'Not the project owner' }, { status: 403 });
      this.abortGeneration();
      const deadline = Date.now() + 5_000;
      while (this.generationLock.isHeld && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      try { this.broadcast(JSON.stringify({ type: 'stopped' })); } catch (e) { noteSendFailure(e); }
      return Response.json({ ok: !this.generationLock.isHeld, stopping: this.generationLock.isHeld }, { status: this.generationLock.isHeld ? 202 : 200 });
    }

    // Gallery remix: the source project serves its files only while it is
    // showcase-listed, and the target accepts them only into a project the
    // requester owns. Secret files never leave the source workspace.
    if (url.pathname === '/internal/remix-export' && request.method === 'GET') {
      const projectId = request.headers.get('x-bh-project');
      if (!projectId || (this.name && this.name !== projectId)) return Response.json({ error: 'Invalid remix scope' }, { status: 403 });
      const listing = await getRegistry(this.env).fetch(`https://registry/projects/showcase-status?projectId=${encodeURIComponent(projectId)}`);
      if (!listing.ok || !(await listing.json() as { showcase?: boolean }).showcase) return Response.json({ error: 'This app is not listed in the gallery' }, { status: 403 });
      this.ensureSchema();
      const all = this.readAllProjectFiles();
      const files: Record<string, string> = Object.create(null);
      for (const [path, content] of Object.entries(all)) if (contextFileAllowed(path) && !this.isHarnessEntry(path)) files[path] = content;
      return Response.json({ files });
    }
    // Operator file inspection: the worker verifies the caller is an operator
    // before proxying here; the agent re-verifies the injected user id against
    // the operator allowlist as defense in depth. Returns the project's files
    // (secret files are filtered by readAllProjectFiles, same as remix export).
    if (url.pathname === '/internal/admin-files' && request.method === 'GET') {
      const projectId = request.headers.get('x-bh-project');
      if (!projectId || (this.name && this.name !== projectId)) return Response.json({ error: 'Invalid scope' }, { status: 403 });
      const userId = getRequestUserId(request);
      const allowlist = String((this.env as Record<string, unknown>).PRODUCT_METRICS_OWNER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
      let operator = !!userId && allowlist.includes(userId);
      // Email fallback matching the worker gate: a recreated owner account has
      // a new userId, so the ID allowlist alone strands operator access.
      if (!operator && userId) {
        const adminEmails = String((this.env as Record<string, unknown>).ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
        if (adminEmails.length) {
          try {
            const owner = await getRegistry(this.env).fetch(`https://registry/admin/managed-owner?ownerId=${encodeURIComponent(userId)}`);
            const data = owner.ok ? await owner.json() as { email?: string } : null;
            operator = !!data?.email && adminEmails.includes(data.email.toLowerCase());
          } catch { /* fail closed */ }
        }
      }
      // Allow the verified project owner through alongside operators so that
      // the export-zip endpoint (which already checked isProjectOwner in the
      // worker) can fetch files from the DO.
      const isOwner = !!userId && this.name === projectId;
      if (!operator && !isOwner) return Response.json({ error: 'Not an operator' }, { status: 403 });
      this.ensureSchema();
      const all = this.readAllProjectFiles();
      const files: Record<string, string> = Object.create(null);
      for (const [path, content] of Object.entries(all)) if (!this.isHarnessEntry(path)) files[path] = content;
      return Response.json({ files });
    }
    if (url.pathname === '/internal/remix-import' && request.method === 'POST') {
      const projectId = request.headers.get('x-bh-project');
      if (!projectId || (this.name && this.name !== projectId)) return Response.json({ error: 'Invalid remix scope' }, { status: 403 });
      const userId = getRequestUserId(request);
      if (!userId || !(await isProjectOwner(this.env, projectId, userId))) return Response.json({ error: 'Not the project owner' }, { status: 403 });
      if (this.erasing) return Response.json({ error: 'Project deleted' }, { status: 410 });
      if (this.generationLock.isHeld || this.currentAbortController) return Response.json({ error: 'Wait for generation to finish before remixing.' }, { status: 409 });
      this.ensureSchema();
      const body = await readJson(request, 16 * 1024 * 1024) as { files?: unknown };
      if (!body || typeof body !== 'object' || !body.files || typeof body.files !== 'object' || Array.isArray(body.files)) return Response.json({ error: 'Invalid remix files' }, { status: 400 });
      try {
        this.transact(() => {
          for (const { path } of this.runSql`SELECT path FROM project_files`) if (contextFileAllowed(path) && !this.isHarnessEntry(path)) this.runSql`DELETE FROM project_files WHERE path=${path}`;
          for (const [path, content] of Object.entries(body.files as Record<string, unknown>)) {
            if (typeof content !== 'string' || !contextFileAllowed(path) || this.isHarnessEntry(path)) continue;
            if (!this.upsertFile(normalizePath(path), content)) throw new Error('Remix exceeds the project file limit.');
          }
        });
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Remix import failed.' }, { status: 413 }); }
      this.broadcast(JSON.stringify({ type: 'files_changed' }));
      await this.backupToR2(userId);
      return Response.json({ ok: true, revision: this.getFilesRevision() });
    }

    if (url.pathname.match(/^\/(?:preview|p)\/[^/]+$/)) {
      return Response.redirect(`${url.origin}${url.pathname}/`, 301);
    }

    const corsHeaders: Record<string, string> = (() => {
      // Reflect the caller's origin only when it is the same origin or a
      // localhost dev origin. A blanket `*` would let any website read project
      // source and POST to /api/sync.
      const origin = safeOrigin(request.headers.get('origin'));
      const sameOrigin = origin != null && origin === url.origin;
      const isDevOrigin = this.env?.IS_DEV === 'true' && origin != null && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      const allow = sameOrigin || isDevOrigin ? (origin as string) : url.origin;
      return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Credentials': 'true',
        'Vary': 'Origin',
        // FIX: POST was missing even though /api/sync and the generated app's own
        // POST/PUT/DELETE routes are served here, so any cross-origin preflight
        // for them was rejected.
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cross-Origin-Resource-Policy': 'same-origin',
        // Preview content is model-generated, so the CSP is the real boundary
        // around it: remote scripts load only from the two CDNs the preview
        // bootstrap uses, and no other origin may frame it. 'unsafe-inline' is
        // required by the server-rendered bootstrap; 'unsafe-eval' is present
        // because generated apps transpile and evaluate module sources at
        // runtime. Eval cannot load a cross-origin resource, so granting it does
        // not reopen the boundary this policy draws.
        'Content-Security-Policy': [
          `default-src 'self'`,
          `script-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh https://*.esm.sh https://cdn.jsdelivr.net https://static.cloudflareinsights.com`,
          `style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com`,
          `img-src 'self' data: https:`,
          `font-src 'self' data: https://fonts.gstatic.com`,
          `connect-src 'self' https://cdn.jsdelivr.net`,
          `frame-ancestors 'self' https://brainhalf.com${isDevOrigin ? ' http://localhost:* http://127.0.0.1:*' : ''}`,
          `base-uri 'self'`,
          `form-action 'self'`,
        ].join('; '),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      };
    })();

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    const builderPath = url.pathname.match(/^\/agents\/chat-agent\/[^/]+\/builder(\/.*)$/)?.[1];
    if (builderPath) {
      // P0-5: builder mutations run against this project's storage — verify
      // ownership inside the DO (fail closed like /internal/remix-import),
      // not only at the worker gate.
      const builderUserId = getRequestUserId(request);
      const builderProjectId = url.pathname.match(/^\/agents\/chat-agent\/([^/]+)/)?.[1];
      if (!builderUserId || !builderProjectId || builderProjectId !== this.name || !(await isProjectOwner(this.env, builderProjectId, builderUserId))) {
        return Response.json({ error: 'Not the project owner' }, { status: 403, headers: corsHeaders });
      }
      const bucket = request.method === 'POST' && (builderPath === '/servers' ? 'builderDiscovery' : builderPath === '/attachments' ? 'builderUpload' : '');
      if (bucket) {
        const rate = GENERATION_LIMITER.check(bucket, getRequestUserId(request)!);
        if (!rate.ok) return Response.json({ error: `Too many requests. Try again in ${rate.retryAfter} seconds.` }, { status: 429, headers: { ...corsHeaders, 'Retry-After': String(rate.retryAfter), 'Cache-Control': 'no-store' } });
      }
      this.ensureSchema();
      const response = await this.builderService(getRequestUserId(request)!).handle(request, builderPath);
      for (const [key, value] of Object.entries(corsHeaders)) response.headers.set(key, value);
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    if (/^\/agents\/chat-agent\/[^/]+\/usage$/.test(url.pathname) && request.method === 'GET') {
      this.ensureSchema();
      // P0-5: usage rows are per-project metering — verify ownership inside
      // the DO, not only at the worker gate.
      const usageUserId = getRequestUserId(request);
      const usageProjectId = url.pathname.match(/^\/agents\/chat-agent\/([^/]+)/)?.[1];
      if (!usageUserId || !usageProjectId || usageProjectId !== this.name || !(await isProjectOwner(this.env, usageProjectId, usageUserId))) {
        return Response.json({ error: 'Not the project owner' }, { status: 403, headers: corsHeaders });
      }
      const generations = this.runSql`SELECT model,started_at,finished_at,status,input_tokens,output_tokens,source_revision,first_response_at,provider_calls,prompt_category,files_written,retry_count,repair_types,generation_ms,extraction_ms,checks_ms,edit_chars,rewrite_chars,cache_read_tokens,cache_write_tokens FROM generation_usage ORDER BY started_at DESC LIMIT 20`;
      const models = MODEL_ALLOWLIST.filter(m => m.clientSelectable !== false).map(m => ({ name: m.name, provider: m.provider, supportsPromptCaching: m.supportsPromptCaching ?? false }));
      return Response.json({ generations, models }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
    }

    // Purgeable-draft check: has this project ever received a real user message?
    // Called by purgeEmptyDrafts before soft-deleting an apparent blank draft.
    if (/^\/agents\/chat-agent\/[^/]+\/is-empty$/.test(url.pathname) && request.method === 'GET') {
      this.ensureSchema();
      const isEmptyUserId = getRequestUserId(request);
      const isEmptyProjectId = url.pathname.match(/^\/agents\/chat-agent\/([^/]+)/)?.[1];
      if (!isEmptyUserId || !isEmptyProjectId || isEmptyProjectId !== this.name || !(await isProjectOwner(this.env, isEmptyProjectId, isEmptyUserId))) {
        return Response.json({ error: 'Not the project owner' }, { status: 403, headers: corsHeaders });
      }
      const userMsgCount = Number([...this.sql`SELECT COUNT(*) as n FROM messages WHERE role = 'user'`][0]?.n ?? 0);
      const realUserMsgs = [...this.sql`SELECT content FROM messages WHERE role = 'user' LIMIT 20`]
        .filter(r => !isSystemContinuation(String(r.content || ''))).length;
      const fileCount = Number([...this.sql`SELECT COUNT(*) as n FROM project_files`][0]?.n ?? 0);
      return Response.json({ empty: realUserMsgs === 0, userMessageCount: userMsgCount, realUserMessageCount: realUserMsgs, fileCount }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
    }

    // Full project snapshot for initial client load: files + recent messages.
    // Used as a server-authoritative fallback when the client's IndexedDB is cold
    // (new device, cleared browser storage, first load after account switch).
    if (/^\/agents\/chat-agent\/[^/]+\/snapshot$/.test(url.pathname) && request.method === 'GET') {
      this.ensureSchema();
      const snapshotUserId = getRequestUserId(request);
      const snapshotProjectId = url.pathname.match(/^\/agents\/chat-agent\/([^/]+)/)?.[1];
      if (!snapshotUserId || !snapshotProjectId || snapshotProjectId !== this.name || !(await isProjectOwner(this.env, snapshotProjectId, snapshotUserId))) {
        return Response.json({ error: 'Not the project owner' }, { status: 403, headers: corsHeaders });
      }
      try {
        const files = this.readAllProjectFiles();
        const branchId = 'main';
        const msgRows = [...this.sql`SELECT role, content FROM messages WHERE branch_id = ${branchId} ORDER BY id DESC LIMIT 50`].reverse();
        const messages = msgRows.map(row => ({
          role: row.role === 'assistant' ? 'ai' : row.role,
          content: typeof row.content === 'string' ? (row.role === 'assistant' ? formatToolTranscript(row.content) : row.content) : '',
          internal: row.role === 'user' && isSystemContinuation(String(row.content || '')),
        }));
        return Response.json({ files, messages, fileCount: Object.keys(files).length, messageCount: messages.length, revision: this.getFilesRevision() }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
      } catch {
        return Response.json({ error: 'Snapshot unavailable' }, { status: 503, headers: corsHeaders });
      }
    }

    // Source controls are available only through the authenticated agent route,
    // never through a public preview's /api namespace.
    if (/^\/agents\/chat-agent\/[^/]+\/checkpoints(?:\/|$)/.test(url.pathname)) {
      this.ensureSchema();
      // P0-5: checkpoint restore deletes every project file — verify ownership
      // inside the DO (fail closed), not only at the worker gate.
      const checkpointUserId = getRequestUserId(request);
      const checkpointProjectId = url.pathname.match(/^\/agents\/chat-agent\/([^/]+)/)?.[1];
      if (!checkpointUserId || !checkpointProjectId || checkpointProjectId !== this.name || !(await isProjectOwner(this.env, checkpointProjectId, checkpointUserId))) {
        return Response.json({ error: 'Not the project owner' }, { status: 403, headers: corsHeaders });
      }
      try {
        const history = this.sourceHistory(); const id = url.searchParams.get('id');
        if (request.method === 'GET') return Response.json(id
          ? { revision: this.getFilesRevision(), changes: sourceChanges(this.readAllProjectFiles(), history.files(id)) }
          : { revision: this.getFilesRevision(), checkpoints: history.list() }, { headers: corsHeaders });
        if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers: corsHeaders });
        const body = await readJson(request, 2048) as { label?: string; revision?: number; id?: string };
        if (this.generationLock.isHeld || this.currentAbortController) return Response.json({ error: 'Wait for generation to finish before changing checkpoints.' }, { status: 409, headers: corsHeaders });
        if (body.revision !== this.getFilesRevision()) return Response.json({ error: 'Source changed. Refresh and review the current files first.' }, { status: 409, headers: corsHeaders });
        if (url.pathname.endsWith('/restore')) {
          if (typeof body.id !== 'string') throw new Error('Choose a checkpoint.');
          const saved = history.files(body.id);
          this.transact(() => {
            history.save(this.readAllProjectFiles(), this.getFilesRevision(), 'Before restore');
            for (const { path } of this.runSql`SELECT path FROM project_files`) if (contextFileAllowed(path) && !this.isHarnessEntry(path)) this.runSql`DELETE FROM project_files WHERE path=${path}`;
            for (const [path, content] of Object.entries(saved)) if (contextFileAllowed(path) && !this.isHarnessEntry(path)) this.upsertFile(path, content);
          });
          this.broadcast(JSON.stringify({ type: 'files_changed' }));
          await this.backupToR2(getRequestUserId(request) || undefined);
          return Response.json({ ok: true, revision: this.getFilesRevision() }, { headers: corsHeaders });
        }
        const checkpoint = this.saveCheckpoint(typeof body.label === 'string' ? body.label : 'Saved checkpoint');
        return Response.json({ checkpoint }, { status: 201, headers: corsHeaders });
      } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Checkpoint action failed.' }, { status: 400, headers: corsHeaders }); }
    }

    if (url.pathname.includes('/preview/') || url.pathname.includes('/p/')) {
      const pathMatch = url.pathname.match(/^\/(?:preview|p)\/[^/]+(.*)$/);
      let path = pathMatch ? pathMatch[1] : url.pathname;
      if (path === '' || path === '/') path = '/index.html';
      const publicRead = request.headers.get(PREVIEW_ACCESS_HEADER) === 'public';
      if (publicRead && ((request.method !== 'GET' && request.method !== 'HEAD') || !isPublicPreviewRead(path))) {
        return new Response('Forbidden', { status: 403, headers: corsHeaders });
      }

      this.ensureSchema();
      this.seedStarterIfEmpty();

      if (request.method === 'POST' && path.endsWith('/api/sync')) {
        try {
          const body = await request.json() as { files?: unknown } | null;
          if (body?.files && typeof body.files === 'object') {
            const bodyFiles = body.files;
            let count = 0;
            this.transact(() => {
              for (const [fPath, fContent] of Object.entries(bodyFiles)) {
                if (typeof fContent !== 'string') continue;
                const cleanPath = normalizePath(fPath);
                if (this.isHarnessEntry(cleanPath)) continue;
                if (this.upsertFile(cleanPath, fContent)) count++;
              }
            });
            return new Response(JSON.stringify({ success: true, count }), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
          return new Response(JSON.stringify({ success: false, error: 'Expected a "files" object' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: errorMessage(e) }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

      if (path.endsWith('/api/files')) {
        // readAllProjectFiles() filters secret files at the source. This route
        // was the leak: it returned /server/.env, containing the JWT_SECRET and
        // DATABASE_URL the system prompt tells generated apps to put there.
        const allFiles = this.readAllProjectFiles();
        return new Response(JSON.stringify(allFiles, null, 2), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (path.startsWith('/api/')) {
        const manifest = this.runSql`SELECT content FROM project_files WHERE path = ${'/package.json'}`[0]?.content;
        if (!usesSimulatedApi({ '/package.json': typeof manifest === 'string' ? manifest : '{}' })) {
          return Response.json({ error: BACKEND_NOT_RUNNING, code: 'BACKEND_NOT_RUNNING' }, { status: 501, headers: corsHeaders });
        }
        // Only `/server/*` is handed to the simulated backend (see
        // readServerFilesForBackend): it parses /server/.env for process.env and
        // validates the server sources, and needs nothing else.
        const allFiles = this.readServerFilesForBackend();

        let bodyData: unknown = null;
        if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
          try { bodyData = await request.json(); } catch { /* body optional */ }
        }

        // Restore persisted preview data on first request after a DO wake.
        this.hydratePreviewStore();
        const headersObj = selectForwardableHeaders(request.headers, this.previewStore);

        let previewResponse: Response;
        try {
          const backendRes = await executeBackendRequest(allFiles, {
            method: request.method,
            url: request.url,
            headers: headersObj,
            body: bodyData
          }, this.previewStore);

          previewResponse = new Response(JSON.stringify(backendRes.body), {
            status: backendRes.status,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              ...(backendRes.headers || {})
            }
          });
        } catch (e) {
          // FIX: a throw from the generated backend escaped this handler and
          // surfaced as an opaque 500 with no layer attribution, so the preview
          // could not tell the user which side failed.
          previewResponse = new Response(JSON.stringify({
            layer: 'backend',
            error: errorMessage(e) || 'Backend execution failed',
            file: 'server/index.js'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        // Persist after every mutating request. GET/HEAD/OPTIONS cannot change
        // store state, so they skip the write entirely.
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) {
          this.persistPreviewStore();
        }
        return applyPreviewCappedHeader(previewResponse, this.previewStoreCapped);
      }

      if (path === '/index.html') {
        const allFiles = this.readAllProjectFiles();
        const html = isolatedPreviewHtml(this.name, previewFiles(allFiles, !publicRead));
        return new Response(html, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
      }

      try {
        const cleanPath = normalizePath(path);

        // Secrets stored by generated apps (e.g. /server/.env) must never be
        // served from a preview, even to the project owner. Checked before any
        // lookup so no code path below can bypass it.
        if (isBlockedSecretFile(cleanPath)) {
          return new Response('Not found', { status: 404, headers: corsHeaders });
        }

        if (this.isHarnessEntry(cleanPath)) {
          const entryFiles = this.runSql`SELECT path, content FROM project_files
            WHERE path LIKE '%/App.%' OR path LIKE '%/main.%' OR path LIKE 'App.%' OR path LIKE 'main.%'`;
          const entry = selectAppEntry(Object.fromEntries(entryFiles.filter(file => !publicRead || isPublicPreviewFile(String(file.path))).map(file => [String(file.path), String(file.content)]))) || '/src/App.jsx';
          const harnessCode = buildHarnessModuleSrc(relativeProjectImport(cleanPath, entry));
          const transpiledHarness = transform(harnessCode, { transforms: ['typescript', 'jsx'] }).code;
          return new Response(transpiledHarness, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-cache, no-store'
            }
          });
        }

        const strippedPath = cleanPath.replace(/^\//, '');
        const srcPrefixed = cleanPath.startsWith('/src/') ? cleanPath : '/src' + cleanPath;
        const srcStripped = cleanPath.startsWith('/src/') ? cleanPath.replace('/src/', '/') : cleanPath;

        let rows = [...this.sql`SELECT path, content FROM project_files
          WHERE path = ${cleanPath}
             OR path = ${srcPrefixed}
             OR path = ${srcStripped}
             OR path = ${strippedPath}
             OR path = ${'src/' + strippedPath}`].filter(file => !publicRead || isPublicPreviewFile(String(file.path)));

        if (rows.length === 0) {
          // The old fallback was `path LIKE '%' || ? ESCAPE '\'`, a
          // leading-wildcard LIKE that cannot use the path index and scanned
          // every row on every preview request. This asks for the exact
          // candidate paths a generated app would use, in one indexed query.
          const filename = cleanPath.split('/').pop() || '';
          if (filename) {
            const rawBase = filename.replace(/\.[^.]+$/, '');
            const candidatePaths = new Set<string>();
            for (const dir of ['', '/src', '/src/components', '/src/pages', '/src/context', '/src/lib', '/src/hooks', '/src/utils']) {
              for (const ext of ['', '.jsx', '.tsx', '.js', '.ts', '.json', '.css']) {
                const baseName = ext ? rawBase + ext : filename;
                candidatePaths.add(`${dir}/${baseName}`);
              }
            }
            const allowedCandidates = [...candidatePaths].filter(candidate => !publicRead || isPublicPreviewFile(candidate));
            const found = this.runSql`SELECT content FROM project_files
              WHERE path IN (SELECT value FROM json_each(${JSON.stringify(allowedCandidates)})) LIMIT 1`;
            if (found.length > 0) rows = found;
          }
        }

        if (rows.length === 0 && cleanPath.endsWith('.css')) {
          const secFetchDest = request.headers.get('Sec-Fetch-Dest');
          const acceptHeader = request.headers.get('Accept') || '';
          const isModuleImport = secFetchDest === 'script' || (!acceptHeader.includes('text/css') && acceptHeader.includes('*/*'));

          if (isModuleImport) {
            return new Response('export default "";', {
              headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }
            });
          }
          return new Response('/* edge preview styles */', {
            headers: { ...corsHeaders, 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' }
          });
        }

        if (rows.length > 0) {
          let content = rows[0].content as string;

          if (/\.(jsx|tsx|ts|js)$/.test(path)) {
            try {
              content = this.prepareModuleSource(content, cleanPath, path);
            } catch (transpileErr) {
              return new Response(this.buildTranspileErrorModule(path, errorMessage(transpileErr) || 'Syntax or transpilation error'), {
                headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8' }
              });
            }

            return new Response(content, {
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache, no-store'
              }
            });
          }

          if (path.endsWith('.css')) {
            const secFetchDest = request.headers.get('Sec-Fetch-Dest');
            const acceptHeader = request.headers.get('Accept') || '';
            const isModuleImport = secFetchDest === 'script' || (!acceptHeader.includes('text/css') && acceptHeader.includes('*/*'));

            if (isModuleImport) {
              const jsModule = buildCssJsModule(cleanPath, content);
              return new Response(jsModule, {
                headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache, no-store' }
              });
            }

            return new Response(content, {
              headers: { ...corsHeaders, 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache, no-store' }
            });
          }

          if (path.endsWith('.json')) {
            return new Response(content, {
              headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-store' }
            });
          }

          return new Response(content, {
            headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache, no-store' }
          });
        }
      } catch (e) {
        console.error('Error querying file in Edge Preview:', path, e);
      }

      const cleanPathForFallback = normalizePath(path);
      if (/\/(App)\.(jsx|tsx|js|ts)$/i.test(cleanPathForFallback)) {
        try {
          const starterApp = this.prepareModuleSource(STARTER_APP_JSX, '/src/App.jsx', path);
          return new Response(starterApp, {
            headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache, no-store' }
          });
        } catch (e) { console.warn('Starter App fallback failed:', e); }
      }
      if (/\/(main|index)\.(jsx|tsx|js|ts)$/i.test(cleanPathForFallback)) {
        try {
          const starterMain = this.prepareModuleSource(STARTER_MAIN_JSX, '/src/main.jsx', path);
          return new Response(starterMain, {
            headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache, no-store' }
          });
        } catch (e) { console.warn('Starter main fallback failed:', e); }
      }
      if (/\.(jsx|tsx|js|ts)$/.test(cleanPathForFallback) || !/\.[a-zA-Z0-9]+$/.test(cleanPathForFallback)) {
        const stubCode = buildMissingComponentStub(cleanPathForFallback);
        const transpiledStub = transform(stubCode, { transforms: ['typescript', 'jsx'] }).code;
        return new Response(transpiledStub, {
          headers: { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache, no-store' }
        });
      }

      return new Response('404 Not Found in Edge Preview', {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });
    }

    return new Response('BrainHalf Agent Backend is running. Please connect via WebSocket.', {
      status: 200,
      headers: {
        // Never a wildcard: this object is only reachable through the Worker,
        // which has already applied the origin allowlist.
        'Access-Control-Allow-Origin': url.origin,
        'Content-Type': 'text/plain'
      }
    });
  }

  /**
   * Cleans, heals, and transpiles one module before it is served to the preview.
   *
   * Extracted from onRequest, where it was ~200 lines inline inside a try block
   * nested four levels deep. Behaviour is unchanged apart from the fixes noted
   * in the steps below.
   */
  private prepareModuleSource(raw: string, cleanPath: string, path: string): string {
    return prepareModuleSource(raw, cleanPath, path, (paths) =>
      this.runSql`SELECT 1 FROM project_files WHERE path IN (SELECT value FROM json_each(${JSON.stringify(paths)})) LIMIT 1`.length > 0
    );
  }

  private buildTranspileErrorModule(path: string, errMsg: string): string {
    return buildTranspileErrorModule(path, errMsg);
  }
}

