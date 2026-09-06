import { describe, expect, it } from 'vitest';

import { errorMessage, humanizeExtractionError } from './humanize-error';

describe('errorMessage', () => {
  it('returns an Error’s message', () => {
    expect(errorMessage(new Error('Upstream refused the request.'))).toBe(
      'Upstream refused the request.',
    );
  });

  it('returns a thrown string as-is', () => {
    expect(errorMessage('plain string failure')).toBe('plain string failure');
  });

  it('falls back rather than rendering undefined or [object Object]', () => {
    // This is the whole reason the helper exists. Eighteen call sites did
    // `catch (e: any)` then `e.message`, which is `undefined` for every value
    // below — and a toast whose description is undefined renders as a blank line
    // under the title. The `String(e)` variants were worse: "[object Object]".
    expect(errorMessage({ code: 500 })).toBe('Something went wrong.');
    expect(errorMessage(null)).toBe('Something went wrong.');
    expect(errorMessage(undefined)).toBe('Something went wrong.');
    expect(errorMessage(42)).toBe('Something went wrong.');
  });

  it('uses the caller’s fallback when one is given', () => {
    expect(errorMessage(null, 'Could not reset the password.')).toBe(
      'Could not reset the password.',
    );
  });

  it('treats an Error with a blank message as having none', () => {
    // `new Error()` has `message === ''`, which would otherwise be shown as an
    // empty description.
    expect(errorMessage(new Error(''), 'Try again.')).toBe('Try again.');
    expect(errorMessage('   ', 'Try again.')).toBe('Try again.');
  });
});

describe('humanizeExtractionError', () => {
  it('still answers for a missing reason', () => {
    // Guards the neighbour this file shares a module with: errorMessage was added
    // above it and must not have changed its behaviour.
    expect(humanizeExtractionError(null).title).toBe("Extraction didn't finish");
    expect(humanizeExtractionError('').body).toContain('No reason was recorded');
  });
});
