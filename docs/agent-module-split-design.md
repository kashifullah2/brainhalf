# ChatAgent Module Split — Design Document

**Status:** Proposal (planning only — no implementation)
**Scope:** `src/agent.ts` (~5500 lines) → 3 extracted modules + thin coordinator

---

## 1. Proposed Module Boundaries

### 1A. `src/lib/file-extractor.ts` — FileExtractor

Owns: parsing `<file>`/`<edit>`/`<delete>` blocks from model output, syntax validation, bracket repair, persistence of extracted files.

**Moves from agent.ts:**
- `extractAndSaveFiles()` (~lines 4410–4850)
- `cleanCodeBlock()` (~4317–4325)
- `repairUnclosedBrackets()` (~4340–4376)
- `collectFileWrites()` (helper called by extraction)
- `missingFileCandidates()` (drives completeness repair input)
- `isLikelyShortNonAppReply()` (~4378–4388)
- `handleIncompleteAppGeneration()` (~4394–4500+)

**Interface exposed:**
```
class FileExtractor {
  constructor(ctx: FileExtractorContext)
  extractAndSaveFiles(output: string, opts: ExtractionOpts): ExtractionSummary
  missingFileCandidates(allFiles: Map<string, string>, output: string): string[]
  isLikelyShortNonAppReply(prompt: string, response: string): boolean
  handleIncompleteAppGeneration(opts: IncompleteOpts): boolean
}
```

**Needs from ChatAgent (injected via context):**
- `runSql` — read/write `project_files`
- `transact` — atomic multi-file writes
- `upsertFile` — single-file persistence + broadcast
- `writeEpoch` — stale-generation guard
- `activeGeneration` — read-only (`.epoch`, `.filesChanged`)
- `isHarnessEntry` — harness file detection
- `name` — project ID for logging
- `flipFlopGuard`, `repairLog` — repair budget tracking (passed in, not owned)
- `truncationRetries`, `syntaxRepairAttempts` — read/write for extraction-time repair counting
- `persistRepairCounters()` — hibernation persistence callback

### 1B. `src/lib/generation-pipeline.ts` — GenerationPipeline

Owns: generation orchestration, retry logic, repair sequencing, kill-switch checks, hibernation state persistence, budget lifecycle.

**Moves from agent.ts:**
- `runGeneration()` (~lines 2400–3926) — the full generation pipeline
- `runCloudflareWorkersAI()` (~3928–4315) — CF Workers AI path
- All repair check functions (~1400–1660): `checkFinalCompleteness`, `checkMissingAppEntry`, `checkNoPhantomAuthHooks`, `checkVerificationPlanFile`, `checkApiRouteCoverage`
- `resetRepairCounters()` (~490–498)
- Hibernation persistence methods: `persistActiveGeneration`, `persistRepairCounters`, `clearActiveGenerationState`, `recoverOrphanedGeneration` (~501–534)
- `resolveCompletenessRepair`, `noteRepairQueued` (~1695–1740)
- Kill-switch resolution closure (`getKillSwitchStatus`, `getDisabledMsg`)
- `generationJobs()` helper

**Interface exposed:**
```
class GenerationPipeline {
  constructor(ctx: GenerationContext)
  run(data: GenerationInput, connection: Connection, epoch: number): Promise<GenerationResult>
  recoverOrphanedGeneration(): void
  readonly isRunning: boolean
}
```

**Needs from ChatAgent (injected via context):**
- `runSql`, `transact` — DO SQLite access
- `ctx.storage`, `ctx.waitUntil` — DO storage and lifecycle
- `env` — REGISTRY binding, AI binding, secrets
- `writeEpoch`, `generationLock`, `idempotency` — concurrency primitives (owned by ChatAgent, shared read/write)
- `connectionUserIds` — maps connection to user (read-only)
- `broadcast()` — fan-out to other connections
- `FileExtractor` instance — for extraction after streaming
- `upsertFile`, `readAllProjectFiles` — file access
- `saveCheckpoint`, `backupToR2` — persistence after generation
- Various `connection.send` calls — streaming to the originating client

### 1C. `src/lib/agent-tools.ts` — AgentToolHandlers

Owns: tool definitions (write_file, edit_file, read_file, list_files, search_files, check_syntax, delete_file, rename_file, batch_edit, call_cloudflare_model) and their execution logic.

**Moves from agent.ts:**
- Tool handler closures (~lines 2780–3200)
- `saveToolFile` local helper
- Tool-specific validation (path checks, size limits)

