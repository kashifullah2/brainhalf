import { Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FileProgress } from './BuildProgress';

/**
 * GenerationProgress — the top-bar file progress during generation.
 * 
 * FIX: Uses fileProgress as the SINGLE SOURCE OF TRUTH for all counters.
 * Previously, `files.length` and `Object.keys(progress).length` could diverge,
 * showing "7 of 14 files written" (top) vs "8/8 files" (center) vs "14 files" (footer).
 * Now all values derive from fileProgress entries only.
 */
export default function GenerationProgress({
  files,
  progress,
}: {
  files: string[];
  progress: FileProgress;
}) {
  // Single source of truth: combine known files and active progress keys
  const progressKeys = Object.keys(progress);
  const allPaths = [...new Set([...progressKeys, ...(files || [])])];
  const total = allPaths.length;
  const savedFiles = allPaths.filter(f => progress[f] === 'saved' || (!progressKeys.includes(f) && progress[f] !== 'writing'));
  const saved = savedFiles.length;
  const writingEntries = allPaths.filter(f => progress[f] === 'writing');
  const currentFile = writingEntries[0];

  // Track the last few saved files for a brief checkmark flash.
  const [flashFiles, setFlashFiles] = useState<string[]>([]);
  const prevSavedRef = useRef<Set<string>>(new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const prevSaved = prevSavedRef.current;
    const newlySaved = savedFiles.filter(f => !prevSaved.has(f));
    prevSavedRef.current = new Set(savedFiles);
    if (newlySaved.length === 0) return;
    setFlashFiles(prev => [...prev, ...newlySaved].slice(-3));
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashFiles([]), 2000);
    return () => clearTimeout(flashTimer.current);
  }, [savedFiles.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = total > 0 ? Math.round((saved / total) * 100) : 0;
  const label = currentFile
    ? currentFile.split('/').pop()!
    : saved > 0
    ? `${saved} of ${total} files written`
    : 'Creating your app…';

  return (
    <div className="bh-gen-progress" role="status" aria-label={`Generation progress: ${label}`} aria-live="polite">
      {/* Determinate progress rail */}
      <div className="bh-gen-progress-rail" aria-hidden="true">
        <div
          className="bh-gen-progress-fill"
          style={{ width: pct > 0 ? `${pct}%` : undefined }}
        />
        {/* Keep the indeterminate pulse when pct is 0 */}
        {pct === 0 && <div className="bh-indeterminate-bar bh-gen-indeterminate" />}
      </div>

      {/* Animated label strip */}
      <div className="bh-gen-progress-strip">
        <span className="bh-gen-progress-label">
          {currentFile ? (
            <>
              <Loader2 size={12} className="lucide-spin" aria-hidden="true" />
              <span key={currentFile} className="bh-gen-filename bh-gen-filename-anim">
                {label}
              </span>
            </>
          ) : (
            <span className="bh-gen-filename">{label}</span>
          )}
        </span>

        {/* Recent saves flash */}
        {flashFiles.length > 0 && (
          <span className="bh-gen-progress-flash" aria-hidden="true">
            {flashFiles.map(f => (
              <span key={f} className="bh-gen-flash-item">
                <Check size={10} strokeWidth={2.5} />
                {f.split('/').pop()}
              </span>
            ))}
          </span>
        )}

        {total > 0 && (
          <span className="bh-gen-progress-count" aria-hidden="true">
            {pct}%
          </span>
        )}
      </div>
    </div>
  );
}
