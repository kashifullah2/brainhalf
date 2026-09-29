import { describe, it, expect } from 'vitest';
import { describeVerificationFailure, isVerificationFailure, plainLanguageCheck } from '../lib/verification-copy';

describe('describeVerificationFailure', () => {
  it('leads with a plain headline and reassurance, no jargon', () => {
    const copy = describeVerificationFailure([
      { name: 'Agent chat with missing messages returns 400', detail: 'Expected HTTP 400; received 503.' },
    ]);
    expect(copy.headline).toBe('One automatic check did not pass.');
    expect(copy.headline).not.toMatch(/HTTP|400|503/i);
    expect(copy.reassurance).toContain('not published');
    expect(copy.plainChecks).toHaveLength(1);
    expect(copy.plainChecks[0]).not.toMatch(/HTTP|503/i);
  });

  it('pluralizes the headline for multiple failures', () => {
    const copy = describeVerificationFailure([
      { name: 'a', detail: 'Expected HTTP 200; received 500.' },
      { name: 'b', detail: 'Timed out after 30s.' },
    ]);
    expect(copy.headline).toBe('2 automatic checks did not pass.');
  });

  it('translates common failure patterns into plain language', () => {
    expect(plainLanguageCheck({ name: 'x', detail: 'Expected HTTP 400; received 503.' }))
      .toBe('A feature gave the wrong answer when it was tested.');
    expect(plainLanguageCheck({ name: 'x', detail: 'Request timed out waiting for the app.' }))
      .toBe('A feature took too long to answer while it was being tested.');
    expect(plainLanguageCheck({ name: 'x', detail: 'Something completely unexpected.' }))
      .toBe('An automatic check on the app did not pass.');
  });

  it('detects verification failures by job message', () => {
    expect(isVerificationFailure('Verification failed. Review the runtime check results before publishing.')).toBe(true);
    expect(isVerificationFailure('Build failed: npm run build exited 1')).toBe(false);
  });
});
