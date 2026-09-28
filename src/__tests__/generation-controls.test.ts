import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RELIABILITY, generationContextLimits, generationControls, normalizeReliabilityControls } from '../lib/generation-controls';
import { boundedConversation } from '../lib/agent-context';
import { AI_TIMEOUT_MS, MAX_OUTPUT_TOKENS } from '../lib/models';
import { getReliabilityControls, setReliabilityControls } from '../lib/project-growth';

vi.mock('../lib/project-store', () => ({ projectStorageKey: (key: string) => `account:${key}` }));
afterEach(() => vi.unstubAllGlobals());

describe('Generation performance controls', () => {
  it('gives a build enough output room by default while honoring an explicit smaller limit', () => {
    expect(generationControls({})).toEqual(DEFAULT_RELIABILITY);
    expect(DEFAULT_RELIABILITY.maxTokens).toBeGreaterThanOrEqual(8192);
    expect(generationControls({ max_tokens: 1400 }).maxTokens).toBe(1400);
    expect(generationControls({ fast_mode: false }).fastMode).toBe(false);
    expect(generationControls({}).fastMode).toBe(true);
    expect(generationControls({ max_completion_tokens: 4096 }).maxTokens).toBe(4096);
    expect(generationControls({ timeout_ms: 0 }).timeoutMs).toBe(AI_TIMEOUT_MS);
  });

  it.each([null, [], 'bad', { fastMode: 'false', maxTokens: NaN, maxSteps: Infinity, timeoutMs: -1 }])('recovers from malformed saved settings: %j', input => {
    expect(normalizeReliabilityControls(input)).toEqual(DEFAULT_RELIABILITY);
  });

  it('bounds hostile control fields on the server', () => {
    expect(generationControls({ max_tokens: 1e9, max_steps: 100, timeout_ms: 1e12, fast_mode: 'true' })).toEqual({
      fastMode: DEFAULT_RELIABILITY.fastMode, maxTokens: MAX_OUTPUT_TOKENS, maxSteps: 20, timeoutMs: AI_TIMEOUT_MS,
    });
  });

  it('reads changed settings on the next request and isolates them by project', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    expect(getReliabilityControls('one')).toEqual(DEFAULT_RELIABILITY);
    setReliabilityControls('one', { maxTokens: 16384, maxSteps: 3, fastMode: true });
    expect(getReliabilityControls('one')).toMatchObject({ maxTokens: 16384, maxSteps: 3, fastMode: true });
    expect(getReliabilityControls('two')).toEqual(DEFAULT_RELIABILITY);
    values.set('account:growth:reliability:one', '{bad json');
    expect(getReliabilityControls('one')).toEqual(DEFAULT_RELIABILITY);
  });

  it('reduces older context in fast mode without shortening or duplicating the current request', () => {
    const prompt = 'Fix checkout and preserve order validation';
    const history = [...Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'old context '.repeat(800) })), { role: 'user', content: prompt }];
    const fast = generationContextLimits(true);
    const balanced = generationContextLimits(false);
    const selected = boundedConversation(history, prompt, fast.historyChars);
    expect(selected[selected.length - 1]?.content).toBe(prompt);
    expect(selected.filter(row => row.content === prompt)).toHaveLength(1);
    expect(selected.slice(0, -1).reduce((size, row) => size + row.content.length, 0)).toBeLessThanOrEqual(fast.historyChars);
    expect(fast.sourceChars).toBeLessThan(balanced.sourceChars);
    expect(selected.length).toBeLessThan(boundedConversation(history, prompt, balanced.historyChars).length);
  });
});
