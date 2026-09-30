import { describe, expect, it, vi, beforeAll } from 'vitest';

let isTransientResolutionError: (error: string | null | undefined) => boolean;

beforeAll(async () => {
  // PreviewRunner touches `window` at module top level (window.fetch) and
  // the unit tests run in node, so stub the sliver it needs before importing.
  vi.stubGlobal('window', { fetch: () => Promise.reject(new Error('no network in tests')) });
  ({ isTransientResolutionError } = await import('../components/PreviewRunner'));
});

describe('isTransientResolutionError', () => {
  it("treats the preview loader's unresolved-local-import message as transient", () => {
    expect(
      isTransientResolutionError('Cannot resolve module "./components/LandingPage" imported from "/src/App.jsx"')
    ).toBe(true);
  });

  it('matches other resolution-failure phrasings with local specifiers', () => {
    expect(isTransientResolutionError("Cannot find module '@/data/title.json'")).toBe(true);
    expect(isTransientResolutionError("Module not found: './Foo'")).toBe(true);
    expect(isTransientResolutionError("Failed to resolve import '../utils/helpers'")).toBe(true);
    expect(isTransientResolutionError('Unknown file "/src/pages/Dashboard.jsx"')).toBe(true);
    expect(isTransientResolutionError('CANNOT RESOLVE MODULE "./X"')).toBe(true);
  });

  it('does NOT treat bare npm specifiers as transient (no later file sync can fix those)', () => {
    expect(
      isTransientResolutionError('Cannot resolve module "clsx" imported from "/src/App.jsx"')
    ).toBe(false);
    expect(
      isTransientResolutionError('Cannot resolve module "react-router-dom" imported from "/src/App.jsx"')
    ).toBe(false);
  });

  it('does NOT treat non-resolution errors as transient', () => {
    expect(isTransientResolutionError("Unexpected token (12:4)")).toBe(false);
    expect(
      isTransientResolutionError('App export is not a valid React component. Export a function/class component from App.')
    ).toBe(false);
    expect(isTransientResolutionError('No App component found in project.')).toBe(false);
    expect(isTransientResolutionError('[Backend Error] fetch failed')).toBe(false);
    expect(isTransientResolutionError('Transpilation error')).toBe(false);
  });

  it('handles empty input safely', () => {
    expect(isTransientResolutionError(null)).toBe(false);
    expect(isTransientResolutionError(undefined)).toBe(false);
    expect(isTransientResolutionError('')).toBe(false);
  });
});
