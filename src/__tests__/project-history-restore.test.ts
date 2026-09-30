import { describe, expect, it } from 'vitest';
import { resolveReviewLoad } from '../components/ProjectHistory';

describe('resolveReviewLoad', () => {
  it('collapses the panel when "See changes" is clicked on the expanded row', () => {
    expect(resolveReviewLoad('abc', 'abc', false)).toBe('collapse');
  });

  it('loads when "See changes" is clicked on a different row', () => {
    expect(resolveReviewLoad('abc', 'xyz', false)).toBe('ensure');
  });

  it('never collapses for Restore, even on the already-expanded row (M4)', () => {
    // The old behavior collapsed here, clearing the review and leaving the
    // confirm dialog with a dead confirm button.
    expect(resolveReviewLoad('abc', 'abc', true)).toBe('ensure');
  });

  it('loads for Restore on a collapsed row', () => {
    expect(resolveReviewLoad(null, 'xyz', true)).toBe('ensure');
    expect(resolveReviewLoad('abc', 'xyz', true)).toBe('ensure');
  });
});
