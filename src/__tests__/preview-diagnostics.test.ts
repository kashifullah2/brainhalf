import { describe, expect, it } from 'vitest';
import {
  diagnosePreviewError,
  extractFileFromError,
  detectLayerFromError,
  sanitizeErrorForDisplay,
  plainPreviewError,
} from '../lib/preview-diagnostics';

describe('diagnosePreviewError', () => {
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

  it('classifies dependency loading failures as network', () => {
    const d = diagnosePreviewError('Dependency loading failed: Failed to fetch dynamically imported module: https://esm.sh/lucide-react@1.43.0');
    expect(d.category).toBe('network');
    expect(d.likelyCause).toMatch(/package|cdn/i);
  });

  it('classifies syntax errors', () => {
    const d = diagnosePreviewError('Unexpected token < at line 12');
    expect(d.category).toBe('syntax');
  });

  it('classifies missing variable as reference error', () => {
    const d = diagnosePreviewError('ProductGrid is not defined');
    expect(d.category).toBe('reference');
  });

  it('returns unknown for unrecognised errors', () => {
    const d = diagnosePreviewError('Some completely unrecognised error format XYZ');
    expect(d.category).toBe('unknown');
  });
});

describe('extractFileFromError', () => {
  it('returns empty string when no file path can be found', () => {
    expect(extractFileFromError('The preview failed to load.')).toBe('');
    expect(extractFileFromError('')).toBe('');
    expect(extractFileFromError('Something went wrong')).toBe('');
  });

  it('never fabricates /src/App.tsx', () => {
    const result = extractFileFromError('The preview failed to load.');
    expect(result).not.toBe('/src/App.tsx');
  });

  it('extracts /src/ file path from "at" stack frame', () => {
    const err = '[Frontend Error] TypeError at /src/components/ProductGrid.tsx:12:5';
    expect(extractFileFromError(err)).toBe('/src/components/ProductGrid.tsx');
  });

  it('extracts path from Cannot find module error', () => {
    const err = "Cannot find module './components/Header' from '/src/App.tsx'";
    expect(extractFileFromError(err)).toBeTruthy();
  });

  it('extracts /worker/ path for backend errors', () => {
    const err = 'SyntaxError in /worker/index.ts at line 45';
    expect(extractFileFromError(err)).toBe('/worker/index.ts');
  });

  it('extracts /migrations/ path', () => {
    const err = 'Error applying /migrations/0001_items.sql: no such table';
    expect(extractFileFromError(err)).toBe('/migrations/0001_items.sql');
  });
});

describe('detectLayerFromError', () => {
  it('returns frontend for generic JS errors', () => {
    expect(detectLayerFromError('ProductGrid is not defined')).toBe('frontend');
    expect(detectLayerFromError('Cannot read properties of undefined')).toBe('frontend');
    expect(detectLayerFromError('Unexpected token')).toBe('frontend');
  });

  it('returns backend for D1/database errors', () => {
    expect(detectLayerFromError('D1_ERROR: no such table users')).toBe('backend');
    expect(detectLayerFromError('SQL error: syntax error near SELECT')).toBe('backend');
    expect(detectLayerFromError('database connection failed')).toBe('backend');
    expect(detectLayerFromError('no such table items')).toBe('backend');
  });

  it('returns backend for worker/server path errors', () => {
    expect(detectLayerFromError('[Backend Error] /worker/index.ts crashed')).toBe('backend');
    expect(detectLayerFromError('Error in /server/routes.ts')).toBe('backend');
  });

  it('returns backend for workers runtime errors', () => {
    expect(detectLayerFromError('workers runtime exception')).toBe('backend');
  });

  it('returns frontend by default when layer is ambiguous', () => {
    expect(detectLayerFromError('The preview failed to load.')).toBe('frontend');
    expect(detectLayerFromError('')).toBe('frontend');
  });
});

describe('sanitizeErrorForDisplay', () => {
  it('passes through normal error messages unchanged', () => {
    const err = 'ProductGrid is not defined at /src/App.tsx:12';
    expect(sanitizeErrorForDisplay(err)).toBe(err);
  });

  it('redacts bearer tokens', () => {
    const err = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig failed';
    const result = sanitizeErrorForDisplay(err);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result).toContain('[redacted]');
  });

  it('redacts API key query parameters', () => {
    const err = 'Failed to fetch https://api.example.com/data?api_key=sk-secret123456';
    const result = sanitizeErrorForDisplay(err);
    expect(result).not.toContain('sk-secret123456');
    expect(result).toContain('[redacted]');
  });

  it('redacts long base64 blobs', () => {
    const longBase64 = 'A'.repeat(80);
    const err = `Error processing token ${longBase64} in request`;
    const result = sanitizeErrorForDisplay(err);
    expect(result).not.toContain(longBase64);
    expect(result).toContain('[encoded-data]');
  });

  it('truncates very long error messages', () => {
    const longErr = 'x'.repeat(1000);
    expect(sanitizeErrorForDisplay(longErr).length).toBeLessThanOrEqual(600);
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeErrorForDisplay('')).toBe('');
  });
});

describe('plainPreviewError', () => {
  it('gives a frontend-specific message for react-render errors', () => {
    const d = diagnosePreviewError('element type is invalid');
    const msg = plainPreviewError(d, 'frontend');
    expect(msg).toMatch(/your app/i);
    expect(msg).not.toMatch(/backend/i);
  });

  it('gives a backend-specific message for backend layer', () => {
    const d = diagnosePreviewError('something unknown');
    const msg = plainPreviewError(d, 'backend');
    expect(msg).toMatch(/backend/i);
  });

  it('always includes a call to action', () => {
    const categories = ['react-render', 'reference', 'syntax', 'network', 'unknown'] as const;
    for (const category of categories) {
      const msg = plainPreviewError({ category, likelyCause: '', suggestedFix: '' }, 'frontend');
      expect(msg.length).toBeGreaterThan(10);
    }
  });
});