**Interface exposed:**
```
function createToolHandlers(ctx: ToolContext): Record<string, ToolHandler>
```
A factory function, not a class — tools are stateless closures over a context, matching the current pattern. Returns the same tool-definition objects the Vercel AI SDK consumes.

**Needs from ChatAgent (injected via context):**
- `runSql` — file reads (read_file, list_files, search_files)
- `writeEpoch` — stale-generation guard
- `upsertFile` — file persistence
- `activeGeneration` — read `.epoch`, set `.filesChanged`
- `activeJobId` — mark file completions on generation_jobs
- `isHarnessEntry` — harness detection
- `backupToR2` — checkpoint after writes
- `broadcast` — notify other connections
- `connection` + `epoch` + `abortController` — passed per-invocation from pipeline
- `accounting` — token tracking
- `inspectedFiles`, `toolWrittenPaths` — per-generation local maps (stay in pipeline, passed in)

### 1D. ChatAgent remains as thin coordinator

After extraction, ChatAgent (~1500–2000 lines) retains:
- DO lifecycle: `constructor`, `onStart`, `onConnect`, `onClose`, `onMessage`, `onRequest`
- WebSocket connection management, auth, message dispatch
- DO-level state ownership: `ctx.storage`, `sql`, `writeEpoch`, `generationLock`, `idempotency`, `connectionUserIds`, `previewStore`
- Schema initialization, migrations, R2 backup/restore
- Preview serving (`onRequest` handlers)
- Instantiation and wiring of the three extracted modules

---

## 2. Shared State Problem

### Recommended approach: ChatAgent as coordinator, modules receive a context interface

ChatAgent owns all DO-level state and passes a typed context object to each module at construction (or per-call for generation). Modules never hold a reference to `ChatAgent` itself — they hold a narrow interface with only the methods/properties they need.

```typescript
interface DOContext {
  runSql<R>(strings: TemplateStringsArray, ...values: any[]): R[];
  transact<R>(fn: () => R): R;
  env: ChatAgentEnv;
  ctx: DurableObjectState;
}

interface FileExtractorContext extends DOContext {
  writeEpoch: WriteEpoch;
  upsertFile(path: string, content: string, epoch: number): void;
  isHarnessEntry(path: string): boolean;
  projectName: string;
}

interface GenerationContext extends DOContext {
  writeEpoch: WriteEpoch;
  generationLock: BusyLock;
  idempotency: IdempotencyStore;
  // ... etc
}
```

**Why this approach over alternatives:**

- **DI via constructor** (the chosen approach): Each module declares its dependencies explicitly. Testable — tests construct the context with mocks (the existing `Object.create(ChatAgent.prototype)` + `any`-cast pattern in tests is already doing this informally). No circular references.

- **Rejected: shared singleton context object** — A single `AgentContext` bag that all modules share would technically work, but it hides which module needs what. Any module could reach into any state, defeating the split's purpose. The current 5500-line class IS a shared context bag.

- **Rejected: modules hold `this: ChatAgent` reference** — Circular dependency risk, and the module can access anything on the class, providing no encapsulation.

**Cloudflare DO constraint alignment:**
- All context interface fields are either DO-provided (`ctx.storage`, `sql`) or instance variables that reset on hibernation. The modules don't cache anything the DO wouldn't — they receive fresh context on construction, which happens on every DO wake.
- No module-level mutable state. Each module instance is scoped to a single DO instance's lifetime (constructor to hibernation).

---

## 3. Hibernation-Safety Impact

The hibernation persistence methods (`persistActiveGeneration`, `persistRepairCounters`, `clearActiveGenerationState`, `recoverOrphanedGeneration`) currently live in agent.ts and touch generation-pipeline state exclusively:

| Method | State it accesses |
|---|---|
| `persistActiveGeneration` | repair counters, turnSavedForEpoch, accounting/budget IDs |
| `persistRepairCounters` | all 7 repair counters, turnSavedForEpoch |
| `clearActiveGenerationState` | none (DELETE query) |
| `recoverOrphanedGeneration` | activeGeneration (null check), generation_usage table, budget endpoint |

**All four methods move into `GenerationPipeline`.** This is the module that owns repair counters, turnSavedForEpoch, and the generation lifecycle — exactly the state these methods persist and recover. No hibernation logic ends up split across modules.

The call sites stay cohesive:
- `persistActiveGeneration` — called at generation start (inside `run()`)
- `persistRepairCounters` — called at every repair counter increment (inside repair checks and extraction, both called from `run()`)
- `clearActiveGenerationState` — called in the finally block (inside `run()`)
- `recoverOrphanedGeneration` — called from ChatAgent's `sendHistoryMessage` on connect, which delegates to `pipeline.recoverOrphanedGeneration()`

