import { describe, expect, it } from 'vitest';
import { shouldApplyIncomingHistory } from '../components/ChatPanel';
import { EMPTY_RESPONSE_MESSAGE } from '../lib/assistant-response';

describe('Chat history merge guards', () => {
  const saved = [
    { role: 'user' as const, content: 'Build app' },
    { role: 'ai' as const, content: 'First response' },
    { role: 'user' as const, content: 'Add a chart' },
    { role: 'ai' as const, content: 'The chart is ready' },
  ];

  const greeting = [
    { role: 'user' as const, content: 'Hello' },
    { role: 'ai' as const, content: 'Hi! What would you like to build?' },
  ];
  const internalRetry = [
    { role: 'user' as const, content: '[AUTO-RETRY-FULL-APP] Generate complete files' },
    { role: 'ai' as const, content: '' },
  ];

  it('removes cached empty internal retries after a saved greeting', () => {
    expect(shouldApplyIncomingHistory([...greeting, ...internalRetry, ...internalRetry], greeting)).toBe(true);
  });

  it('recognizes explicitly marked internal retry placeholders', () => {
    expect(shouldApplyIncomingHistory([...greeting,
      { role: 'user', content: 'Continue the same task', internal: true },
      { role: 'ai', content: '' },
    ], greeting)).toBe(true);
  });

  it('preserves a different visible prompt after a completed greeting', () => {
    expect(shouldApplyIncomingHistory([...greeting,
      { role: 'user', content: 'Build a shop' },
      { role: 'ai', content: '' },
    ], greeting)).toBe(false);
  });

  it.each(['Here are the generated files.', EMPTY_RESPONSE_MESSAGE, 'Provider request failed.'])('preserves an internal retry with a reply or error: %s', content => {
    expect(shouldApplyIncomingHistory([...greeting, internalRetry[0], { role: 'ai', content }], greeting)).toBe(false);
  });

  it('preserves cached history if the server prefix differs', () => {
    expect(shouldApplyIncomingHistory([...greeting, ...internalRetry], [
      { role: 'user', content: 'Good morning' }, greeting[1],
    ])).toBe(false);
  });

  it('repairs cached empty retries with the saved answer to the same prompt', () => {
    const local = [...saved.slice(0, -1),
      { role: 'ai' as const, content: '' },
      { role: 'user' as const, content: 'Add a chart' },
      { role: 'ai' as const, content: '' },
    ];
    expect(shouldApplyIncomingHistory(local, saved)).toBe(true);
  });

  it('preserves a different pending task when the saved history is shorter', () => {
    const local = [...saved.slice(0, -1),
      { role: 'ai' as const, content: '' },
      { role: 'user' as const, content: 'Add payments' },
      { role: 'ai' as const, content: '' },
    ];
    expect(shouldApplyIncomingHistory(local, saved)).toBe(false);
  });

  it('preserves visible replies after the saved answer', () => {
    const local = [...saved.slice(0, -1),
      { role: 'ai' as const, content: '' },
      { role: 'user' as const, content: 'Add a chart' },
      { role: 'ai' as const, content: 'A newer chart is ready' },
    ];
    expect(shouldApplyIncomingHistory(local, saved)).toBe(false);
  });

  it('rejects incoming history that drops visible assistant content', () => {
    const local = [
      { role: 'user' as const, content: 'Build app' },
      { role: 'ai' as const, content: '<file path="src/App.jsx">export default function App(){return null}</file>' },
    ];
    const incoming = [
      { role: 'user' as const, content: 'Build app' },
      { role: 'ai' as const, content: '' },
    ];
    expect(shouldApplyIncomingHistory(local, incoming)).toBe(false);
  });

  it('accepts incoming history when it is complete', () => {
    const local = [
      { role: 'user' as const, content: 'Build app' },
      { role: 'ai' as const, content: 'Working...' },
    ];
    const incoming = [
      { role: 'user' as const, content: 'Build app' },
      { role: 'ai' as const, content: 'Final response' },
    ];
    expect(shouldApplyIncomingHistory(local, incoming)).toBe(true);
  });

  it('rejects an empty latest response even when earlier assistant messages are visible', () => {
    const local = [
      { role: 'user' as const, content: 'Build app' },
      { role: 'ai' as const, content: 'First response' },
      { role: 'user' as const, content: 'Add a chart' },
      { role: 'ai' as const, content: 'The chart is ready' },
    ];
    const incoming = local.map((message, index) => index === 3 ? { ...message, content: '' } : message);
    expect(shouldApplyIncomingHistory(local, incoming)).toBe(false);
  });
});
