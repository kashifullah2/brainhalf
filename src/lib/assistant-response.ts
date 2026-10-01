import { parseMessageSegmentsMemoized } from './message-parser';

export const EMPTY_RESPONSE_MESSAGE = 'The model didn’t return a response. Try again or choose another model.';

/** Judge the content the person can actually see, including file and tool cards. */
export function isEmptyAssistantResponse(content: string): boolean {
  const text = content.trim();
  if (!text || text === EMPTY_RESPONSE_MESSAGE
    || text === 'Response contained no visible text.'
    || text.includes('Model completed without generating response text.')) return true;
  const { segments } = parseMessageSegmentsMemoized(text, true);
  // A response that contains only <thought> blocks has no user-visible content.
  return segments.length === 0 || segments.every(s => s.type === 'thought');
}

export function completeAssistantResponse(content: string, filesChanged: boolean) {
  const empty = isEmptyAssistantResponse(content);
  return {
    content: empty ? (filesChanged ? 'Application files updated. Open the preview to review your changes.' : EMPTY_RESPONSE_MESSAGE) : content,
    failed: empty && !filesChanged,
  };
}

/**
 * B1: drop trailing poisoned AI turns (empty/placeholder replies from failed
 * attempts) before persisting. The live conversation keeps them for display;
 * storage only ever sees real turns. Returns the original array when clean.
 */
export function stripPoisonedTail(messages: Array<{ role: string; content?: string }>): Array<{ role: string; content?: string }> {
  let end = messages.length;
  while (end > 0) {
    const last = messages[end - 1];
    if (last && (last.role === 'ai' || last.role === 'assistant') && isEmptyAssistantResponse(String(last.content ?? ''))) end--;
    else break;
  }
  return end === messages.length ? messages : messages.slice(0, end);
}
