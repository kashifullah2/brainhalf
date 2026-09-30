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
  const fullMessage = 'Your account has reached its hosted app limit (10 apps). Remove an app you no longer use to make room.';
  it('renders the dedicated full-account state instead of generic failure copy', () => {
    const html = renderToStaticMarkup(
      <DesignPreviewStrip
        backend={mockBackend({ failed: true, canStart: true, message: fullMessage })}
        runtime={idleRuntime}
        status="Ready"
        filesRef={filesRef}
        onOpenHostedSlots={() => {}}
      />
    );
    expect(html).toContain('has-fault');
    expect(html).toContain('Your 10 app spaces are full.');
    expect(html).toContain('Remove an app you don\u2019t use anymore');
    expect(html).toContain('Choose an app to remove');
    expect(html).toContain('Try again');
    // The generic failure copy must not appear for a full account: the user
    // must act, so "nothing for you to fix" would be the opposite of the truth.
    expect(html).not.toContain('The app preview ran into a problem.');
    expect(html).not.toContain('Nothing for you to fix');
    expect(html).not.toContain('Something unexpected came up');
    expect(html).not.toContain('Technical details');
    expect(html).not.toContain('Retry app preview');
  });
  it('detects the full account from a runtime error even before the job fails', () => {
    const html = renderToStaticMarkup(
      <DesignPreviewStrip
        backend={mockBackend({ canStart: true })}
        runtime={{ error: fullMessage, status: null }}
        status="Ready"
        filesRef={filesRef}
      />
    );
    expect(html).toContain('Your 10 app spaces are full.');
    expect(html).toContain('Choose an app to remove');
  });
  it('still matches the older backend wording during rollout', () => {
    const html = renderToStaticMarkup(
      <DesignPreviewStrip
        backend={mockBackend({ failed: true, canStart: true, message: 'Your account has reached its hosted project limit. Remove an unused hosted project before publishing another.' })}
        runtime={idleRuntime}
        status="Ready"
        filesRef={filesRef}
      />
    );
    expect(html).toContain('Your 10 app spaces are full.');
    expect(html).not.toContain('Nothing for you to fix');
  });
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
