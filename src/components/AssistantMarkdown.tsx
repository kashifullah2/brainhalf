import { memo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './AssistantMarkdown.css';

/** Raw HTML and automatic remote images are deliberately disabled in model-authored prose. */
const AssistantMarkdown = memo(function AssistantMarkdown({ content }: { content: string }) {
  return <div className="assistant-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={url => {
      const safe = defaultUrlTransform(url);
      return /^(?:https?:\/\/|mailto:|\/[^/]|#)/i.test(safe) ? safe : '';
    }}
    components={{
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span className="markdown-image-label">{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
      table: ({ children }) => <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label="Message table"><table>{children}</table></div>,
    }}>{content.slice(0, 120_000)}</ReactMarkdown>{content.length > 120_000 && <p className="settings-muted">Message display truncated. The full response remains in your conversation.</p>}</div>;
});
export default AssistantMarkdown;
