import { describe, expect, it } from 'vitest';
import { HOSTED_APP_LIMIT, isHostedLimitError } from '../lib/hosted-limit';
import { PILOT_LIMITS } from '../runtime/types';

describe('isHostedLimitError', () => {
  it('matches the current backend wording', () => {
    expect(isHostedLimitError('Your account has reached its hosted app limit (10 apps). Remove an app you no longer use to make room.')).toBe(true);
  });
  it('still matches the older backend wording during rollout', () => {
    expect(isHostedLimitError('Your account has reached its hosted project limit. Remove an unused hosted project before publishing another.')).toBe(true);
  });
  it('rejects unrelated failures', () => {
    expect(isHostedLimitError('Installing dependencies failed (exit 1). Build output: ERESOLVE')).toBe(false);
    expect(isHostedLimitError('Daily account jobs limit reached. Limits reset at midnight UTC.')).toBe(false);
    expect(isHostedLimitError('')).toBe(false);
    expect(isHostedLimitError(null)).toBe(false);
    expect(isHostedLimitError(undefined)).toBe(false);
  });
});

describe('HOSTED_APP_LIMIT', () => {
  it('is single-sourced from the backend pilot limit', () => {
    expect(HOSTED_APP_LIMIT).toBe(PILOT_LIMITS.projects);
    expect(HOSTED_APP_LIMIT).toBe(10);
  });
});
