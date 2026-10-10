/**
 * Tests for the parallel post-generation check runner:
 *   - Two failing checks produce exactly one combined trigger-auto-reply
 *   - No failures produce zero trigger-auto-reply events
 *
 * Tests call the check* methods directly (the same logic the production
 * Promise.all call site uses) and verify the combining behaviour.
 */

vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import { describe, expect, it, vi } from 'vitest';
import { ChatAgent, PHANTOM_HOOK_REPAIR_MARKER, VERIFY_FILE_REPAIR_MARKER } from '../agent';
import { WriteEpoch } from '../lib/concurrency';
import { FlipFlopGuard, RepairLog } from '../lib/repair-budget';

function makeAgent() {
  const agent: any = Object.create(ChatAgent.prototype);
  agent.writeEpoch = new WriteEpoch();
  agent.finalCompletenessRepairAttempts = 0;
  agent.phantomHookRepairAttempts = 0;
  agent.verifyFileRepairAttempts = 0;
  agent.apiRouteCoverageRepairAttempts = 0;
  agent.ctx = { storage: { transactionSync: <R,>(f: () => R): R => f() } };
  agent.flipFlopGuard = new FlipFlopGuard();
  agent.repairLog = new RepairLog();
  const events: any[] = [];
  const connection = { id: 'conn', send: (msg: string) => events.push(JSON.parse(msg)) };
  return { agent, connection, events };
}

describe('parallel post-gen checks: two failures → one combined repair turn', () => {
  it('collects prompts from both failing checks and joins with separator', () => {
    const { agent, connection, events } = makeAgent();

    // Files: worker backend (→ verify.json missing triggers checkVerificationPlanFile)
    // + phantom auth hook usage with no definition (→ checkNoPhantomAuthHooks fails)
    const allFiles = new Map([
      ['/worker/index.ts', 'export default {};'],
      ['/src/App.tsx', 'import { useAuth } from "./hooks/useAuth";\nexport default function App() { const { user } = useAuth(); return null; }'],
    ]);

    const prompts = [
      (agent as any).checkNoPhantomAuthHooks(allFiles, connection),
      (agent as any).checkVerificationPlanFile(allFiles, connection),
    ].filter(Boolean);

    expect(prompts.length).toBe(2);

    // Simulate the call-site combining logic
    const combined = prompts.join('\n\n---\n\n');
    connection.send(JSON.stringify({ type: 'trigger-auto-reply', message: combined }));

    const autoReplies = events.filter((e: any) => e.type === 'trigger-auto-reply');
    expect(autoReplies.length).toBe(1);
    expect(autoReplies[0].message).toContain(PHANTOM_HOOK_REPAIR_MARKER);
    expect(autoReplies[0].message).toContain(VERIFY_FILE_REPAIR_MARKER);
    expect(autoReplies[0].message).toContain('\n\n---\n\n');
  });

  it('each check still increments its own attempt counter independently', () => {
    const { agent, connection } = makeAgent();
    const allFiles = new Map([
      ['/worker/index.ts', 'export default {};'],
      ['/src/App.tsx', 'import { useAuth } from "./hooks/useAuth";\nexport default function App() { const { user } = useAuth(); return null; }'],
    ]);

    // First pass: both fail
    expect((agent as any).checkNoPhantomAuthHooks(allFiles, connection)).not.toBeNull();
    expect((agent as any).checkVerificationPlanFile(allFiles, connection)).not.toBeNull();

    // Second pass: both capped at one attempt
    expect((agent as any).checkNoPhantomAuthHooks(allFiles, connection)).toBeNull();
    expect((agent as any).checkVerificationPlanFile(allFiles, connection)).toBeNull();
  });
});

describe('parallel post-gen checks: no failures → zero trigger-auto-reply', () => {
  it('all checks return null for a clean frontend-only project', () => {
    const { agent, connection, events } = makeAgent();

    const allFiles = new Map([
      ['/src/App.tsx', 'export default function App() { return null; }'],
      ['/src/main.tsx', 'import { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")!).render(<App />);'],
    ]);

    const prompts = [
      (agent as any).checkFinalCompleteness(allFiles, connection),
      (agent as any).checkNoPhantomAuthHooks(allFiles, connection),
      (agent as any).checkVerificationPlanFile(allFiles, connection),
      (agent as any).checkApiRouteCoverage(allFiles, connection),
    ].filter(Boolean);

    expect(prompts.length).toBe(0);
    expect(events.filter((e: any) => e.type === 'trigger-auto-reply').length).toBe(0);
  });

  it('returns null for an empty file set', () => {
    const { agent, connection } = makeAgent();
    const allFiles = new Map<string, string>();

    expect((agent as any).checkFinalCompleteness(allFiles, connection)).toBeNull();
    expect((agent as any).checkNoPhantomAuthHooks(allFiles, connection)).toBeNull();
    expect((agent as any).checkVerificationPlanFile(allFiles, connection)).toBeNull();
    expect((agent as any).checkApiRouteCoverage(allFiles, connection)).toBeNull();
  });
});
