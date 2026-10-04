import { describe, it, expect, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import { ChatAgent } from '../agent';
import { WriteEpoch } from '../lib/concurrency';
import { resolvePlatformStatusForProject, setPlatformStatus, getStatusVisuals } from '../lib/status-store';
import { saveProjectMessages, setProjectAccount } from '../lib/project-store';

function createMockAgent() {
  const agent: any = Object.create(ChatAgent.prototype);
  agent.writeEpoch = new WriteEpoch();
  agent.idempotency = { has: () => false, setSql: () => {}, claim: () => true, release: () => {} };
  agent.currentAbortController = null;
  agent.connectionUserIds = new Map([['conn-1', 'user-1']]);
  agent.authCache = new Map();
  agent.authorizeConnection = vi.fn(async () => true);
  agent.getConnections = () => [];
  agent.ctx = { storage: { transactionSync: <R,>(closure: () => R): R => closure() } };

  const files = new Map<string, string>();
  agent.files = files;

  agent.sql = (strings: TemplateStringsArray, ...values: any[]) => {
    const stmt = strings.join('?');
    if (/DELETE FROM project_files WHERE path/i.test(stmt)) {
      files.delete(values[0]);
      return [];
    }
    if (/INSERT INTO project_files/i.test(stmt)) {
      files.set(values[0], values[1]);
      return [];
    }
    if (/SELECT content FROM project_files/i.test(stmt)) {
      return [{ content: files.get(values[0]) ?? null }];
    }
    return [];
  };

  const sentMessages: string[] = [];
  const broadcastMessages: string[] = [];

  const mockConnection = {
    id: 'conn-1',
    send: (msg: string) => sentMessages.push(msg),
    close: vi.fn(),
  };

  agent.broadcast = (msg: string) => broadcastMessages.push(msg);
  agent.backupToR2 = async () => {};

  return { agent, files, mockConnection, sentMessages, broadcastMessages };
}

describe('Stop generation handling', () => {
  it('stop message bumps epoch, aborts controller, and notifies client via stopped message', async () => {
    const { agent, mockConnection, sentMessages, broadcastMessages } = createMockAgent();

    // Start a dummy abort controller to simulate an active in-flight generation
    const controller = new AbortController();
    agent.currentAbortController = controller;
    const initialEpoch = agent.writeEpoch.snapshot();

    // Invoke onMessage with type: 'stop'
    await agent.onMessage(mockConnection, JSON.stringify({ type: 'stop' }));

    // Epoch must have incremented
    expect(agent.writeEpoch.snapshot()).toBeGreaterThan(initialEpoch);

    // Controller must be aborted
    expect(controller.signal.aborted).toBe(true);

    // Both the connection and broadcast must receive { type: 'stopped' }
    const stoppedSent = sentMessages.find(m => JSON.parse(m).type === 'stopped');
    const stoppedBroadcast = broadcastMessages.find(m => JSON.parse(m).type === 'stopped');
    expect(stoppedSent).toBeDefined();
    expect(stoppedBroadcast).toBeDefined();
  });

  it('discards file writes when a generation is stopped by bumping epoch', () => {
    const { agent, files, mockConnection } = createMockAgent();

    const generationTicket = agent.writeEpoch.begin();
    expect(agent.writeEpoch.accepts(generationTicket)).toBe(true);

    // User stops generation, bumping epoch
    agent.writeEpoch.begin();
    expect(agent.writeEpoch.accepts(generationTicket)).toBe(false);

    // A late extractAndSaveFiles call from the stopped generation
    agent.extractAndSaveFiles(
      '<file path="/src/App.jsx">export default function App() { return <div>Stopped</div>; }</file>',
      mockConnection,
      generationTicket
    );

    // Files must remain untouched
    expect(files.has('/src/App.jsx')).toBe(false);
  });

  it('updates platform status store to Stopped and provides correct visual badges', () => {
    const projectId = 'test-proj-stop';
    setProjectAccount('test-account');
    saveProjectMessages(projectId, [{ role: 'user', content: 'Create a game' }]);
    setPlatformStatus('Building', 'Generating...', projectId);
    expect(resolvePlatformStatusForProject(projectId)).toBe('Building');

    setPlatformStatus('Stopped', 'Generation stopped by user', projectId);
    expect(resolvePlatformStatusForProject(projectId)).toBe('Stopped');

    const visuals = getStatusVisuals('Stopped');
    expect(visuals.topBarLabel).toBe('Stopped');
    expect(visuals.modelPanelLabel).toBe('Stopped');
  });
});
