import { describe, expect, it } from 'vitest';
import { diagnosePreviewError } from '../lib/preview-diagnostics';

describe('preview diagnostics', () => {
  it('classifies React #130 as react-render import/export issue', () => {
    const d = diagnosePreviewError('Minified React error #130');
    expect(d.category).toBe('react-render');
    expect(d.likelyCause).toMatch(/import\/export/i);
  });

  it('classifies undefined access as react-render null safety issue', () => {
    const d = diagnosePreviewError("Cannot read properties of undefined (reading 'map')");
    expect(d.category).toBe('react-render');
    expect(d.suggestedFix).toMatch(/optional chaining|fallback/i);
  });

  it('classifies CORS/fetch failures as network issues', () => {
    const d = diagnosePreviewError('Failed to fetch due to CORS');
    expect(d.category).toBe('network');
  });
});

