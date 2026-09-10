import { describe, it, expect, vi } from 'vitest';
import { appEvents } from '../lib/events';

describe('Event Emitter (appEvents)', () => {
  it('registers listeners and emits payloads', () => {
    const callback = vi.fn();
    const unsub = appEvents.on('test-event', callback);

    appEvents.emit('test-event', { message: 'hello' });
    expect(callback).toHaveBeenCalledWith({ message: 'hello' });

    unsub();
    appEvents.emit('test-event', { message: 'world' });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('supports multiple listeners on the same event', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const unsub1 = appEvents.on('multi-event', cb1);
    const unsub2 = appEvents.on('multi-event', cb2);

    appEvents.emit('multi-event', 42);
    expect(cb1).toHaveBeenCalledWith(42);
    expect(cb2).toHaveBeenCalledWith(42);

    unsub1();
    appEvents.emit('multi-event', 100);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledWith(100);

    unsub2();
  });

  it('does not throw when emitting an event with no listeners', () => {
    expect(() => {
      appEvents.emit('non-existent-event', { test: true });
    }).not.toThrow();
  });

  it('allows manual deregistration via off()', () => {
    const cb = vi.fn();
    appEvents.on('off-event', cb);
    appEvents.off('off-event', cb);

    appEvents.emit('off-event', 'data');
    expect(cb).not.toHaveBeenCalled();
  });

  it('isolates listener errors so other listeners still execute', () => {
    const brokenListener = vi.fn(() => {
      throw new Error('Listener failed');
    });
    const goodListener = vi.fn();

    appEvents.on('error-test', brokenListener);
    appEvents.on('error-test', goodListener);

    expect(() => {
      appEvents.emit('error-test', { status: 'ok' });
    }).not.toThrow();

    expect(brokenListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('handles a listener unregistering itself during emit without index skipping', () => {
    let unsubSelf: () => void;
    const selfRemoving = vi.fn(() => {
      unsubSelf();
    });
    const secondListener = vi.fn();

    unsubSelf = appEvents.on('self-remove', selfRemoving);
    appEvents.on('self-remove', secondListener);

    appEvents.emit('self-remove', 'first-call');
    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);

    appEvents.emit('self-remove', 'second-call');
    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(2);
  });
});
