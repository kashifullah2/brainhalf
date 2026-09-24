import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import AssistantMarkdown from '../components/AssistantMarkdown';

describe('assistant Markdown', () => {
  it('renders structure, code and GFM tables', () => {
    const html = renderToStaticMarkup(<AssistantMarkdown content={'## Result\n\n**Ready** with `code`.\n\n| Check | Result |\n|---|---|\n| Build | Passed |'} />);
    expect(html).toContain('<h2>Result</h2>'); expect(html).toContain('<strong>Ready</strong>'); expect(html).toContain('<table>');
  });
  it('does not execute model HTML, unsafe links or remote tracking images', () => {
    const html = renderToStaticMarkup(<AssistantMarkdown content={'<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) ![remote](https://tracker.test/pixel) [safe](https://example.com)'} />);
    expect(html).not.toContain('<script'); expect(html).not.toContain('javascript:'); expect(html).not.toContain('<img'); expect(html).not.toContain('tracker.test');
    expect(html).toContain('rel="noopener noreferrer"'); expect(html).toContain('https://example.com');
  });
});
