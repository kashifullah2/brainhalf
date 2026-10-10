import { describe, expect, it, vi } from 'vitest';
import { writeGenerationEvent, writeAuthEvent } from '../lib/cf-analytics';
import type { AnalyticsDataset, GenerationEvent, AuthEvent } from '../lib/cf-analytics';

function makeDataset(): { dataset: AnalyticsDataset; calls: Parameters<AnalyticsDataset['writeDataPoint']>[] } {
  const calls: Parameters<AnalyticsDataset['writeDataPoint']>[] = [];
  return { dataset: { writeDataPoint: (e) => calls.push([e]) }, calls };
}

const baseGeneration: GenerationEvent = {
  userId: 'usr_test',
  modelId: '@cf/deepseek-ai/deepseek-v4-flash-0731',
  status: 'completed',
  promptCategory: 'build',
  repairTypes: [],
  ttftMs: 1200,
  totalMs: 30000,
  inputTokens: 5000,
  outputTokens: 8000,
  filesWritten: 12,
  repairCount: 0,
  providerCalls: 1,
};

describe('writeGenerationEvent', () => {
  it('writes correct blobs and doubles on success', () => {
    const { dataset, calls } = makeDataset();
    writeGenerationEvent(dataset, baseGeneration);
    expect(calls).toHaveLength(1);
    const [{ blobs, doubles, indexes }] = calls[0];
    expect(blobs?.[0]).toBe('generation');
    expect(blobs?.[1]).toBe('@cf/deepseek-ai/deepseek-v4-flash-0731');
    expect(blobs?.[2]).toBe('completed');
    expect(blobs?.[3]).toBe('build');
    expect(blobs?.[4]).toBe('');
    expect(doubles?.[0]).toBe(1200);   // ttft_ms
    expect(doubles?.[1]).toBe(30000);  // total_ms
    expect(doubles?.[2]).toBe(5000);   // input_tokens
    expect(doubles?.[3]).toBe(8000);   // output_tokens
    expect(doubles?.[4]).toBe(12);     // files_written
    expect(doubles?.[5]).toBe(0);      // repair_count
    expect(doubles?.[6]).toBe(1);      // provider_calls
    expect(indexes?.[0]).toBe('usr_test');
  });

  it('encodes repair_types as comma-separated string', () => {
    const { dataset, calls } = makeDataset();
    writeGenerationEvent(dataset, { ...baseGeneration, repairTypes: ['truncation', 'syntax'] });
    expect(calls[0][0].blobs?.[4]).toBe('truncation,syntax');
  });

  it('writes failed status', () => {
    const { dataset, calls } = makeDataset();
    writeGenerationEvent(dataset, { ...baseGeneration, status: 'failed' });
    expect(calls[0][0].blobs?.[2]).toBe('failed');
  });

  it('is a no-op when dataset is null', () => {
    expect(() => writeGenerationEvent(null, baseGeneration)).not.toThrow();
  });

  it('is a no-op when dataset is undefined', () => {
    expect(() => writeGenerationEvent(undefined, baseGeneration)).not.toThrow();
  });

  it('swallows errors from a throwing dataset', () => {
    const bad: AnalyticsDataset = { writeDataPoint: () => { throw new Error('AE unavailable'); } };
    expect(() => writeGenerationEvent(bad, baseGeneration)).not.toThrow();
  });
});

describe('writeAuthEvent', () => {
  const baseAuth: AuthEvent = { userId: 'usr_abc', method: 'google', status: 'ok' };

  it('writes event type auth and correct method in blobs', () => {
    const { dataset, calls } = makeDataset();
    writeAuthEvent(dataset, baseAuth);
    const [{ blobs, indexes }] = calls[0];
    expect(blobs?.[0]).toBe('auth');
    expect(blobs?.[2]).toBe('ok');
    expect(blobs?.[5]).toBe('google');
    expect(indexes?.[0]).toBe('usr_abc');
  });

  it('writes email method correctly', () => {
    const { dataset, calls } = makeDataset();
    writeAuthEvent(dataset, { userId: 'usr_x', method: 'email', status: 'ok' });
    expect(calls[0][0].blobs?.[5]).toBe('email');
  });

  it('is a no-op when dataset is null', () => {
    expect(() => writeAuthEvent(null, baseAuth)).not.toThrow();
  });

  it('swallows errors from a throwing dataset', () => {
    const bad: AnalyticsDataset = { writeDataPoint: () => { throw new Error('down'); } };
    expect(() => writeAuthEvent(bad, baseAuth)).not.toThrow();
  });
});
