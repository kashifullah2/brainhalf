import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Workspace from '../components/Workspace';
import * as projectStore from '../lib/project-store';
import { basicReactTemplate } from '../lib/templates';
import * as wcInstance from '../lib/webcontainer/instance';

describe('Workspace initialization', () => {
  beforeEach(() => {
    vi.spyOn(projectStore, 'getProjectFiles').mockReturnValue(null);
    vi.spyOn(projectStore, 'saveProjectFiles').mockImplementation(() => {});
    vi.spyOn(wcInstance, 'webContainerSupported').mockReturnValue(false);
    const bound = projectStore.bindProjectStore();
    vi.spyOn(projectStore, 'bindProjectStore').mockReturnValue({ ...bound, getProjectFiles: projectStore.getProjectFiles, saveProjectFiles: projectStore.saveProjectFiles });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a fresh project with its initial waiting overlay', () => {
    const html = renderToString(React.createElement(Workspace, { activeProjectId: 'fresh-project' }));

    expect(html).toContain('Connecting your preview');
    expect(html).not.toContain('src="/preview/fresh-project/index.html"');
    expect(html).toContain('studio-preview-empty');
    expect(html).toContain('A place for your next idea.');
    expect(html).toContain('Generate an app in chat first');
    expect(projectStore.saveProjectFiles).not.toHaveBeenCalled();
  });

  it('renders a saved starter project without enabling publication', () => {
    vi.mocked(projectStore.getProjectFiles).mockReturnValue({
      '/src/App.jsx': basicReactTemplate.src.directory['App.jsx'].file.contents,
    });

    const html = renderToString(React.createElement(Workspace, { activeProjectId: 'starter-project' }));

    expect(html).toContain('Connecting your preview');
    expect(html).toContain('studio-preview-empty');
    expect(html).toContain('Generate an app in chat first');
    expect(projectStore.saveProjectFiles).not.toHaveBeenCalled();
  });

  it('renders a legacy starter without mutating or persisting it during render', () => {
    const files = Object.freeze({
      '/src/App.jsx': 'export default function App() { return <h1>BrainHalf Studio</h1>; }',
    });
    vi.mocked(projectStore.getProjectFiles).mockReturnValue(files);

    const html = renderToString(React.createElement(Workspace, { activeProjectId: 'legacy-project' }));

    expect(html).toContain('Connecting your preview');
    expect(html).toContain('Generate an app in chat first');
    expect(files['/src/App.jsx']).toContain('BrainHalf Studio');
    expect(projectStore.saveProjectFiles).not.toHaveBeenCalled();
  });

  it('keeps generated projects visible and eligible for publication', () => {
    vi.mocked(projectStore.getProjectFiles).mockReturnValue({
      '/src/App.jsx': 'export default function App() { return <h1>My dashboard</h1>; }',
    });

    const html = renderToString(React.createElement(Workspace, { activeProjectId: 'generated-project' }));

    expect(html).toContain('Connecting your preview');
    expect(html).not.toContain('src="/preview/generated-project/index.html"');
    expect(html).not.toContain('studio-preview-empty');
    expect(html).toContain('title="Put your app on the web"');
    expect(projectStore.saveProjectFiles).not.toHaveBeenCalled();
  });

  it('enables publication for generated TSX beside the seeded JSX app', () => {
    vi.mocked(projectStore.getProjectFiles).mockReturnValue({
      '/src/App.jsx': basicReactTemplate.src.directory['App.jsx'].file.contents,
      '/src/App.tsx': 'export default function App() { return <h1>Generated TSX</h1>; }',
    });
    const html = renderToString(React.createElement(Workspace, { activeProjectId: 'tsx-project' }));
    expect(html).toContain('title="Put your app on the web"');
    expect(html).not.toContain('studio-preview-empty');
  });
});
