import { describe, expect, it } from 'vitest';
import { ensureHtmlDoctype } from '../lib/html-normalize';

describe('ensureHtmlDoctype', () => {
  it('prepends the doctype to a full HTML document that lacks one', () => {
    expect(ensureHtmlDoctype('/index.html', '<html lang="en"><head></head><body></body></html>'))
      .toBe('<!doctype html>\n<html lang="en"><head></head><body></body></html>');
    expect(ensureHtmlDoctype('/index.html', '\n  <html><body>x</body></html>'))
      .toBe('<!doctype html>\n<html><body>x</body></html>');
  });

  it('leaves documents that already declare a doctype unchanged', () => {
    const doc = '<!DOCTYPE html>\n<html><body>x</body></html>';
    expect(ensureHtmlDoctype('/index.html', doc)).toBe(doc);
    expect(ensureHtmlDoctype('/index.html', '  <!doctype html><html></html>')).toBe('  <!doctype html><html></html>');
  });

  it('leaves fragments and non-HTML files unchanged', () => {
    expect(ensureHtmlDoctype('/partials/card.html', '<div>fragment</div>')).toBe('<div>fragment</div>');
    expect(ensureHtmlDoctype('/src/App.tsx', '<html>not really html</html>')).toBe('<html>not really html</html>');
  });

  it('is idempotent', () => {
    const once = ensureHtmlDoctype('/index.html', '<html></html>');
    expect(ensureHtmlDoctype('/index.html', once)).toBe(once);
  });
});
