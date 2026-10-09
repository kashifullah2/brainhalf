import { describe, expect, it } from 'vitest';
import { computeRetryDelay, RuntimeRequestError, STATUS_NOT_FOUND_MAX_RETRIES } from '../lib/project-runtime-client';

describe('runtime polling termination logic (computeRetryDelay)', () => {
  it('410 returns null immediately — polling must stop', () => {
    const err = new RuntimeRequestError('Gone', 410);
    expect(computeRetryDelay(err, 1, 0)).toBeNull();
    expect(computeRetryDelay(err, 5, 0)).toBeNull();
  });

  it('404 is retryable until notFoundStreak reaches STATUS_NOT_FOUND_MAX_RETRIES', () => {
    const err = new RuntimeRequestError('Not found', 404);

    for (let streak = 0; streak < STATUS_NOT_FOUND_MAX_RETRIES; streak++) {
      const delay = computeRetryDelay(err, streak + 1, streak);
      expect(delay, `streak=${streak} should still retry`).toBeTypeOf('number');
      expect(delay).toBeGreaterThan(0);
    }

    const finalDelay = computeRetryDelay(err, STATUS_NOT_FOUND_MAX_RETRIES + 1, STATUS_NOT_FOUND_MAX_RETRIES);
    expect(finalDelay, 'at max streak, polling must stop').toBeNull();
  });

  it('a success (streak reset to 0) after 404s allows retries again', () => {
    const err = new RuntimeRequestError('Not found', 404);
    const streakAfterReset = 0;
    const delay = computeRetryDelay(err, 1, streakAfterReset);
    expect(delay).toBeTypeOf('number');
    expect(delay).toBeGreaterThan(0);
  });

  it('500 errors always produce a retry delay (never null)', () => {
    const err = new RuntimeRequestError('Internal error', 500);
    expect(computeRetryDelay(err, 1, 0)).toBeTypeOf('number');
    expect(computeRetryDelay(err, 10, 0)).toBeTypeOf('number');
  });

  it('429 respects retryAfterMs and exponential backoff', () => {
    const err = new RuntimeRequestError('Rate limited', 429, 30_000);
    const delay = computeRetryDelay(err, 1, 0);
    expect(delay).toBeGreaterThanOrEqual(30_000);
  });

  it('non-RuntimeRequestError causes still produce a retry delay', () => {
    const err = new Error('Network failure');
    expect(computeRetryDelay(err, 1, 0)).toBeTypeOf('number');
    expect(computeRetryDelay(err, 1, 0)).toBeGreaterThan(0);
  });
});
