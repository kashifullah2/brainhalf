import { describe, expect, it } from 'vitest';
import { completeAssistantResponse, EMPTY_RESPONSE_MESSAGE, isEmptyAssistantResponse } from '../lib/assistant-response';

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
