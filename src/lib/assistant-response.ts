import { parseMessageSegmentsMemoized } from './message-parser';

export const EMPTY_RESPONSE_MESSAGE = 'The model didn’t return a response. Try again or choose another model.';

/** Judge the content the person can actually see, including file and tool cards. */
export function isEmptyAssistantResponse(content: string): boolean {
  const text = content.trim();
  return !text || text === EMPTY_RESPONSE_MESSAGE
    || text === 'Response contained no visible text.'
    || text.includes('Model completed without generating response text.')
    || parseMessageSegmentsMemoized(text, true).segments.length === 0;
}

export function completeAssistantResponse(content: string, filesChanged: boolean) {
  const empty = isEmptyAssistantResponse(content);
  return {
    content: empty ? (filesChanged ? 'Application files updated. Open the preview to review your changes.' : EMPTY_RESPONSE_MESSAGE) : content,
    failed: empty && !filesChanged,
  };
}
