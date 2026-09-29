import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DesignPreviewStrip, plainLanguageCause } from '../components/DesignPreviewStrip';
import { dedupeSegmentsByPath } from '../components/ChatPanel';
import type { useAutomaticBackend } from '../lib/automatic-backend';
import type { useProjectRuntime } from '../lib/project-runtime-client';

type Backend = ReturnType<typeof useAutomaticBackend>;
type Runtime = Pick<ReturnType<typeof useProjectRuntime>, 'error' | 'status'>;

function mockBackend(overrides: Partial<Backend>): Backend {
  return {
    start: () => {},
    open: async () => {},
    message: '',
    ready: false,
    fault: false,
    failed: false,
    liveUrl: null,
    canStart: false,
    canUpdate: false,
    ...overrides,
  } as Backend;
}

const idleRuntime: Runtime = { error: '', status: null };
const filesRef = { current: {} as Record<string, string> };

describe('plainLanguageCause', () => {
  it('translates a dependency conflict into everyday words', () => {
    expect(plainLanguageCause('Installing dependencies failed (exit 1). Build output: ERESOLVE Could not resolve peer vite'))
      .toBe('Some of the app\u2019s building blocks didn\u2019t fit together.');
  });
  it('translates a network failure into everyday words', () => {
    expect(plainLanguageCause('Installing dependencies failed (exit 1). Build output: fetch failed ENOTFOUND'))
      .toBe('The internet hiccupped while fetching the app\u2019s building blocks.');
  });
  it('translates a code error into everyday words', () => {
    expect(plainLanguageCause('Build failed. Build output: error TS2322: Type string is not assignable'))
      .toBe('The app has a small code hiccup.');
  });
  it('falls back to a generic friendly sentence for unknown failures', () => {
    expect(plainLanguageCause('Something odd happened')).toBe('Something unexpected came up while putting the app together.');
  });
});

describe('dedupeSegmentsByPath', () => {
  it('collapses repeated writes of the same path, keeping first-seen order', () => {
    const result = dedupeSegmentsByPath([
      { path: 'src/styles.css' },
      { path: 'src/App.tsx' },
      { path: 'src/styles.css' },
    ]);
    expect(result.map(item => item.path)).toEqual(['src/styles.css', 'src/App.tsx']);
  });
  it('keeps every distinct path', () => {
    const result = dedupeSegmentsByPath([{ path: 'a.css' }, { path: 'b.css' }]);
    expect(result).toHaveLength(2);
  });
});

describe('DesignPreviewStrip', () => {
  it('renders a failed build as an actionable error state', () => {
    const html = renderToStaticMarkup(
      <DesignPreviewStrip
        backend={mockBackend({
          failed: true,
          canStart: true,
          message: 'Installing dependencies failed (exit 1). Build output: ERESOLVE Could not resolve peer vite',
        })}
        runtime={idleRuntime}
        status="Ready"
        filesRef={filesRef}
      />
    );
    expect(html).toContain('has-fault');
    expect(html).toContain('The app preview ran into a problem.');
    expect(html).toContain('Some of the app\u2019s building blocks didn\u2019t fit together.');
    expect(html).toContain('Nothing for you to fix');
    expect(html).toContain('Retry app preview');
    expect(html).toContain('<details');
    expect(html).toContain('Technical details');
    expect(html).toContain('ERESOLVE Could not resolve peer vite');
    expect(html).not.toContain('Start app preview</button>');
  });
  it('renders the neutral start state when nothing has failed', () => {
    const html = renderToStaticMarkup(
      <DesignPreviewStrip
        backend={mockBackend({ canStart: true })}
        runtime={idleRuntime}
        status="Ready"
        filesRef={filesRef}
      />
    );
    expect(html).not.toContain('has-fault');
    expect(html).toContain('Start app preview');
    expect(html).not.toContain('Retry app preview');
    expect(html).not.toContain('<details');
  });
  it('keeps the fault styling when the backend reports a fault', () => {
    const html = renderToStaticMarkup(
      <DesignPreviewStrip
        backend={mockBackend({ fault: true, message: 'Managed hosting is currently unavailable.' })}
        runtime={idleRuntime}
        status="Ready"
        filesRef={filesRef}
      />
    );
    expect(html).toContain('has-fault');
    expect(html).toContain('Managed hosting is currently unavailable.');
  });
});
