import React from 'react';
import { ArrowUpRight, Server } from 'lucide-react';
import { useAutomaticBackend } from '../lib/automatic-backend';
import { useProjectRuntime } from '../lib/project-runtime-client';

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
  { pattern: /out of memory|heap out of memory|JavaScript heap/i, cause: 'The app ran out of workspace memory while building.' },
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
 */
export function DesignPreviewStrip({ backend, runtime, status, filesRef }: {
  backend: Backend;
  runtime: Runtime;
  status: string;
  filesRef: { current: Record<string, string> };
}) {
  const failed = backend.failed;
  const body = failed
    ? null
    : backend.message
      || runtime.error
      || (runtime.status?.availability?.state !== 'ready' ? runtime.status?.availability?.message : '')
      || 'Start your app preview to connect its backend.';

  return (
    <div className={`preview-health-strip${backend.fault || failed ? ' has-fault' : ''}`} role="status">
      <Server size={15} />
      <div className="preview-health-strip-body">
        <strong>Design preview</strong>
        {' · '}
        {failed ? 'The app preview ran into a problem.' : 'Start the app preview to test sign-in and saved data.'}
        <br />
        {failed ? (
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
    </div>
  );
}