The one cross-module touch: `FileExtractor.extractAndSaveFiles` increments `truncationRetries` and `syntaxRepairAttempts`, then calls `persistRepairCounters`. In the split, the extractor modifies counters on the context object (which is the pipeline's state), and the pipeline provides a `persistRepairCounters` callback. The repair counters and their persistence stay owned by GenerationPipeline; the extractor merely invokes the callback.

---

## 4. Migration Strategy

### Order: FileExtractor → AgentToolHandlers → GenerationPipeline

Each step compiles, passes all 1840 tests, and is a single reviewable PR.

#### Step 1: Extract FileExtractor (lowest risk)

**Why first:** Fewest cross-cutting dependencies. `extractAndSaveFiles` is called from exactly 2 places (end of runGeneration streaming, end of runCloudflareWorkersAI streaming). It doesn't call back into generation orchestration. Its `this.` dependencies are narrow and well-defined (see 1A above).

**Execution:**
1. Create `src/lib/file-extractor.ts` with `FileExtractorContext` interface
2. Move the 6 methods listed in 1A
3. In ChatAgent, instantiate `FileExtractor` and replace `this.extractAndSaveFiles(...)` calls with `this.fileExtractor.extractAndSaveFiles(...)`
4. ChatAgent still owns repair counters — passes them via context. The extractor reads/writes them on the context and calls `ctx.persistRepairCounters()`.

**Test impact:** 4 test files access `extractAndSaveFiles` directly:
- `agent-write-guards.test.ts`
- `generation-pipeline-fixes.test.ts`
- `edit-tool.test.ts`
- `agent-tools-wiring.test.ts`

These construct mock agents via `Object.create(ChatAgent.prototype)`. After extraction, `extractAndSaveFiles` is no longer on the prototype — the tests need to either (a) set `agent.fileExtractor = new FileExtractor(mockCtx)` or (b) keep a thin delegating method on ChatAgent during migration. Option (b) is safer for incremental migration: the prototype method stays but delegates to the extractor.

#### Step 2: Extract AgentToolHandlers (medium risk)

**Why second:** Tools are defined as closures inside `runGeneration`, but they're a discrete concern — their definitions don't interleave with orchestration logic. The main risk is that they close over ~10 local variables from `runGeneration`'s scope.

**Execution:**
1. Create `src/lib/agent-tools.ts` with `createToolHandlers(ctx)` factory
2. Move tool definitions out of the `runGeneration` closure
3. The factory receives a per-generation context (connection, epoch, abortController, accounting, inspectedFiles, toolWrittenPaths, plus DO-level context)
4. `runGeneration` calls `createToolHandlers(...)` where it currently defines tools inline

**Test impact:** 2 test files directly test tool wiring:
- `agent-tools-wiring.test.ts` — tests tool definitions exist
- `edit-tool.test.ts` — tests edit behavior

Both access tools indirectly via `extractAndSaveFiles` and `runGeneration` mocks. Mock path changes are minimal: the factory function is a plain export, easier to mock than a class method.

#### Step 3: Extract GenerationPipeline (highest risk)

**Why last:** This is the 1500-line core with the most cross-cutting state dependencies (7 cross-cutting variables touch it). It must move after tools and extraction are already out, reducing its footprint.

**Execution:**
1. Create `src/lib/generation-pipeline.ts` with `GenerationContext` interface
2. Move `runGeneration`, `runCloudflareWorkersAI`, repair checks, hibernation persistence
3. ChatAgent's `onMessage` dispatches to `this.pipeline.run(...)` instead of `this.runGeneration(...)`
4. Pipeline receives FileExtractor and tool factory as dependencies

**Test impact:** Highest churn — 6+ test files:
- `agent-generation-runtime.test.ts` (heaviest: end-to-end generation testing)
- `agent-resume-lifecycle.test.ts`
- `stale-active-job-id.test.ts`
- `cf-killswitch-retry.test.ts`
- `stop-generation.test.ts`
- `hibernation-recovery.test.ts`

Mitigation: ChatAgent keeps a delegating `runGeneration(...)` method during migration that forwards to `this.pipeline.run(...)`. Tests that construct mock agents continue working — they just need to set `agent.pipeline = new GenerationPipeline(mockCtx)`. The structural tests in `model-allowlist.test.ts` that scan `agent.ts` source text will need path updates to also scan `generation-pipeline.ts`.

---

## 5. Test Impact Matrix

| Test file | Concern | Step affected | Change needed |
|---|---|---|---|
| `agent-write-guards.test.ts` | File extraction | Step 1 | Mock `fileExtractor` or use delegating method |
| `generation-pipeline-fixes.test.ts` | Extraction + repair | Step 1 | Same |
| `edit-tool.test.ts` | Tool + extraction | Steps 1–2 | Mock extractor (step 1), mock tool factory (step 2) |
| `agent-tools-wiring.test.ts` | Tool integration | Step 2 | Import `createToolHandlers` directly |
| `agent-generation-runtime.test.ts` | Generation E2E | Step 3 | Mock pipeline or use delegating method |
| `agent-resume-lifecycle.test.ts` | Generation resume | Step 3 | Same |
| `stale-active-job-id.test.ts` | Generation state | Step 3 | Same |
| `cf-killswitch-retry.test.ts` | CF Workers AI | Step 3 | Import from `generation-pipeline.ts` |
| `stop-generation.test.ts` | Generation abort | Step 3 | Mock pipeline |
| `hibernation-recovery.test.ts` | Hibernation | Step 3 | Import from `generation-pipeline.ts` |
| `parallel-post-gen-checks.test.ts` | Repair checks | Step 3 | Import repair functions from pipeline |
| `verify-file-check.test.ts` | Repair checks | Step 3 | Same |
| `model-allowlist.test.ts` | Structural scan | Step 3 | Scan `generation-pipeline.ts` too |
| `history-rewrite.test.ts` | WebSocket | None | Stays on ChatAgent |
| `socket-revocation.test.ts` | WebSocket | None | Stays on ChatAgent |
| `snapshot-server.test.ts` | WebSocket | None | Stays on ChatAgent |
| `preview-*.test.ts` (4 files) | Preview | None | Stays on ChatAgent |
| `agent-erasure.test.ts` | Lifecycle | None | Stays on ChatAgent |
| `product-outbox.test.ts` | Analytics | None | Stays on ChatAgent |

**Key insight:** Step 1 (FileExtractor) touches 4 test files. Step 2 (Tools) touches 2 test files. Step 3 (Pipeline) touches 8+ test files. This confirms the risk ordering.

**Mitigation strategy for all steps:** Keep thin delegating methods on ChatAgent during migration. Remove them in a follow-up cleanup PR once all tests are updated. This means every intermediate state compiles and passes tests even if some tests still reach the extracted code through the old path.

---

## 6. What NOT to Do

### DO NOT split tool execution from generation orchestration in Step 2

The tool handlers close over 10+ local variables from `runGeneration`'s scope (`epoch`, `abortController`, `accounting`, `inspectedFiles`, `toolWrittenPaths`, `actualPrompt`, `plannerMode`, `modes`, `connection`, `assetPaths`). Step 2 extracts the tool *definitions* into a factory that receives these as a context object, but the tool *execution* (the Vercel AI SDK's `generateText` call with `prepareStep`, `stopWhen`, etc.) stays in GenerationPipeline. Trying to also extract the tool-loop orchestration into the tool module would entangle two concerns that are only separable at the definition level, not the execution level.

