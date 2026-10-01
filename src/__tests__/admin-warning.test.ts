import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * B13: the destructive-action warning must never be clipped. The original bug
 * was CSS clipping (overflow/ellipsis) cutting the warning text. This guards
 * the .admin-warning-box rules that keep it fully visible.
 */
describe('B13: admin warning box stays fully visible', () => {
  const css = readFileSync(join(__dirname, '../components/AdminPage.css'), 'utf8');
  const block = css.match(/\.admin-warning-box\s*\{([^}]+)\}/)?.[1] ?? '';

  it('defines the .admin-warning-box class', () => {
    expect(block.length).toBeGreaterThan(0);
  });

  it('never clips overflowing text', () => {
    expect(block).toMatch(/overflow\s*:\s*visible/);
    expect(block).not.toMatch(/text-overflow\s*:\s*ellipsis/);
  });

  it('wraps long warning text instead of single-lining it', () => {
    expect(block).toMatch(/white-space\s*:\s*normal/);
    expect(block).toMatch(/overflow-wrap\s*:\s*break-word/);
  });
});
