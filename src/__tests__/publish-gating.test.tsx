import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TopNav from '../components/TopNav';

// Regression guard: a failed preview must block the Publish action so users
// do not kick off a cloud build that would fail the same way.
describe('publish gating', () => {
  const baseProps = {
    activeProjectId: 'proj-1',
    onSelectTab: () => {},
    hasGeneratedApp: true,
    onPublish: () => {},
  };

  it('disables the publish button and explains why when the preview has an error', () => {
    const html = renderToStaticMarkup(
      <TopNav {...baseProps} publishBlockedReason="Fix the preview error before publishing — the cloud build would fail the same way." />,
    );
    const publishBtn = html.match(/<button[^>]*bolt-publish-btn[^>]*>/)?.[0] || '';
    expect(publishBtn).toContain('disabled');
    expect(publishBtn).toContain('Fix the preview error before publishing');
  });

  it('keeps the publish button enabled when the preview is healthy', () => {
    const html = renderToStaticMarkup(<TopNav {...baseProps} />);
    const publishBtn = html.match(/<button[^>]*bolt-publish-btn[^>]*>/)?.[0] || '';
    expect(publishBtn).not.toContain('disabled');
    expect(publishBtn).toContain('Put your app on the web');
  });

  it('hides viewport controls until the preview is ready', () => {
    const viewportProps = { ...baseProps, activeTab: 'preview' as const, onViewportMode: () => {} };
    const notReady = renderToStaticMarkup(<TopNav {...viewportProps} previewReady={false} />);
    expect(notReady).not.toContain('viewport-pill-btn');
    const ready = renderToStaticMarkup(<TopNav {...viewportProps} previewReady={true} />);
    expect(ready).toContain('viewport-pill-btn');
  });
});
