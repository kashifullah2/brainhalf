import { describe, it, expect, vi, afterEach } from 'vitest';
import { structuredLog } from '../lib/structured-log';

describe('structuredLog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls console.error for error level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    structuredLog('error', 'test_event', { foo: 'bar' });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('"level":"error"');
  });

  it('calls console.warn for warn level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    structuredLog('warn', 'test_event');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('"level":"warn"');
  });

  it('calls console.log for info level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    structuredLog('info', 'test_event');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('"level":"info"');
  });

  it('emits valid JSON containing ts, level, event, and extra fields', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    structuredLog('error', 'generation_outcome', { projectId: 'p1', status: 'failed', totalMs: 1234 });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(typeof parsed.ts).toBe('number');
    expect(parsed.level).toBe('error');
    expect(parsed.event).toBe('generation_outcome');
    expect(parsed.projectId).toBe('p1');
    expect(parsed.status).toBe('failed');
    expect(parsed.totalMs).toBe(1234);
  });

  it('works with no extra fields', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    structuredLog('info', 'ping');
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.event).toBe('ping');
    spy.mockRestore();
  });

  it('ts is a recent epoch millisecond timestamp', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const before = Date.now();
    structuredLog('info', 'ts_test');
    const after = Date.now();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.ts).toBeGreaterThanOrEqual(before);
    expect(parsed.ts).toBeLessThanOrEqual(after);
  });
});
