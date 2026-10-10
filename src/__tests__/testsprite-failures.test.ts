/**
 * Regression tests for TestSprite failures found on brainhalf.com.
 * Each test was written to reproduce a confirmed bug, then the bug was fixed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectRecentProjects, type RecentProjectEntry } from '../lib/recent-projects';

const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Issue 1: Refresh button disabled when previewLoadState === 'error'
// After generation finishes with a timeout, Refresh was disabled — the user
// had no way to retry. Fix: remove previewLoadState !== 'error' from the gate.
// ---------------------------------------------------------------------------
describe('Issue 1: Refresh button enabled on preview error', () => {
  const workspace = readFileSync(resolve(root, 'components/Workspace.tsx'), 'utf8');

  it('previewReady prop does not exclude the error state (Refresh enabled so user can retry)', () => {
    // Before fix: "previewReady={hasGeneratedApp && status !== 'Generating' && previewLoadState !== 'error'}"
    // After fix:  "previewReady={hasGeneratedApp && status !== 'Generating'}"
    expect(workspace).not.toMatch(/previewReady=\{hasGeneratedApp && status !== 'Generating' && previewLoadState !== 'error'\}/);
  });

  it('Refresh is the only retry path — it must not be gated on a successful prior load', () => {
    // openPreviewReady still allows opening a tab even when previewLoadState is error
    expect(workspace).toContain("openPreviewReady={hasGeneratedApp && status !== 'Generating'}");
  });
});

// ---------------------------------------------------------------------------
// Issue 2: Dashboard search shows "0 matching projects" for a project ID
// The filter string did not include the project's id field, so typing "proj-6c1"
// into the search box matched nothing.
// ---------------------------------------------------------------------------
describe('Issue 2: Dashboard search by project ID', () => {
  function makeEntry(id: string, title = 'My App'): RecentProjectEntry {
    return {
      project: { id, name: title, createdAt: 1, updatedAt: 1, status: 'ready' as const },
      title,
      description: '',
      untitled: false,
      status: 'draft',
      category: 'app',
      dateGroup: 'Today',
    };
  }

  it('finds a project when searching by exact id prefix', () => {
    const entries = [makeEntry('proj-6c1ab42', 'My App')];
    const results = selectRecentProjects(entries, 'proj-6c1', 'all', 'updated');
    expect(results).toHaveLength(1);
    expect(results[0].project.id).toBe('proj-6c1ab42');
  });

  it('returns 0 results for an id that does not exist (no false positives)', () => {
    const entries = [makeEntry('proj-abc123', 'My App')];
    expect(selectRecentProjects(entries, 'proj-xyz', 'all', 'updated')).toHaveLength(0);
  });

  it('still matches by title and description when id search is also enabled', () => {
    const entries = [
      makeEntry('proj-zzz', 'Orchid dashboard'),
      makeEntry('proj-abc', 'Other'),
    ];
    expect(selectRecentProjects(entries, 'Orchid', 'all', 'updated')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Issue 3: Console panel toggle (footer) did nothing
// workspace-panel-container lacked display:flex / flex-direction:column, so
// the content area had no height and ProjectConsole was invisible.
// ---------------------------------------------------------------------------
describe('Issue 3: workspace-panel-container is a flex column', () => {
  const css = readFileSync(resolve(root, 'styles/studio-workspace.css'), 'utf8');

  it('workspace-panel-container declares display:flex so flex:1 on the content area works', () => {
    expect(css).toMatch(/\.studio-workspace \.workspace-panel-container\s*\{[^}]*display\s*:\s*flex/);
  });

  it('workspace-panel-container declares flex-direction:column so TopNav/content/footer stack vertically', () => {
    expect(css).toMatch(/\.studio-workspace \.workspace-panel-container\s*\{[^}]*flex-direction\s*:\s*column/);
  });
});

// ---------------------------------------------------------------------------
// Issue 4: Command palette action
// The command palette was intentionally removed for simplicity; there is no
// CommandPalette component. The relevant actions are in the project ActionMenu.
// This test pins that design decision.
// ---------------------------------------------------------------------------
describe('Issue 4: command palette is intentionally absent', () => {
  const workspace = readFileSync(resolve(root, 'components/Workspace.tsx'), 'utf8');
  const topnav = readFileSync(resolve(root, 'components/TopNav.tsx'), 'utf8');

  it('no CommandPalette component in Workspace (removed for simplicity)', () => {
    expect(workspace).not.toContain('CommandPalette');
  });

  it('no CommandPalette component in TopNav (removed for simplicity)', () => {
    expect(topnav).not.toContain('CommandPalette');
  });

  it('project actions are in the ActionMenu gear icon (Download, Export, Reset)', () => {
    expect(topnav).toContain('Download ZIP');
    expect(topnav).toContain('Export to GitHub');
    expect(topnav).toContain('Reset workspace');
  });
});

// ---------------------------------------------------------------------------
// Issue 5: Signup ends on verification screen without clear guidance
// After email signup, the form switched to login mode but never showed the
// "Resend verification email" link and the verification message was not shown
// prominently enough.
// ---------------------------------------------------------------------------
describe('Issue 5: signup verification message says "check your email"', () => {
  const screen = readFileSync(resolve(root, 'components/LoginScreen.tsx'), 'utf8');

  it('shows the resend-verification link after signup (not only after a login failure)', () => {
    // The verificationRequired state must be set to true in the signup success
    // path (verificationRequired in result), not only in the catch block.
    expect(screen).toMatch(/verificationRequired.*in result[\s\S]{0,200}setVerificationRequired\(true\)/);
  });

  it('verification notice message explicitly says "check your email"', () => {
    const clientTs = readFileSync(resolve(root, 'lib/auth-client.ts'), 'utf8');
    expect(clientTs).toMatch(/check your email/i);
  });
});
