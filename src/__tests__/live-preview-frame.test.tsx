import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LivePreviewFrame from '../components/LivePreviewFrame';

describe('LivePreviewFrame', () => {
  it('shows a connecting overlay before the probe resolves', () => {
    const html = renderToStaticMarkup(<LivePreviewFrame projectId="p1" liveUrl="https://preview.example/ticket" />);
    expect(html).toContain('Connecting to your app…');
    expect(html).toContain('role="status"');
  });

  it('iframe and sandbox attrs render only after probe succeeds (not in static markup)', () => {
    const html = renderToStaticMarkup(<LivePreviewFrame projectId="p1" liveUrl="https://preview.example/ticket" />);
    // Initial probeState is 'checking' — iframe is deferred until reachable
    expect(html).not.toContain('allow-scripts');
    expect(html).toContain('live-preview-frame');
  });
});
