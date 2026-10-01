/**
 * B2/B3: Backend preview failure persistence.
 *
 * When the "Start app preview" backend job fails, the failure must stay
 * visible. The runtime status jobs list can prune finished jobs; without
 * remembering the failure, the health strip would silently revert to
 * "start the preview" as if nothing happened — exactly the QA symptom
 * where "Building your app…" vanished and the backend never came up.
 *
 * Pure functions so the rule is unit-testable without the React hook.
 */

export interface PreviewJob {
  id: string;
  status: string;
  message?: string;
}

export interface BackendFailureInput {
  latestJob: PreviewJob | undefined;
  ready: boolean;
  activeJob: boolean;
  /** Previously remembered failure, if any. */
  lastFailure: { jobId: string; message: string } | null;
}

export interface BackendFailureResult {
  /** The failure to remember going forward (null clears it). */
  nextLastFailure: { jobId: string; message: string } | null;
  /** Whether the UI should show the failed state. */
  failed: boolean;
  /** Message to display for the failure, if any. */
  failureMessage: string | null;
}

export function resolveBackendFailure(input: BackendFailureInput): BackendFailureResult {
  const { latestJob, ready, activeJob, lastFailure } = input;
  let nextLastFailure = lastFailure;

  if (latestJob?.status === 'failed' && latestJob.message) {
    if (lastFailure?.jobId !== latestJob.id) {
      nextLastFailure = { jobId: latestJob.id, message: latestJob.message };
    }
  } else if (ready) {
    nextLastFailure = null;
  }

  // A remembered failure survives job-list pruning, but only while nothing
  // is actively running and the backend isn't ready.
  const rememberedFailure =
    !ready && !activeJob && nextLastFailure
      ? nextLastFailure.message
      : null;

  const failed = Boolean((latestJob && latestJob.status === 'failed') || rememberedFailure);
  const failureMessage =
    latestJob?.status === 'failed' && latestJob.message
      ? latestJob.message
      : rememberedFailure;

  return { nextLastFailure, failed, failureMessage };
}
