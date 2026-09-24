import { describe, expect, it } from 'vitest';
import { reconcileWorkspaceSnapshot } from '../lib/workspace-reconciliation';
import { basicReactTemplate } from '../lib/templates';
import { STARTER_APP_JSX, STARTER_MAIN_JSX, STARTER_STYLES_CSS } from '../lib/preview-templates';

describe('Reconnect workspace reconciliation', () => {
  it('detects divergent files without overwriting either input', () => {
    const local = Object.freeze({ '/src/App.jsx': 'offline edit', '/src/local.js': 'local file' });
    const remote = Object.freeze({ '/src/App.jsx': 'server edit', '/src/remote.js': 'remote file' });
    const result = reconcileWorkspaceSnapshot(local, remote);
    expect(result.hasLocalChanges).toBe(true);
    expect(result.conflicts.sort()).toEqual(['/src/App.jsx', '/src/local.js', '/src/remote.js']);
    expect(result.files).toEqual(remote);
    expect(local['/src/App.jsx']).toBe('offline edit');
  });

  it('preserves locally held secrets omitted by the server snapshot', () => {
    const result = reconcileWorkspaceSnapshot({ '/server/.env': 'PRIVATE=local', '/src/App.jsx': 'same' }, { '/src/App.jsx': 'same' });
    expect(result.files['/server/.env']).toBe('PRIVATE=local');
    expect(result.conflicts).toEqual([]);
  });

  it('does not confuse either built-in starter with offline application edits', () => {
    const clientStarter = {
      '/src/App.jsx': basicReactTemplate.src.directory['App.jsx'].file.contents,
      '/src/main.jsx': basicReactTemplate.src.directory['main.jsx'].file.contents,
      '/src/styles.css': basicReactTemplate.src.directory['styles.css'].file.contents,
    };
    const serverStarter = { '/src/App.jsx': STARTER_APP_JSX, '/src/main.jsx': STARTER_MAIN_JSX, '/src/styles.css': STARTER_STYLES_CSS };
    for (const local of [clientStarter, serverStarter, {}]) {
      const result = reconcileWorkspaceSnapshot(local, { '/src/App.tsx': 'generated application' });
      expect(result.hasLocalChanges).toBe(false);
      expect(result.files).toEqual({ '/src/App.tsx': 'generated application' });
    }
  });
});
