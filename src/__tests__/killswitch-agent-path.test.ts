import { describe, it, expect, vi, afterEach } from 'vitest';
import { GenerationPipeline } from '../lib/generation-pipeline';

// cloudflare:workers tracing and agents/Agent must exist for module resolution.
vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, callback: any) => callback({ setAttribute: () => {} }) },
}));
vi.mock('agents', () => ({ Agent: class {} }));

// AiBudget calls the registry for budget reservation. Mock the entire module so
// startAndReserve() is a no-op — this test is about the kill-switch path, not quotas.
vi.mock('../lib/ai-budget', () => ({
  AiBudget: class {
    readonly id = 'mock-budget-id';
    async startAndReserve() {}
    async end() {}
  },
  AiBudgetError: class extends Error {},
  aiBudgetEndpoint: () => ({}),
  meteredModel: (m: any) => m,
}));

describe('Kill-switch through pipeline.run() path', () => {
  afterEach(() => vi.restoreAllMocks());

  /**
   * This test drives the kill-switch through the real production path:
   *   pipeline.run()
   *     → getKillSwitchStatus (initial pre-generation check)
   *     → runCloudflareWorkersAI(onKillSwitch=<closure over getKillSwitchStatus>)
   *       → token-ladder loop
   *         → onKillSwitch() on each iteration (reads live registry)
   *
   * The registry returns "enabled" for the first two calls (initial check + first
   * retry iteration), then "disabled" on the third call (second iteration). The
   * test verifies that AI.run is invoked exactly once: the loop runs one attempt,
   * catches the max_tokens error, then checks the kill-switch on the next iteration
   * and stops before a second AI call is made.
   *
   * Counts:
   *   registry call 1 — initial getKillSwitchStatus() before generation  → enabled
   *   registry call 2 — onKillSwitch() in loop iteration 1               → enabled → AI.run throws
   *   registry call 3 — onKillSwitch() in loop iteration 2               → disabled → loop exits
   */
  it('stops the token-ladder loop and avoids a second AI.run call when kill-switch is disabled mid-generation', async () => {
    let registryCallCount = 0;
    const registryStub = {
      fetch: async (_req: Request) => {
        registryCallCount++;
        // First two calls: enabled. Third call: disabled (kills the second iteration).
        const enabled = registryCallCount < 3;
        return new Response(
          JSON.stringify({ integratedModelsEnabled: enabled, disabledModels: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    };
    const REGISTRY = {
      idFromName: () => ({}),
      get: () => registryStub,
    };

    const aiRunCalls: number[] = [];
    const AI = {
      run: vi.fn((_model: string, input: Record<string, any>) => {
        aiRunCalls.push(input.max_tokens ?? input.max_completion_tokens);
        throw new Error('max_tokens limit exceeded for this model');
      }),
    };

    // Minimal BuilderService: no attachments, no MCP servers, no skills.
    const mockBuilderService = {
      configuration: () => ({ servers: [], skills: [] }),
      attachments: () => [],
      attachment: () => ({ id: '', name: '', mime: 'text/plain', text: '', dataUrl: '', note: '' }),
      callTool: vi.fn(),
    };

    const connection: any = { send: vi.fn(), id: 'conn-1' };

    const pipeline: any = Object.create(GenerationPipeline.prototype);
    pipeline.ctx = {
      env: { AI, REGISTRY, REQUIRED_MODEL_PROVIDERS: 'cloudflare' },
      writeEpoch: { accepts: () => true, begin: () => {} },
      broadcast: vi.fn(),
      storage: {
        put: vi.fn(),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn(),
        transactionSync: (fn: () => any) => fn(),
      },
      // Tagged-template tag: always returns an empty row set.
      runSql: vi.fn().mockReturnValue([]),
      senderUserId: vi.fn().mockReturnValue('user-1'),
      getConnections: vi.fn().mockReturnValue([connection]),
      authorizeConnection: vi.fn().mockResolvedValue({ userId: 'user-1' }),
      abortGeneration: vi.fn(),
      queueProductOutcome: vi.fn().mockResolvedValue(undefined),
      builderService: vi.fn().mockReturnValue(mockBuilderService),
      name: 'test-project',
      backupToR2: vi.fn().mockResolvedValue(undefined),
      upsertFile: vi.fn().mockReturnValue(true),
      saveGenerationTurn: vi.fn().mockResolvedValue(undefined),
      saveCheckpoint: vi.fn().mockResolvedValue(undefined),
      fileExtractor: {
        extractAndSaveFiles: vi.fn().mockResolvedValue({ wrote: 0, checked: 0 }),
        handleIncompleteAppGeneration: vi.fn().mockResolvedValue(null),
        isLikelyShortNonAppReply: vi.fn().mockReturnValue(false),
      },
      ensureEntryPointExists: vi.fn(),
      readAllProjectFiles: vi.fn().mockReturnValue(new Map()),
      waitUntil: vi.fn(),
      // run() reads connectionUserIds to get the owner for AiBudget and for the
      // periodic auth-check timer.
      connectionUserIds: new Map([['conn-1', 'user-1']]),
    };

    // Pipeline fields that run() sets on first access or reads before the inner try.
    pipeline.generationBranchId = 'test-branch-1';
    pipeline.activeJobId = null;

    // Override methods whose real bodies make SQL or storage calls we don't care
    // about in this test.
    pipeline.generationJobs = vi.fn().mockReturnValue({
      create: vi.fn(), start: vi.fn(), interrupt: vi.fn(), complete: vi.fn(),
    });
    pipeline.persistActiveGeneration = vi.fn();
    pipeline.resolveCompletenessRepair = vi.fn();
    pipeline.captureUsage = vi.fn();
    pipeline.rememberGenerationText = vi.fn();
    pipeline.persistRepairCounters = vi.fn();
    pipeline.noteRepairQueued = vi.fn().mockReturnValue(false);

    const data: any = {
      type: 'generate',
      model: '@cf/deepseek-ai/deepseek-v4-flash-0731',
      provider: 'cloudflare',
      idempotencyKey: 'test-idem-ks-1',
      prompt: 'build me an inventory tracker',
    };

    // run() resolves (never rejects) even when the kill-switch fires: the abort
    // is caught by run()'s own try/catch and treated as a graceful stop.
    // plannerMode=true makes toolLess=true so capabilitiesFromTools() is bypassed
    // and runCapabilityLoop() is not entered. This keeps the test focused on the
    // kill-switch path without also mocking the tool-capability infrastructure.
    // The getKillSwitchStatus closure and onKillSwitch wiring are identical in
    // planner mode — only the tool set passed to runCloudflareWorkersAI differs.
    await pipeline.run(
      connection,
      data,
      'You are a helpful assistant.',
      'build me an inventory tracker',
      /* epoch */ 0,
      /* plannerMode */ true,
    );

    // Core assertion: AI.run was called exactly once.
    // If the onKillSwitch check inside the retry loop were removed, AI.run would
    // be called five times (TOKEN_LADDER has five entries) before throwing.
    expect(aiRunCalls.length).toBe(1);

    // Proves the live-registry path was exercised three times through run():
    //   call 1 — initial kill-switch check before generation starts
    //   call 2 — onKillSwitch in the first loop iteration (returns enabled)
    //   call 3 — onKillSwitch in the second loop iteration (returns disabled, stops loop)
    expect(registryCallCount).toBe(3);
  });
});
