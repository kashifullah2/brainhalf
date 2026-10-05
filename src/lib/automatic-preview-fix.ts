import { useEffect, useRef } from 'react';
import { appEvents } from './events';
import { RepairBudget } from './repair-budget';

type PreviewIssue = { error: string; plainExplanation: string; file: string; layer: string };

const previewRepairBudget = new RepairBudget();

/**
 * When the preview iframe errors out after generation completes, automatically
 * emit an auto-fix-error event so the agent repairs the problem without the
 * user clicking "Ask the builder to fix".
 *
 * Guards:
 * - Only fires when generation is NOT active (mid-generation errors are expected)
 * - Only fires once per distinct error (deduped by normalized error string)
 * - RepairBudget caps at 3 repairs / project / 5 min, 2 for same error pattern
 * - 2-second debounce: transient errors during HMR settle before firing
 * - Will not fire if user has already dismissed or the error self-healed
 */
export function useAutomaticPreviewFix(
  projectId: string,
  previewIssue: PreviewIssue | null,
  isGenerating: boolean,
  previewLoadState: string,
  onFiring?: () => void,
) {
  const lastFiredError = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastFiredError.current = '';
  }, [projectId]);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (
      !previewIssue ||
      isGenerating ||
      previewLoadState !== 'error'
    ) return;

    const errorKey = previewIssue.error.replace(/\b\d+\b/g, '#').slice(0, 500);
    if (errorKey === lastFiredError.current) return;

    if (!previewRepairBudget.take(projectId, previewIssue.error)) return;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      lastFiredError.current = errorKey;
      onFiring?.();
      appEvents.emit('auto-fix-error', {
        projectId,
        error: previewIssue.error,
        file: previewIssue.file,
        layer: previewIssue.layer as 'backend' | 'frontend',
      });
    }, 2000);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [projectId, previewIssue, isGenerating, previewLoadState, onFiring]);
}
