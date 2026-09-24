import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatModelReliability,
  getModelReliabilityStats,
  rankModelsByReliability,
  recordModelOutcome,
} from '../lib/model-reliability';

describe('model-reliability scoping', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
    });
  });

  it('isolates reliability stats by scope', () => {
    recordModelOutcome('model-a', 'success', undefined, 'user-a');
    recordModelOutcome('model-a', 'failure', 'timeout', 'user-b');

    expect(getModelReliabilityStats('model-a', 'user-a')).toMatchObject({ attempts: 1, successes: 1, failures: 0 });
    expect(getModelReliabilityStats('model-a', 'user-b')).toMatchObject({ attempts: 1, successes: 0, failures: 1 });
  });

  it('sorts model ranking independently per scope', () => {
    const models = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }];
    recordModelOutcome('x', 'success', undefined, 'u1');
    recordModelOutcome('y', 'failure', 'bad', 'u1');
    recordModelOutcome('x', 'failure', 'bad', 'u2');
    recordModelOutcome('y', 'success', undefined, 'u2');

    expect(rankModelsByReliability(models, 'u1')[0].id).toBe('x');
    expect(rankModelsByReliability(models, 'u2')[0].id).toBe('y');
  });

  it('formats scoped reliability text', () => {
    recordModelOutcome('m', 'success', undefined, 'scope-1');
    expect(formatModelReliability('m', 'scope-1')).toContain('100%');
    expect(formatModelReliability('m', 'scope-2')).toBe('No runs yet');
  });
});
