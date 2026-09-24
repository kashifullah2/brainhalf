import { describe, expect, it } from 'vitest';
import { needsBackend, hostingAvailability } from '../lib/generation-target';
import { buildSystemPrompt } from '../lib/system-prompt';
import { managedAppScaffold } from '../lib/managed-app-scaffold';
import { createTypeScriptStarter } from '../lib/project-starters';
import { publicationTarget } from '../runtime/publication';
import { verificationPlan } from '../runtime/verification';

describe('generation target selection', () => {
  it('detects backend requests and preserves backend requirements for existing projects', () => {
    expect(needsBackend('Build a customer portal with sign-in', {})).toBe(true);
    expect(needsBackend('Change the title', { '/worker/index.ts': 'export default {}' })).toBe(true);
    expect(needsBackend('Change the title', { '/src/App.tsx': '' })).toBe(false);
  });
  it.each(['Create a frontend demo appointment form. No backend.', 'Build a task manager without a backend', 'Create a frontend-only CRM', 'Show a static mockup of a booking app', "Build a service list; don't add a backend"])('does not provision services for explicit frontend scope: %s', prompt => {
    const files = createTypeScriptStarter();
    expect(needsBackend(prompt, files)).toBe(false);
    expect(managedAppScaffold(prompt, files, 'managed')).toBe(files);
  });
  it('still requires backend services for explicit online data and preserves existing backends', () => {
    expect(needsBackend('Create a frontend-only CRM and connect to a database', {})).toBe(true);
    expect(needsBackend('Create a frontend demo', { '/worker/index.ts': 'export default {}' })).toBe(true);
  });
  it('never treats a missing or inconsistent readiness response as available', () => {
    expect(hostingAvailability({ enabled: false, availability: { state: 'ready', message: '' } }).state).toBe('setup_required');
    expect(hostingAvailability({ enabled: true }).state).toBe('setup_required');
  });
  it.each(['Build an inventory app', 'Create a booking app', 'Build a task manager', 'Create a CRM', 'Build a full stack application'])('prepares %s for complete publishing', prompt => {
    const original = createTypeScriptStarter();
    const files = managedAppScaffold(prompt, original, 'managed');
    expect(files['/src/App.tsx']).toBe(original['/src/App.tsx']);
    expect(publicationTarget(files)).toBe('workers');
    expect(verificationPlan(files)).not.toBeNull();
    expect(files['/migrations/0001_items.sql']).toContain('CREATE TABLE');
    expect(files['/worker/backend.test.mjs']).toContain('DatabaseSync');
    expect(managedAppScaffold(prompt, files, 'managed')).toBe(files);
  });
  it('preserves existing backend code and explicit standalone export choices', () => {
    const existing = { ...createTypeScriptStarter(), '/server/index.ts': 'existing server' };
    expect(managedAppScaffold('Add a database', existing, 'managed')).toBe(existing);
    expect(managedAppScaffold('Build an inventory app', existing, 'export')).toBe(existing);
    const frontend = createTypeScriptStarter();
    expect(managedAppScaffold('Change the title', frontend, 'managed')).toBe(frontend);
  });
  it('runs existing frontend tests together with the added backend tests', () => {
    const original = createTypeScriptStarter();
    const pkg = JSON.parse(original['/package.json']); pkg.scripts.test = 'vitest run';
    const files = managedAppScaffold('Build a full stack app', { ...original, '/package.json': JSON.stringify(pkg) }, 'managed');
    expect(JSON.parse(files['/package.json']).scripts.test).toBe('vitest run && node --test worker/backend.test.mjs');
  });
  it('gives export builds a standalone backend without requiring managed bindings', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, executionTarget: 'export' });
    expect(prompt).toContain('standalone TypeScript Node server');
    expect(prompt).not.toContain('New managed full-stack apps use');
    expect(prompt).not.toContain('env.BRAINHALF_SERVICES.fetch');
    expect(prompt).toContain('Do not require BrainHalf service bindings');
  });
});
