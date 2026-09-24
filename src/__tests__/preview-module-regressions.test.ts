import { DatabaseSync } from 'node:sqlite';
import { transform } from 'sucrase';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ tracing: {} }));
vi.mock('agents', () => ({ Agent: class {} }));

import { ChatAgent } from '../agent';
import { STARTER_APP_JSX } from '../lib/preview-templates';
import { PREVIEW_ACCESS_HEADER } from '../lib/project-access';

describe('Edge preview module regression tests', () => {
  let database: DatabaseSync;
  let agent: any;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE project_files (path TEXT PRIMARY KEY, content TEXT)');
    agent = Object.create(ChatAgent.prototype);
    agent.sql = (strings: TemplateStringsArray, ...values: any[]) => database.prepare(strings.join('?')).all(...values);
    agent.ensureSchema = () => {};
    agent.seedStarterIfEmpty = () => {};
  });

  afterEach(() => database.close());

  it.each(['/api/files', '/nested/api/files', '/server/index.js', '/src/server/index.js', '/package.json'])('denies public source/snapshot access to %s in the actual handler', async path => {
    const response = await agent.onRequest(new Request(`https://brainhalf.com/preview/project${path}`, {
      headers: { 'x-auth-user-id': 'visitor', [PREVIEW_ACCESS_HEADER]: 'public' },
    }));
    expect(response.status).toBe(403);
  });

  it('serves published frontend modules but not private root-file aliases', async () => {
    database.prepare('INSERT INTO project_files VALUES (?, ?)').run('/src/Card.jsx', 'export default function Card() { return <div>Public frontend</div>; }');
    database.prepare('INSERT INTO project_files VALUES (?, ?)').run('/private.json', '{"password":"private-sentinel"}');
    const headers = { 'x-auth-user-id': 'visitor', [PREVIEW_ACCESS_HEADER]: 'public' };
    const frontend = await agent.onRequest(new Request('https://brainhalf.com/preview/project/src/Card.jsx', { headers }));
    expect(frontend.status).toBe(200);
    expect(await frontend.text()).toContain('Public frontend');
    const alias = await agent.onRequest(new Request('https://brainhalf.com/preview/project/src/private.json', { headers }));
    expect(alias.status).toBe(404);
    expect(await alias.text()).not.toContain('private-sentinel');
    const owner = await agent.onRequest(new Request('https://brainhalf.com/preview/project/src/private.json', { headers: { 'x-auth-user-id': 'owner', [PREVIEW_ACCESS_HEADER]: 'owner' } }));
    expect(await owner.text()).toContain('private-sentinel');
  });

  it.each([
    'export default function () { return <div>Hello</div>; }',
    'export default async function () { return null; }',
    'export default class { render() { return null; } }',
    'export default () => <div>Hello</div>;',
    'export default null;',
  ])('keeps anonymous default exports syntactically valid: %s', (source) => {
    const output = agent.prepareModuleSource(source, '/src/App.jsx', '/src/App.jsx');

    expect(() => transform(output, { transforms: ['imports'] })).not.toThrow();
    expect(output).not.toMatch(/export \{ (?:function|class|async|null) \}/);
  });

  it('retains a named component alias', () => {
    const output = agent.prepareModuleSource('export default function Dashboard() { return <div />; }', '/src/App.jsx', '/src/App.jsx');
    expect(output).toContain('export { Dashboard };');
  });

  it('resolves sibling imports using valid SQLite bindings', () => {
    database.prepare('INSERT INTO project_files VALUES (?, ?)').run('/src/components/utils.js', 'export const value = 1;');
    const output = agent.prepareModuleSource("import { value } from './utils.js'; export default function Card() { return value; }", '/src/components/Card.jsx', '/src/components/Card.jsx');
    expect(output).toContain("from './utils.js'");
  });

  it('resolves parent imports using valid SQLite bindings', () => {
    database.prepare('INSERT INTO project_files VALUES (?, ?)').run('/src/utils.js', 'export const value = 1;');
    const output = agent.prepareModuleSource("import { value } from './utils.js'; export default function Card() { return value; }", '/src/components/Card.jsx', '/src/components/Card.jsx');
    expect(output).toContain("from '../utils.js'");
  });

  it('serves a module through extension fallback with valid SQLite bindings', async () => {
    database.prepare('INSERT INTO project_files VALUES (?, ?)').run('/src/components/Card.tsx', 'export default function Card() { return <div>Card</div>; }');
    const response = await agent.onRequest(new Request('https://brainhalf.com/preview/project/src/Card.jsx', {
      headers: { 'x-auth-user-id': 'owner' },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    expect(await response.text()).toContain('function Card');
  });

  it('serves a harness pointing at generated TSX rather than the seeded JSX starter', async () => {
    database.prepare('INSERT INTO project_files VALUES (?, ?)').run('/src/App.jsx', STARTER_APP_JSX);
    database.prepare('INSERT INTO project_files VALUES (?, ?)').run('/src/main.jsx', "import App from './App.jsx';");
    database.prepare('INSERT INTO project_files VALUES (?, ?)').run('/src/App.tsx', 'export default function App() { return <h1>Generated TSX</h1>; }');
    const response = await agent.onRequest(new Request('https://brainhalf.com/preview/project/src/main.jsx', { headers: { 'x-auth-user-id': 'owner' } }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('import * as AppModule from "./App.tsx"');
  });
});
