/**
 * Generated apps are served exactly as written, so an HTML document without a
 * doctype renders in quirks mode — the box model and layout diverge from what
 * the author intended, and the console fills with standards warnings. Model
 * output occasionally omits the doctype, so every HTML write passes through
 * this normalizer.
 *
 * Only full documents are touched: content must begin (after leading
 * whitespace) with `<html`. Fragments and partial templates pass through
 * unchanged, and the function is idempotent.
 */
export function ensureHtmlDoctype(path: string, content: string): string {
  if (!/\.html?$/i.test(path)) return content;
  if (/^\s*<!doctype\s+html/i.test(content)) return content;
  if (!/^\s*<html[\s>]/i.test(content)) return content;
  return `<!doctype html>\n${content.replace(/^\s+/, '')}`;
}
