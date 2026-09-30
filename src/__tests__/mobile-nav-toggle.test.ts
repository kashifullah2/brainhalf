import { describe, expect, it } from 'vitest';
import { shouldCloseMenuOnPointerDown } from '../components/MobileNav';

describe('shouldCloseMenuOnPointerDown', () => {
  it('closes when the press is truly outside the menu and the toggle button', () => {
    expect(shouldCloseMenuOnPointerDown(false, false)).toBe(true);
  });

  it('stays open when the press lands inside the menu', () => {
    expect(shouldCloseMenuOnPointerDown(true, false)).toBe(false);
  });

  it('does not treat the toggle button as an outside press (M5)', () => {
    // The old handler treated the hamburger as "outside": mousedown closed the
    // menu and the button's click then reopened it, so the menu could never be
    // closed via the button.
    expect(shouldCloseMenuOnPointerDown(false, true)).toBe(false);
    expect(shouldCloseMenuOnPointerDown(true, true)).toBe(false);
  });
});
