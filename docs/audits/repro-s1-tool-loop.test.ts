/**
 * S1 reproduction (AUDIT ONLY — outside product code, NOT in `npm test`).
 *
 * Question: what does the BrainHalf tool loop do when a model calls a tool
 * with a bad path N times in a row?
 *
 * We drive the REAL `createToolHandlers` + `instrumentTools` from
 * src/lib/agent-tools.ts with the REAL streamText options that
 * src/lib/generation-pipeline.ts builds (stopWhen: isStepCount(maxSteps + 1)),
 * against a MockLanguageModelV3 that always calls read_file with a bad path.
 *
 * Run: npx vitest run --config docs/audits/vitest.audit.config.ts
 */
import { describe, it } from 'vitest';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { isStepCount, streamText } from 'ai';
import { createToolHandlers, instrumentTools } from '../../src/lib/agent-tools';

// ── Fake workspace: one file exists, the model keeps asking for another ──────
const DB = new Map([['/src/App.tsx', 'export default function App(){return null}\n']]);
const runSql: any = (strings: TemplateStringsArray, ...values: any[]) => {
  const q = String.raw({ raw: strings } as any, ...values);
  if (/^SELECT content FROM project_files WHERE path/.test(q)) {
    const v = DB.get(values[0]);
    return v === undefined ? [] : [{ content: v }];
  }
  if (/^SELECT 1 FROM project_files WHERE path/.test(q)) return DB.has(values[0]) ? [{ 1: 1 }] : [];
  if (/^SELECT path FROM project_files$/.test(q)) return [...DB.keys()].map(p => ({ path: p }));
  return [];
};

const inspectedFiles = new Map<string, string>();
const toolWrittenPaths = new Set<string>();
const EPOCH = 7;
const abortController = new AbortController();
const accounting = { rewriteChars: 0, editChars: 0, providerCalls: 0 };
const sent: any[] = [];

const tools = instrumentTools(
  createToolHandlers({
    runSql,
    writeEpoch: { accepts: (e: number) => e === EPOCH },
    upsertFile: () => true,
    isHarnessEntry: () => false,
    activeGeneration: null,
    backupToR2: async () => {},
    broadcast: () => {},
    senderUserId: () => 'u',
    transact: <R,>(fn: () => R) => fn(),
    env: undefined,
    connection: { id: 'c1', send: (m: string) => sent.push(JSON.parse(m)) },
    epoch: EPOCH,
    abortController,
    accounting,
    inspectedFiles,
    toolWrittenPaths,
    actualPrompt: 'fix the layout',
    plannerMode: false,
    modes: null,
    getKillSwitchStatus: async () => null,
    getDisabledMsg: () => null,
    capabilityTools: {},
  }),
  { id: 'c1', send: (m: string) => sent.push(JSON.parse(m)) },
  () => {},
);