### DO NOT extract WebSocket/streaming as a separate module

The streaming surface (139 `connection.send`/`broadcast` calls across the codebase) is not a separable concern — it's the output channel for every other concern. Generation streams tokens. Tools stream progress. Extraction streams file events. Repair streams notices. Factoring this out would require every module to emit events through an abstraction layer, adding indirection without reducing complexity. The `connection` parameter already serves as the streaming interface.

### DO NOT extract repair checks separately from GenerationPipeline

The 5 repair check functions (~1400–1660) read `project_files` via SQL, increment repair counters, call `persistRepairCounters`, and return prompt strings that feed back into the generation loop. They are called exclusively from within `runGeneration`'s post-processing. Extracting them into their own module would split the repair counter state and the hibernation persistence across module boundaries — exactly what Section 3 warns against. They belong in GenerationPipeline.

### DO NOT attempt a big-bang rewrite

With 1840 tests and active development (3 recent fixes to hibernation, kill-switch, and model metadata), a single PR that restructures all 5500 lines would be unreviewable and undebuggable. The 3-step incremental approach ensures every intermediate state is shippable.

### DO NOT extract preview serving yet

The preview concern (`onRequest`, `previewStore`, `prepareModuleSource`, `readServerFilesForBackend`) is self-contained and a good future extraction candidate, but it has zero overlap with the 4 concerns in scope. Adding a 4th extraction step would increase migration surface without addressing the generation-pipeline entanglement that motivates this split. Revisit after Steps 1–3 land.
