import { describe, expect, it } from 'vitest';
import { boundedConversation } from '../lib/agent-context';
import { EMPTY_RESPONSE_MESSAGE } from '../lib/assistant-response';

/**
 * B1: history-poisoning loop. Failed attempts persist empty assistant turns
 * ({ai: ''}, EMPTY_RESPONSE_MESSAGE) into history; every retry feeds them back
 * to the model, so each attempt starts more corrupted than the last.
 * boundedConversation must drop poisoned turns before model input.
 */
describe('B1: boundedConversation drops poisoned history', () => {
  it('drops empty assistant turns', () => {
    const history = [
      { role: 'user', content: 'Build a bakery site' },
      { role: 'ai', content: '' },
      { role: 'user', content: 'Try again' },
      { role: 'ai', content: '   ' },
    ];
    const result = boundedConversation(history, 'Try again please');
    const assistantTurns = result.filter(m => m.role === 'assistant');
    expect(assistantTurns).toHaveLength(0);
  });

  it('drops EMPTY_RESPONSE_MESSAGE turns', () => {
    const history = [
      { role: 'user', content: 'Build a bakery site' },
      { role: 'ai', content: EMPTY_RESPONSE_MESSAGE },
    ];
    const result = boundedConversation(history, 'Hello again');
    expect(result.filter(m => m.role === 'assistant')).toHaveLength(0);
  });

  it('keeps healthy turns intact', () => {
    const history = [
      { role: 'user', content: 'Build a bakery site' },
      { role: 'ai', content: 'Here is your bakery site with a menu and contact form.' },
    ];
    const result = boundedConversation(history, 'Add a dark mode');
    const assistantTurns = result.filter(m => m.role === 'assistant');
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0].content).toContain('bakery site');
    // The fresh prompt is always appended last.
    expect(result[result.length - 1]).toEqual({ role: 'user', content: 'Add a dark mode' });
  });

  it('drops server-injected continuation turns from model context', () => {
    // Stage-continuation turns ('[AUTO-CONTINUE] Continue to the next stage.'),
    // resume prompts and truncation retries are orchestration noise written by
    // the server, not user intent. Feeding them back pollutes every later turn.
    const history = [
      { role: 'user', content: 'Build a bakery site' },
      { role: 'assistant', content: 'Here is your bakery site.' },
      { role: 'user', content: '[AUTO-CONTINUE] Continue to the next stage.' },
      { role: 'assistant', content: 'Stage two complete.' },
      { role: 'user', content: 'The previous response ended with an unfinished file. Regenerate each unfinished file from its beginning.' },
      { role: 'assistant', content: 'Regenerated the cut-off file.' },
    ];
    const result = boundedConversation(history, 'Add a dark mode');
    const userTurns = result.filter(m => m.role === 'user').map(m => m.content);
    expect(userTurns).toEqual(['Build a bakery site', 'Add a dark mode']);
    // The assistant replies to those orchestration turns stay — they describe
    // real work the model did.
    expect(result.filter(m => m.role === 'assistant')).toHaveLength(3);
  });
});
