import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LivePreviewFrame from '../components/LivePreviewFrame';

describe('LivePreviewFrame', () => {
  it('shows a preparing overlay instead of a bare frame before the iframe loads', () => {
    const html = renderToStaticMarkup(<LivePreviewFrame projectId="p1" liveUrl="https://preview.example/ticket" />);
    expect(html).toContain('Preparing your preview…');
    expect(html).toContain('role="status"');
    expect(html).toContain('src="https://preview.example/ticket"');
    expect(html).toContain('title="Live App Preview"');
  });

  it('keeps the preview sandbox restrictions', () => {
    const html = renderToStaticMarkup(<LivePreviewFrame projectId="p1" liveUrl="https://preview.example/ticket" />);
    expect(html).toContain('allow-scripts');
    expect(html).toContain('allow-same-origin');
  });
});
