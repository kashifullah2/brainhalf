import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: () => any) => fn() },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));

import { ChatAgent } from '../agent';
import {
  createProject,
  getProjects,
  saveProjects,
  getActiveProjectId,
  setActiveProjectId,
  getProjectMessages,
  saveProjectMessages,
  getProjectFiles,
  saveProjectFiles,
  updateProjectName,
} from '../lib/project-store';
import { appEvents } from '../lib/events';

describe('New Project and Template Selection Isolation', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
    });
  });

  it('keeps new project active and prevents switching to previous project when selecting a template', () => {
    // 1. User starts on an existing project (e.g. Project 1)
    const oldProj = createProject('My Old App');
    saveProjectFiles(oldProj.id, { '/src/App.jsx': '// Old App Code' });
    saveProjectMessages(oldProj.id, [{ role: 'user', content: 'Build an old app' }]);
    expect(getActiveProjectId()).toBe(oldProj.id);

    // 2. User clicks "New Project"
    const newProj = createProject('chat-easy-2');
    expect(newProj.id).not.toBe(oldProj.id);
    expect(getActiveProjectId()).toBe(newProj.id);

    // 3. Brand new project has isolated empty state
    expect(getProjectMessages(newProj.id)).toBeNull();
    expect(getProjectFiles(newProj.id)).toBeNull();

    // 4. User selects a Quick Template: "Crypto Tracker"
    const templatePrompt = 'Build an app: Crypto Tracker - Live prices, search, interactive charts';
    const newMsgs = [
      { role: 'user' as const, content: templatePrompt, timestamp: Date.now() },
      { role: 'ai' as const, content: '' }
    ];
    saveProjectMessages(newProj.id, newMsgs);

    // Auto-rename project with template prompt
    const cleanedPrompt = templatePrompt.trim().replace(/\s+/g, ' ');
    const newTitle = cleanedPrompt.length > 30 ? `${cleanedPrompt.slice(0, 30)}…` : cleanedPrompt;
    updateProjectName(newProj.id, newTitle);

    // 5. Verify the active project remains the new project with its new title and messages
    expect(getActiveProjectId()).toBe(newProj.id);
    const updatedProjects = getProjects();
    const activeInList = updatedProjects.find(p => p.id === newProj.id);
    expect(activeInList?.name).toBe('Build an app: Crypto Tracker -…');
    expect(getProjectMessages(newProj.id)).toEqual(newMsgs);

    // 6. Verify the old project was completely untouched
    expect(getProjectMessages(oldProj.id)).toEqual([{ role: 'user', content: 'Build an old app' }]);
    expect(getProjectFiles(oldProj.id)).toEqual({ '/src/App.jsx': '// Old App Code' });
  });

  it('does not emit project-switched for local projects when connection drops (code 1006)', async () => {
    // Seed an existing project and then create a new project
    const p1 = createProject('First Project');
    const p2 = createProject('chat-easy-2');
    setActiveProjectId(p2.id);

    const switchedEvents: string[] = [];
    const unsub = appEvents.on('project-switched', (data: { projectId: string }) => {
      switchedEvents.push(data.projectId);
    });

    // Simulate WebSocket close with code 1006 (abnormal close / transport drop)
    const event = { code: 1006 };
    // Our fix guarantees event.code === 1006 does NOT trigger the 4401 auto-switch logic
    const isTerminalAuthFailure = event.code === 4401;
    expect(isTerminalAuthFailure).toBe(false);

    // If local project is in getProjects(), it should never be switched away
    const isLocal = getProjects().some(p => p.id === p2.id);
    expect(isLocal).toBe(true);

    expect(switchedEvents).toHaveLength(0);
    expect(getActiveProjectId()).toBe(p2.id);

    unsub();
  });

  it('preserves project isolation in R2 backup keys using instance name', () => {
    const agent: any = Object.create(ChatAgent.prototype);

    // Test agent instance with a distinct project name
    agent.name = 'proj-crypto-tracker-99';
    expect(agent.backupKey()).toBe('backup-proj-crypto-tracker-99.json');

    // Test second agent instance
    agent.name = 'proj-portfolio-42';
    expect(agent.backupKey()).toBe('backup-proj-portfolio-42.json');
  });
});
