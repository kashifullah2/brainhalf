import { describe, expect, it } from 'vitest';
import { toPlainBackendError } from '../lib/automatic-backend';

describe('toPlainBackendError', () => {
  it('replaces technical network errors with plain language', () => {
    expect(toPlainBackendError(new Error('fetch failed: ECONNREFUSED'))).toBe(
      'The backend could not start. Check your connection and try again.'
    );
  });

  it('replaces DNS failures with plain language', () => {
    expect(toPlainBackendError(new Error('getaddrinfo EAI_AGAIN registry.npmjs.org'))).toBe(
      'The backend could not start. Check your connection and try again.'
    );
  });

  it('replaces stack traces with plain language', () => {
    const stack = 'Error: something broke\n    at foo (bar.js:10:5)\n    at baz (qux.js:20:3)';
    expect(toPlainBackendError(new Error(stack))).toBe(
      'The backend could not start. Check your connection and try again.'
    );
  });

  it('passes through plain-language messages from our own code', () => {
    expect(toPlainBackendError(new Error('Backend source is ready.'))).toBe(
      'Backend source is ready.'
    );
  });

  it('returns generic message for empty or non-error causes', () => {
    expect(toPlainBackendError(null)).toBe('The backend could not start.');
    expect(toPlainBackendError(new Error(''))).toBe('The backend could not start.');
  });

  it('replaces overly long or structured messages', () => {
    const long = 'x'.repeat(300);
    expect(toPlainBackendError(new Error(long))).toBe('The backend could not start.');
  });
});

describe('backend plain-language error messages', () => {
  it('unknown runtime routes use plain language (not "Runtime route not found")', async () => {
    // Verified by code inspection: src/runtime/project.ts throws
    // 'That page or action was not found. Try refreshing, or go back to your project.'
    // instead of 'Runtime route not found.'
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/runtime/project.ts', 'utf8')
    );
    expect(src).not.toContain("RuntimeError('Runtime route not found.'");
    expect(src).toContain('That page or action was not found');
  });

  it('generic control failures use plain language (not "Runtime request failed")', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/runtime/project.ts', 'utf8')
    );
    expect(src).not.toContain("'Runtime request failed.'");
    expect(src).toContain('Something went wrong on our end. Please try again.');
  });

  it('generated backend crashes give guidance (not "Application request failed")', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/runtime/project.ts', 'utf8')
    );
    expect(src).not.toContain("'Application request failed.'");
    expect(src).toContain('Your app ran into a problem. Try refreshing the page.');
  });
});
