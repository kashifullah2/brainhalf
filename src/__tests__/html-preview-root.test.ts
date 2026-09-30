import { describe, expect, it } from 'vitest';
import { createPreviewFailureTracker, renameShellRootForPreview } from '../components/HtmlPreview';

/**
 * L12: HtmlPreview renames the app shell's #root for the preview session and
 * must restore it on cleanup, otherwise the shell's own `html, body, #root`
 * rules stop applying. The helper is tested with a minimal host stub because
 * the unit suite has no DOM environment; it exercises the real rename/restore
 * logic, not the React effect wiring.
 */
function stubHost(root: { id: string } | null) {
  return {
    closest: (selector: string) => (selector === '#root' ? root : null),
  } as unknown as HTMLElement;
}

describe('renameShellRootForPreview', () => {
  it('renames #root for the preview and restores it on cleanup', () => {
    const root = { id: 'root' };
    const restore = renameShellRootForPreview(stubHost(root));
    expect(root.id).toBe('brainhalf-preview-root');
    restore();
    expect(root.id).toBe('root');
  });

  it('restores the exact previous id rather than assuming "root"', () => {
    const root = { id: 'root' };
    const restore = renameShellRootForPreview(stubHost(root));
    // Something else renames it mid-preview; cleanup must still put back the
    // id that was there when the preview started.
    root.id = 'something-else';
    restore();
    expect(root.id).toBe('root');
  });

  it('is a no-op when the host is not inside a #root', () => {
    const restore = renameShellRootForPreview(stubHost(null));
    expect(() => restore()).not.toThrow();
  });
});

/**
 * N1: the first page error halts the remaining preview scripts, but the halt
 * must be surfaced — previously the preview stalled with no error and no
 * completion signal.
 */
describe('createPreviewFailureTracker', () => {
  const errorEvent = (message: string) => ({ message } as unknown as ErrorEvent);
  const rejection = (reason: unknown) => ({ reason } as unknown as PromiseRejectionEvent);

  it('does not stop the run before any error', () => {
    const reported: string[] = [];
    const tracker = createPreviewFailureTracker(message => reported.push(message));
    expect(tracker.checkFailed()).toBe(false);
    expect(tracker.hasFailed()).toBe(false);
    expect(reported).toEqual([]);
  });

  it('halts the run and reports the first error exactly once', () => {
    const reported: string[] = [];
    const tracker = createPreviewFailureTracker(message => reported.push(message));
    tracker.markFailed(errorEvent('script boom'));
    expect(tracker.hasFailed()).toBe(true);
    expect(tracker.checkFailed()).toBe(true);
    expect(tracker.checkFailed()).toBe(true);
    expect(reported).toEqual(['script boom']);
  });

  it('keeps the first error when later ones arrive', () => {
    const reported: string[] = [];
    const tracker = createPreviewFailureTracker(message => reported.push(message));
    tracker.markFailed(errorEvent('first'));
    tracker.markFailed(errorEvent('second'));
    tracker.checkFailed();
    expect(reported).toEqual(['first']);
  });

  it('reads the message from unhandled rejections', () => {
    const reported: string[] = [];
    const tracker = createPreviewFailureTracker(message => reported.push(message));
    tracker.markFailed(rejection(new Error('rejected promise')));
    tracker.checkFailed();
    expect(reported).toEqual(['rejected promise']);
  });

  it('stringifies a non-Error rejection reason instead of reporting [object Object]', () => {
    const reported: string[] = [];
    const tracker = createPreviewFailureTracker(message => reported.push(message));
    tracker.markFailed(rejection('plain string failure'));
    tracker.checkFailed();
    expect(reported).toEqual(['plain string failure']);
  });

  it('falls back to a generic message when the event carries nothing', () => {
    const reported: string[] = [];
    const tracker = createPreviewFailureTracker(message => reported.push(message));
    tracker.markFailed({} as unknown as ErrorEvent);
    tracker.checkFailed();
    expect(reported).toEqual(['Preview script failed']);
  });
});
