import { describe, expect, it } from 'vitest';
import { hardResetUrl } from '../components/ErrorBoundary';

/** N2: the hard reset must not lose ?project=… when clearing the cache. */
describe('hardResetUrl', () => {
  it('keeps the project query param and adds the cache-buster', () => {
    expect(hardResetUrl('https://brainhalf.com/?project=abc123', 1700000000000)).toBe(
      'https://brainhalf.com/?project=abc123&v=1700000000000'
    );
  });

  it('adds the cache-buster when there is no query string', () => {
    expect(hardResetUrl('https://brainhalf.com/', 1700000000000)).toBe(
      'https://brainhalf.com/?v=1700000000000'
    );
  });

  it('replaces an existing cache-buster instead of duplicating it', () => {
    expect(hardResetUrl('https://brainhalf.com/?project=abc&v=1', 2)).toBe(
      'https://brainhalf.com/?project=abc&v=2'
    );
  });

  it('keeps the hash fragment', () => {
    expect(hardResetUrl('https://brainhalf.com/?project=abc#section', 7)).toBe(
      'https://brainhalf.com/?project=abc&v=7#section'
    );
  });
});