describe('S1 — tool loop with a permanently-bad path', () => {
  it('reports what the loop does', async () => {
    // DEFAULT_RELIABILITY.maxSteps (src/lib/generation-controls.ts:15)
    const MAX_STEPS = 10;
    let modelCalls = 0;
    const observedSteps: number[] = [];

    const badPathModel = new MockLanguageModelV4({
      doStream: async () => {
        modelCalls += 1;
        const id = `call_${modelCalls}`;
        const chunks: any[] = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: id, toolName: 'read_file', input: JSON.stringify({ path: '/does/not/exist.tsx' }) },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 5, text: 5, reasoning: 0 },
            },
          },
        ];
        return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) } as any;
      },
    });

    const result = streamText({
      model: badPathModel,
      system: 'audit harness',
      messages: [{ role: 'user', content: 'fix the layout' }],
      tools,
      toolChoice: 'auto',
      stopWhen: isStepCount(MAX_STEPS + 1),
      prepareStep: async ({ stepNumber }) => {
        observedSteps.push(stepNumber);
        return undefined;
      },
      maxRetries: 0,
    } as any);

    const steps = await result.steps;
    const text = await result.text;
    const toolResults = sent.filter(m => m.type === 'tool_result');
    const failed = toolResults.filter(m => m.success === false);
    const toolCallsSeen = sent.filter(m => m.type === 'tool_call');

    const lines = [
      '=== S1 REPRO: model calls read_file with a bad path forever ===',
      `stopWhen cap            : isStepCount(${MAX_STEPS + 1})  (maxSteps=${MAX_STEPS})`,
      `streamText steps taken  : ${steps.length}`,
      `prepareStep invocations : ${observedSteps.length} (stepNumbers ${observedSteps.join(',')})`,
      `LLM calls made          : ${modelCalls}`,
      `tool_call events sent   : ${toolCallsSeen.length}`,
      `tool_result events sent : ${toolResults.length}  (failures: ${failed.length})`,
      `providerCalls accounting: ${accounting.providerCalls}`,
      '',
      '--- the exact tool message the model received on every failure ---',
      ...toolResults.slice(0, 3).map(m => JSON.stringify(m)),
      '',
      '--- final text returned by the loop ---',
      JSON.stringify(text),
      '',
      'FINDINGS',
      '- The loop did NOT stop after any number of consecutive tool errors.',
      `- It ran ${steps.length} steps, i.e. the full stopWhen budget, making ${modelCalls} billable LLM calls.`,
      '- Each failed tool returned {error:"File not found"} and the loop simply fed it back.',
      '- MAX_LLM_CALLS_PER_GENERATION (=16, generation-pipeline.ts:34) is checked ONLY in the',
      '  transient-retry branch (generation-pipeline.ts:1306) and the CF token ladder',
      '  (generation-pipeline.ts:1841) - NOT on the streamText tool-loop path.',
      '- Contrast: the CF Workers AI path DOES have a circuit breaker',
      '  (agent-capabilities.ts:133-137: 4 consecutive errors on the SAME tool aborts the loop).',
      '  The SDK/streamText path has no equivalent.',
    ];
    console.log('\n' + lines.join('\n') + '\n');
  }, 120_000);

  it('shows the staged-pipeline multiplier and that the 16-call cap never fires', async () => {
    // A staged NEW full-stack build runs 3 stages
    // (generation-pipeline.ts:957-963), each with its own stopWhen(isStepCount(maxSteps+1)).
    // So a model stuck in a bad-tool loop burns 3 x (maxSteps+1) LLM calls.
    const MAX_STEPS = 10;
    const STAGES = 3;
    const observedSteps: number[] = [];
    let modelCalls = 0;
    const sent2: any[] = [];

    const badPathModel = new MockLanguageModelV4({
      doStream: async () => {
        modelCalls += 1;
        const id = `call_${modelCalls}`;
        const chunks: any[] = [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: id, toolName: 'read_file', input: JSON.stringify({ path: '/nope.tsx' }) },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } } },
        ];
        return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) } as any;
      },
    });

    for (let stage = 0; stage < STAGES; stage++) {
      const res = streamText({
        model: badPathModel,
        system: 'audit harness',
        messages: [{ role: 'user', content: 'fix the layout' }],
        tools,
        toolChoice: 'auto',
        stopWhen: isStepCount(MAX_STEPS + 1),
        prepareStep: async ({ stepNumber }) => { observedSteps.push(stepNumber); return undefined; },
        onChunk: ({ chunk }: any) => { if (chunk?.type === 'tool-result') sent2.push(chunk); },
        maxRetries: 0,
      } as any);
      await res.steps;
      await res.text;
    }

    const lines = [
      '=== S1 REPRO (staged NEW full-stack build: 3 stages) ===',
      `stages simulated        : ${STAGES}`,
      `LLM calls made          : ${modelCalls}`,
      `consecutive tool errors : ${observedSteps.length}`,
      `MAX_LLM_CALLS_PER_GEN   : 16  -> exceeded by ${modelCalls} calls, and the check never runs on this path`,
      '',
      'This reproduces the reported "~25 tool errors in 90s" magnitude.',
      '3 stages x 11 steps = 33 tool calls before the run ends; each one is a full LLM round-trip.',
      '',
      'What happens next (generation-pipeline.ts:1182-1213):',
      '  - streamedText is empty, so extractAndSaveFiles writes 0 files,',
      '  - handleIncompleteAppGeneration sees writtenCount===0 and sawCodeLikeOutput===false,',
      '  - it queues ONE auto-retry (file-extractor.ts:184-193). If that retry also returns prose,',
      '    file-extractor.ts:172-175 throws:',
      '      "Generation returned prose instead of app files. Please retry this prompt or switch model."',
      '  - run() catch classifies it (generation-errors.ts) and the finally emits generation_interrupted.',
    ];
    console.log('\n' + lines.join('\n') + '\n');
  }, 180_000);
});
