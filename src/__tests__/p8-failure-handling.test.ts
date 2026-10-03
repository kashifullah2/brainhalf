/**
 * P8: Failure testing — verify the system handles failures gracefully
 * without leaving projects in a broken state.
 */
import { describe, expect, it } from 'vitest';
import { classifyGenerationError } from '../lib/generation-errors';

describe('P8 failure handling', () => {
  it('non-retryable errors fail fast without retry loops', () => {
    // Auth failures should NOT be retried (would loop forever).
    const auth = classifyGenerationError(new Error('401 Unauthorized: invalid api key'));
    expect(auth.category).toBe('auth');
    expect(auth.retryable).toBe(false);
  });

  it('context length errors fail fast with actionable guidance', () => {
    const ctx = classifyGenerationError(new Error('prompt is too long: maximum context length exceeded'));
    expect(ctx.category).toBe('context_length');
    expect(ctx.retryable).toBe(false);
    expect(ctx.userMessage).toContain('Start a new chat');
  });

  it('unknown errors do not expose raw internals', () => {
    const unknown = classifyGenerationError(new Error('Some weird internal stack trace with /etc/passwd'));
    expect(unknown.userMessage).not.toContain('/etc/passwd');
    expect(unknown.userMessage).not.toContain('stack trace');
  });
});
