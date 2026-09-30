import { describe, expect, it } from 'vitest';
import { resolvePublishDialogStep } from '../components/PublishDialog';

describe('resolvePublishDialogStep', () => {
  it('shows the cancelled screen after a stop, even with an older release (M7)', () => {
    // The old condition treated any non-failed job as success when a release
    // existed, so cancelling a re-publish displayed the previous success.
    expect(resolvePublishDialogStep({
      showNameStep: false, showPublishing: false, release: true, jobStatus: 'stopped',
    })).toBe('stopped');
  });

  it('shows success for a passed job or the idle published state', () => {
    expect(resolvePublishDialogStep({
      showNameStep: false, showPublishing: false, release: true, jobStatus: 'passed',
    })).toBe('success');
    expect(resolvePublishDialogStep({
      showNameStep: false, showPublishing: false, release: true, jobStatus: undefined,
    })).toBe('success');
  });

  it('shows failed for a failed job even when a release exists', () => {
    expect(resolvePublishDialogStep({
      showNameStep: false, showPublishing: false, release: true, jobStatus: 'failed',
    })).toBe('failed');
  });

  it('prioritises the name step and the publishing state', () => {
    expect(resolvePublishDialogStep({
      showNameStep: true, showPublishing: false, release: true, jobStatus: 'stopped',
    })).toBe('name');
    expect(resolvePublishDialogStep({
      showNameStep: false, showPublishing: true, release: true, jobStatus: 'stopped',
    })).toBe('publishing');
  });

  it('falls back to idle with no release and no terminal job', () => {
    expect(resolvePublishDialogStep({
      showNameStep: false, showPublishing: false, release: false, jobStatus: undefined,
    })).toBe('idle');
    expect(resolvePublishDialogStep({
      showNameStep: false, showPublishing: false, release: false, jobStatus: 'passed',
    })).toBe('idle');
  });
});
