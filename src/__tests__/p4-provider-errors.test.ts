/**
 * P4: AI model/provider reliability — verify error classification handles
 * all real-world provider errors observed during QA Phase 3.
 */
import { describe, expect, it } from 'vitest';
import { classifyGenerationError } from '../lib/generation-errors';

describe('P4 provider error classification (QA Phase 3 errors)', () => {
  const phase3Errors = [
    { raw: '8005: Internal server error', expectCategory: 'overloaded', retryable: true },
    { raw: '3046: Request timeout', expectCategory: 'timeout', retryable: true },
    { raw: 'The AI model provider hit an internal error', expectCategory: 'overloaded', retryable: true },
    { raw: 'The AI model took too long to respond', expectCategory: 'timeout', retryable: true },
    { raw: 'The AI model is receiving too much traffic right now.', expectCategory: 'rate_limited', retryable: true },
    // "Connection lost" is the WebSocket close message (client disconnect),
    // not a provider error — the user must manually retry.
    { raw: 'Connection lost', expectCategory: 'unknown', retryable: false },
  ];

  it.each(phase3Errors)('classifies "$raw"', ({ raw, expectCategory, retryable }) => {
    const result = classifyGenerationError(new Error(raw));
    expect(result.category).toBe(expectCategory);
    expect(result.retryable).toBe(retryable);
    // User message must never contain raw numeric codes.
    expect(result.userMessage).not.toMatch(/\b\d{4}\b/);
  });

  it('never exposes raw error codes to users', () => {
    const result = classifyGenerationError(new Error('AiError: 8005: Internal server error'));
    expect(result.userMessage).not.toContain('8005');
    expect(result.userMessage).not.toContain('AiError');
  });
});
