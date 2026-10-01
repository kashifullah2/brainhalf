import { describe, it, expect } from 'vitest';
import { PREVIEW_SANDBOX } from '../lib/preview-isolation';

describe('admin preview sandbox', () => {
  it('omits allow-same-origin so the preview gets an opaque origin', () => {
    expect(PREVIEW_SANDBOX).not.toContain('allow-same-origin');
  });

  it('allows scripts so the preview can run', () => {
    expect(PREVIEW_SANDBOX).toContain('allow-scripts');
  });
});

describe('preview-main isolation gate', () => {
  it('requires window.origin to be null (opaque origin)', async () => {
    const source = await import('../preview-main.tsx?raw').catch(() => null);
    // Fallback: read the file directly if raw import is unavailable.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const text = source?.default ?? fs.readFileSync(path.resolve(__dirname, '../preview-main.tsx'), 'utf8');
    expect(text).toContain("window.origin === 'null'");
    expect(text).toContain('Preview refused: an isolated execution origin is required.');
  });
});
