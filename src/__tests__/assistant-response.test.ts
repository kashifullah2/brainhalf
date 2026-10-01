import { describe, expect, it } from 'vitest';
import { completeAssistantResponse, EMPTY_RESPONSE_MESSAGE, isEmptyAssistantResponse, stripPoisonedTail } from '../lib/assistant-response';

describe('assistant response completion', () => {
  it.each(['', '  \n\t ', 'Response contained no visible text.'])('reports an empty response as failed: %j', content => {
    expect(completeAssistantResponse(content, false)).toEqual({ content: EMPTY_RESPONSE_MESSAGE, failed: true });
  });

  it('keeps a successful tool-only write distinct from an empty failure', () => {
    const result = completeAssistantResponse('', true);
    expect(result.failed).toBe(false);
    expect(result.content).toContain('Application files updated');
    expect(isEmptyAssistantResponse(result.content)).toBe(false);
  });

  it('preserves ordinary replies and file artifacts', () => {
    for (const content of ['Here is your plan.', '<file path="src/App.tsx">export default () => null;</file>']) {
      expect(completeAssistantResponse(content, false)).toEqual({ content, failed: false });
    }
  });
});

describe('B1: stripPoisonedTail', () => {
  it('removes trailing empty AI turns before persistence', () => {
    const msgs = [
      { role: 'user', content: 'Build a bakery site' },
      { role: 'ai', content: '' },
    ];
    expect(stripPoisonedTail(msgs)).toEqual([{ role: 'user', content: 'Build a bakery site' }]);
  });

  it('removes trailing EMPTY_RESPONSE_MESSAGE turns', () => {
    const msgs = [
      { role: 'user', content: 'Hi' },
      { role: 'ai', content: 'Hello!' },
      { role: 'user', content: 'Try again' },
      { role: 'ai', content: EMPTY_RESPONSE_MESSAGE },
    ];
    const result = stripPoisonedTail(msgs);
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ role: 'user', content: 'Try again' });
  });

  it('leaves healthy conversations untouched (same reference)', () => {
    const msgs = [
      { role: 'user', content: 'Hi' },
      { role: 'ai', content: 'Hello! How can I help?' },
    ];
    expect(stripPoisonedTail(msgs)).toBe(msgs);
  });

  it('does not strip mid-history turns, only the tail', () => {
    const msgs = [
      { role: 'user', content: 'Hi' },
      { role: 'ai', content: '' },
      { role: 'user', content: 'Still here?' },
      { role: 'ai', content: 'Yes, I am here.' },
    ];
    const result = stripPoisonedTail(msgs);
    expect(result).toHaveLength(4);
  });
});
