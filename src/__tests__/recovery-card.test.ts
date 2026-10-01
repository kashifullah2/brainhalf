import { describe, expect, it } from 'vitest';
import {
  decideRecoveryCard,
  GENERIC_NO_RESPONSE_BODY,
} from '../lib/recovery-card';

/**
 * B1 regression tests: the "No response received" recovery card must never
 * offer a blind "Try again" when the workspace connection itself is dead.
 * A plain resend on a dead socket fails instantly and identically forever —
 * the card must name the cause and reconnect first.
 */
describe('decideRecoveryCard (B1)', () => {
  it('offers plain retry when there is no connection error', () => {
    const decision = decideRecoveryCard({ connectionError: null, isConnected: true });
    expect(decision.title).toBe('No response received');
    expect(decision.body).toBe(GENERIC_NO_RESPONSE_BODY);
    expect(decision.actionLabel).toBe('Try again');
    expect(decision.needsReconnect).toBe(false);
  });

  it('offers reconnect-first when the connection failed', () => {
    const decision = decideRecoveryCard({
      connectionError: 'Could not reach the workspace after several tries. Check your connection, then reconnect.',
      isConnected: false,
    });
    expect(decision.title).toBe('Connection problem');
    expect(decision.body).toContain('Could not reach the workspace');
    expect(decision.actionLabel).toBe('Reconnect & try again');
    expect(decision.needsReconnect).toBe(true);
  });

  it('surfaces the server rejection reason instead of the generic message', () => {
    const decision = decideRecoveryCard({
      connectionError: 'This project could not be opened. It may have been deleted or moved; pick it again from the dashboard.',
      isConnected: false,
    });
    expect(decision.body).not.toBe(GENERIC_NO_RESPONSE_BODY);
    expect(decision.body).toContain('could not be opened');
    expect(decision.needsReconnect).toBe(true);
  });

  it('falls back to plain retry if somehow connected despite a stale error', () => {
    // Defensive: a stale error must not trap the user on the reconnect path
    // once the socket is actually open.
    const decision = decideRecoveryCard({ connectionError: 'stale', isConnected: true });
    expect(decision.actionLabel).toBe('Try again');
    expect(decision.needsReconnect).toBe(false);
  });
});
