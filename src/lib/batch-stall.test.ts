import { describe, expect, it } from 'vitest';

import { BATCH_STALL_AFTER_MS, isBatchInFlight, isBatchStalled } from './batch-status';

// Extraction runs in the browser tab that started it. Closing that tab leaves
// documents at 'queued' and the batch at 'processing' with nothing to move them --
// and both dashboards polled that state every few seconds, forever. These pin the
// predicate that stops it.
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('isBatchInFlight', () => {
  it('is true only for the two statuses that imply work outstanding', () => {
    expect(isBatchInFlight({ status: 'processing' })).toBe(true);
    expect(isBatchInFlight({ status: 'queued' })).toBe(true);
    for (const status of ['completed', 'failed', 'partial', '']) {
      expect(isBatchInFlight({ status })).toBe(false);
    }
  });
});

describe('isBatchStalled', () => {
  it('is false for a batch that was touched moments ago', () => {
    expect(isBatchStalled({ status: 'processing', updatedAt: ago(1_000) })).toBe(false);
  });

  it('is false through a slow document, not just a fast one', () => {
    // One document can spend 60s upstream and then 60s again on an escalation
    // re-read, so a couple of minutes of silence is normal rather than abandoned.
    expect(isBatchStalled({ status: 'processing', updatedAt: ago(3 * 60_000) })).toBe(false);
  });

  it('is true once nothing has touched it for longer than the window', () => {
    expect(
      isBatchStalled({ status: 'processing', updatedAt: ago(BATCH_STALL_AFTER_MS + 1_000) }),
    ).toBe(true);
    expect(
      isBatchStalled({ status: 'queued', updatedAt: ago(24 * 60 * 60_000) }),
    ).toBe(true);
  });

  it('never calls a finished batch stalled, however old it is', () => {
    for (const status of ['completed', 'failed', 'partial']) {
      expect(isBatchStalled({ status, updatedAt: ago(365 * 24 * 60 * 60_000) })).toBe(false);
    }
  });

  it('does not claim a stall it cannot prove from an unparseable timestamp', () => {
    // Guessing here would put a resume banner over a batch that is running fine.
    for (const updatedAt of ['', 'not a date', 'undefined']) {
      expect(isBatchStalled({ status: 'processing', updatedAt })).toBe(false);
    }
  });
});
