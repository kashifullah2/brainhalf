import React from 'react';
import { ArrowUpRight, Server } from 'lucide-react';
import { useAutomaticBackend } from '../lib/automatic-backend';
import { useProjectRuntime } from '../lib/project-runtime-client';
import { HOSTED_APP_LIMIT, isHostedLimitError } from '../lib/hosted-limit';

type Backend = ReturnType<typeof useAutomaticBackend>;
type Runtime = Pick<ReturnType<typeof useProjectRuntime>, 'error' | 'status'>;

/**
 * One plain sentence explaining a build failure to someone who has never
 * written code. The raw error ("ERESOLVE peerDependencies") stays behind the
 * "Technical details" expander; this is what non-technical users read first.
 */
const PLAIN_LANGUAGE_CAUSES: { pattern: RegExp; cause: string }[] = [
  { pattern: /ERESOLVE|ETARGET|Could not resolve|No matching version|notarget/i, cause: 'Some of the app\u2019s building blocks didn\u2019t fit together.' },
  { pattern: /network|fetch failed|request to|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i, cause: 'The internet hiccupped while fetching the app\u2019s building blocks.' },
  { pattern: /error TS\d+|Type error|Failed to resolve import|Transform failed|is not exported by|RollupError/i, cause: 'The app has a small code hiccup.' },
  { pattern: /out of memory|heap out of memory|JavaScript heap/i, cause: 'The app ran out of space while being put together.' },
];

export function plainLanguageCause(message: string): string {
  for (const { pattern, cause } of PLAIN_LANGUAGE_CAUSES) {
    if (pattern.test(message)) return cause;
  }
  return 'Something unexpected came up while putting the app together.';
}

/**
 * The "Design preview" health strip above the preview canvas. When the
 * development backend job fails, the strip becomes an actionable error state:
 * red styling (previously a failed build looked neutral), the short failure
 * title, the root-cause build output behind an expander, and a "Retry app
 * preview" button instead of "Start app preview".
 *
 * A full account (all hosted app spaces in use) gets its own dedicated state:
 * the generic "something came up" copy and the "nothing for you to fix"
 * advice are wrong there — the user must remove an app they no longer use —
 * so the strip names the problem and offers a one-tap route to the app
 * spaces manager plus a retry.
 */
export function DesignPreviewStrip({ backend, runtime, status, filesRef, onOpenHostedSlots }: {
  backend: Backend;
  runtime: Runtime;
  status: string;
  filesRef: { current: Record<string, string> };
  onOpenHostedSlots?: () => void;
}) {
  const failed = backend.failed;
  // A full account is a user-actionable state, not a build bug: name it and
  // route the user to the app-spaces manager instead of generic failure copy.
  // B3: the 429 can arrive BEFORE any job exists (register() gate), so the
  // hosted-limit message on backend.message must count even when failed=false.
  const hostedFull = isHostedLimitError(backend.message) || isHostedLimitError(runtime.error);
  // Only show for error/fault/hosted-full states — the idle "start app preview"
  // prompt is gone; the backend auto-starts and a building pill replaces it.
  if (!failed && !hostedFull && !backend.fault) return null;
  const body = failed
    ? null
    : backend.message
      || runtime.error
      || (runtime.status?.availability?.state !== 'ready' ? runtime.status?.availability?.message : '')
      || 'The backend encountered an issue.';

  return (
    <div className={`preview-health-strip${backend.fault || failed ? ' has-fault' : ''}`} role="status">
      <Server size={15} />
      <div className="preview-health-strip-body">
        <strong>Design preview</strong>
        {' · '}
        {hostedFull ? (
          <>Your {HOSTED_APP_LIMIT} app spaces are full.</>
        ) : failed ? 'The app preview ran into a problem.' : 'Start the app preview to test sign-in and saved data.'}
        <br />
        {hostedFull ? (
          <>
            Every account gets {HOSTED_APP_LIMIT} spaces for running apps, and yours are all in use, so this preview
            can’t start. Remove an app you don’t use anymore, then try again.
          </>
        ) : failed ? (
          <>
            {plainLanguageCause(backend.message)}{' '}
            Nothing for you to fix — describe what you want in the chat and BrainHalf will sort it out.
            <details className="preview-build-detail">
              <summary>Technical details</summary>
              <code>{backend.message || 'No additional details were recorded.'}</code>
            </details>
          </>
        ) : body}
      </div>
      {hostedFull ? (
        <>
          <button type="button" onClick={() => onOpenHostedSlots?.()}>
            Choose an app to remove
          </button>
          {backend.canStart && (
            <button type="button" disabled={status === 'Generating'} onClick={() => backend.start(filesRef.current, true)}>
              Try again
            </button>
          )}
        </>
      ) : (<>
      {backend.canStart && (
        <button type="button" disabled={status === 'Generating'} onClick={() => backend.start(filesRef.current, true)}>
          {failed ? 'Retry app preview' : 'Start app preview'}
        </button>
      )}
      {backend.canUpdate && (
        <button type="button" disabled={status === 'Generating'} onClick={() => backend.start(filesRef.current, true)}>
          Update app preview
        </button>
      )}
      {backend.ready && (
        <button type="button" onClick={() => void backend.open()}>
          Open app preview <ArrowUpRight size={13} />
        </button>
      )}
      </>)}
    </div>
  );
}
