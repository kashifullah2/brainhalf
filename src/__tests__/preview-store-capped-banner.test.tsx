import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewStoreCappedBanner } from '../components/PreviewStoreCappedBanner';

describe('PreviewStoreCappedBanner', () => {
  it('shows the row-cap warning strip for reason "rows"', () => {
    const html = renderToStaticMarkup(<PreviewStoreCappedBanner reason="rows" />);
    expect(html).toContain('has-warning');
    expect(html).toContain('too many rows');
    expect(html).not.toContain('too large');
  });

  it('shows the byte-cap warning strip for reason "bytes"', () => {
    const html = renderToStaticMarkup(<PreviewStoreCappedBanner reason="bytes" />);
    expect(html).toContain('has-warning');
    expect(html).toContain('too large');
    expect(html).not.toContain('too many rows');
  });

  it('renders nothing when reason is null (capped:false clears the banner)', () => {
    expect(renderToStaticMarkup(<PreviewStoreCappedBanner reason={null} />)).toBe('');
  });

  it('has the correct ARIA role on the strip', () => {
    const html = renderToStaticMarkup(<PreviewStoreCappedBanner reason="rows" />);
    expect(html).toContain('role="status"');
  });
});
