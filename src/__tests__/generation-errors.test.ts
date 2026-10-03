import { describe, expect, it } from 'vitest';
import { GenerationUserError, classifyGenerationError, generationErrorCode } from '../lib/generation-errors';

describe('classifyGenerationError', () => {
  it('treats 429 and rate-limit text as retryable provider-busy errors', () => {
    expect(classifyGenerationError(new Error('429 Too Many Requests'))).toMatchObject({ category: 'rate_limited', retryable: true });
    expect(classifyGenerationError({ status: 429, message: 'x' })).toMatchObject({ category: 'rate_limited', retryable: true });
    expect(classifyGenerationError(new Error('Rate limit reached for model'))).toMatchObject({ category: 'rate_limited', retryable: true });
    expect(classifyGenerationError(new Error('ThrottlingException: Rate exceeded'))).toMatchObject({ category: 'rate_limited', retryable: true });
  });

  it('treats 502/503/529 and overload text as retryable', () => {
    expect(classifyGenerationError(new Error('503 Service Unavailable'))).toMatchObject({ category: 'overloaded', retryable: true });
    expect(classifyGenerationError(new Error('Overloaded'))).toMatchObject({ category: 'overloaded', retryable: true });
    expect(classifyGenerationError({ statusCode: 529, message: 'x' })).toMatchObject({ category: 'overloaded', retryable: true });
  });

  it('treats dropped connections as retryable network errors', () => {
    expect(classifyGenerationError(new Error('fetch failed'))).toMatchObject({ category: 'network', retryable: true });
    expect(classifyGenerationError(new Error('read ECONNRESET'))).toMatchObject({ category: 'network', retryable: true });
    expect(classifyGenerationError(new Error('socket hang up'))).toMatchObject({ category: 'network', retryable: true });
  });

  it('treats timeouts as retryable', () => {
    expect(classifyGenerationError(new Error('The request timed out'))).toMatchObject({ category: 'timeout', retryable: true });
  });

  it('treats Workers AI numeric platform faults as retryable with clean messages', () => {
    const upstream = classifyGenerationError(new Error('AiError: 3046'));
    expect(upstream).toMatchObject({ category: 'timeout', retryable: true });
    expect(upstream.userMessage).not.toContain('3046');
    const internal = classifyGenerationError(new Error('8005: Internal server error'));
    expect(internal).toMatchObject({ category: 'overloaded', retryable: true });
    expect(internal.userMessage).not.toContain('8005');
    expect(generationErrorCode(internal)).toBe('provider_busy');
  });

  it('keeps context-length and auth precedence over numeric-code rules', () => {
    expect(classifyGenerationError(new Error('prompt is too long: 8300 tokens over the limit')).category).toBe('context_length');
    expect(classifyGenerationError(new Error('invalid api key')).category).toBe('auth');
  });

  it('treats context-length errors as non-retryable with guidance', () => {
    const info = classifyGenerationError(new Error('prompt is too long: 200000 tokens > 150000 maximum'));
    expect(info.category).toBe('context_length');
    expect(info.retryable).toBe(false);
    expect(info.userMessage).toMatch(/new chat/i);
  });

  it('treats credential failures as non-retryable auth errors', () => {
    expect(classifyGenerationError(new Error('401 unauthorized'))).toMatchObject({ category: 'auth', retryable: false });
    expect(classifyGenerationError(new Error('invalid x-api-key'))).toMatchObject({ category: 'auth', retryable: false });
    expect(classifyGenerationError({ status: 403, message: 'x' })).toMatchObject({ category: 'auth', retryable: false });
  });

  it('falls back to unknown with the original message preserved', () => {
    expect(classifyGenerationError(new Error('something odd happened'))).toMatchObject({ category: 'unknown', retryable: false, userMessage: 'something odd happened' });
    expect(classifyGenerationError(undefined)).toMatchObject({ category: 'unknown', userMessage: 'Generation failed unexpectedly.' });
  });

  it('never leaks raw provider text in classified user messages', () => {
    for (const raw of ['429 Too Many Requests', 'Overloaded', 'fetch failed', 'invalid x-api-key']) {
      expect(classifyGenerationError(new Error(raw)).userMessage).not.toContain(raw);
    }
  });
});

describe('generationErrorCode', () => {
  it('maps transient categories to provider_busy', () => {
    for (const raw of ['429', '503', 'fetch failed', 'timed out']) {
      expect(generationErrorCode(classifyGenerationError(new Error(raw)))).toBe('provider_busy');
    }
  });

  it('maps non-retryable categories to distinct codes', () => {
    expect(generationErrorCode(classifyGenerationError(new Error('context length exceeded')))).toBe('context_length');
    expect(generationErrorCode(classifyGenerationError(new Error('401')))).toBe('provider_auth');
    expect(generationErrorCode(classifyGenerationError(new Error('mystery')))).toBeUndefined();
  });
});

describe('GenerationUserError', () => {
  it('carries the classified message, category, code, and cause', () => {
    const cause = new Error('429 Too Many Requests');
    const err = new GenerationUserError(classifyGenerationError(cause), cause);
    expect(err.message).toMatch(/too much traffic/i);
    expect(err.category).toBe('rate_limited');
    expect(err.code).toBe('provider_busy');
    expect(err.cause).toBe(cause);
  });
});
