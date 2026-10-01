import { describe, expect, it } from 'vitest';
import { formatMessageTime } from '../components/ChatPanel';

/**
 * B11: chat timestamps must carry the viewer's explicit timezone abbreviation,
 * so a timestamp can never silently disagree with the reader's clock.
 */
describe('B11: formatMessageTime', () => {
  it('returns null for missing or invalid timestamps', () => {
    expect(formatMessageTime(undefined)).toBeNull();
    expect(formatMessageTime(NaN)).toBeNull();
    expect(formatMessageTime(Infinity)).toBeNull();
  });

  it('includes an explicit timezone abbreviation', () => {
    // 2026-10-01 12:00 UTC — the abbreviation depends on the test runner's TZ,
    // but some zone label must always be present.
    const label = formatMessageTime(Date.UTC(2026, 9, 1, 12, 0, 0));
    expect(label).toBeTruthy();
    // e.g. "Oct 1, 12:00 PM GMT+5" or "Oct 1, 7:00 AM EDT" — always ends with a zone.
    expect(label).toMatch(/(GMT[+-]\d+|[A-Z]{2,5})$/);
  });

  it('formats a known instant consistently', () => {
    const label = formatMessageTime(Date.UTC(2026, 9, 1, 12, 0, 0));
    expect(label).toContain('Oct 1');
  });
});
