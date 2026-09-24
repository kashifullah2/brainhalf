import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingChatRequest } from '../lib/pending-chat-request';

describe('Pending chat request lifecycle', () => {
  afterEach(() => vi.useRealTimers());

  it('allows only one send across competing connection and fallback callbacks', () => {
    const request = new PendingChatRequest();
    const send = vi.fn();
    expect(request.send(send)).toBe(true);
    expect(request.send(send)).toBe(false);
    expect(send).toHaveBeenCalledExactlyOnceWith(request.idempotencyKey);
  });

  it('cancels delayed sends and context listeners when stopped', () => {
    vi.useFakeTimers();
    const request = new PendingChatRequest();
    const send = vi.fn();
    const unsubscribe = vi.fn();
    const timer = setTimeout(() => request.send(send), 500);
    request.onCleanup(unsubscribe);
    request.onCleanup(() => clearTimeout(timer));

    request.cancel();
    vi.runAllTimers();
    request.send(send);

    expect(send).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(request.pending).toBe(false);
  });

  it('cleans up immediately after synchronous context delivery', () => {
    const request = new PendingChatRequest();
    const cleanup = vi.fn();
    request.send(() => {});
    request.onCleanup(cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('uses different idempotency keys for separate prompts', () => {
    expect(new PendingChatRequest().idempotencyKey).not.toBe(new PendingChatRequest().idempotencyKey);
  });

  it('expires a stalled workspace handshake and prevents a late model request', () => {
    vi.useFakeTimers();
    const request = new PendingChatRequest();
    const expired = vi.fn(); const send = vi.fn(); const cleanup = vi.fn();
    request.onCleanup(cleanup); request.expireAfter(30_000, expired);
    vi.advanceTimersByTime(29_999); expect(request.pending).toBe(true);
    vi.advanceTimersByTime(1);
    expect(expired).toHaveBeenCalledOnce(); expect(cleanup).toHaveBeenCalledOnce();
    expect(request.send(send)).toBe(false); expect(send).not.toHaveBeenCalled();
  });

  it.each(['send', 'cancel'] as const)('removes the handshake deadline after %s', action => {
    vi.useFakeTimers();
    const request = new PendingChatRequest(); const expired = vi.fn();
    request.expireAfter(30_000, expired);
    if (action === 'send') request.send(() => {}); else request.cancel();
    vi.advanceTimersByTime(60_000);
    expect(expired).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
