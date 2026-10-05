import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Loader2, Check, Sparkles, Database, Layout, Server, Shield, Palette, Code2, Zap } from 'lucide-react';
import type { FileProgress } from './BuildProgress';

/**
 * High-level build phases inferred from the files being generated.
 * Each phase has an icon, label, and a matcher that activates it
 * when a matching file path appears in the progress map.
 *
 * IMPORTANT: Phases are listed in logical order. The checklist enforces
 * sequential completion — a phase only shows "done" if every phase
 * before it is also done. This prevents the confusing state where
 * "Setting up database" is checked while "Scaffolding project" still spins.
 */
const BUILD_PHASES = [
  { id: 'scaffold', icon: Code2, label: 'Scaffolding project', match: /package\.json|tsconfig|vite\.config/i },
  { id: 'ui', icon: Layout, label: 'Building user interface', match: /\/(src|components|pages)\//i },
  { id: 'styles', icon: Palette, label: 'Designing visual styles', match: /\.(css|scss|styled)/i },
  { id: 'backend', icon: Server, label: 'Creating backend services', match: /\/(server|worker|api)\//i },
  { id: 'database', icon: Database, label: 'Setting up database', match: /\/(migrations|schema|database)/i },
  { id: 'auth', icon: Shield, label: 'Configuring authentication', match: /auth|login|signup/i },
  { id: 'wiring', icon: Zap, label: 'Connecting everything together', match: /\.(ts|tsx|jsx|js)$/i },
];

/** Friendly tips that rotate while the builder works. */
const BUILDER_TIPS = [
  'The builder is reviewing your requirements…',
  'Designing the architecture for your app…',
  'Writing clean, production-ready code…',
  'Setting up responsive layouts and modern UI…',
  "Your app will appear here once it's fully ready.",
  'Almost there — putting the finishing touches on your app…',
];

interface BuilderOverlayProps {
  /** True when the agent LLM is actively generating. */
  isGenerating: boolean;
  /** The file progress map from BuildProgress — single source of truth. */
  fileProgress: FileProgress;
  /** All file paths in the project. */
  files: string[];
  /** True when the preview iframe has loaded successfully. */
  previewReady: boolean;
  /** True when this is the very first generation (no app code exists yet). */
  isFirstGeneration: boolean;
}

/**
 * BuilderOverlay — a premium, full-screen overlay that covers the preview
 * canvas during the first generation. It shows abstracted, human-readable
 * progress steps instead of raw code/errors. The overlay only dismisses
 * when the generation is complete AND the preview is confirmed healthy.
 */
export default function BuilderOverlay({
  isGenerating,
  fileProgress,
  files,
  previewReady,
  isFirstGeneration,
}: BuilderOverlayProps) {
  const [tipIndex, setTipIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef(Date.now());
  const [latchedIsFirstGen, setLatchedIsFirstGen] = useState(isFirstGeneration);

  // Latch the first generation flag to true if we ever saw it true during generation
  useEffect(() => {
    if (isFirstGeneration) {
      setLatchedIsFirstGen(true);
    }
  }, [isFirstGeneration]);

  // Rotate tips — dynamic subtitle based on active build phase
  useEffect(() => {
    if (!isGenerating && !latchedIsFirstGen) return;
    const id = setInterval(() => setTipIndex(i => (i + 1) % BUILDER_TIPS.length), 4000);
    return () => clearInterval(id);
  }, [isGenerating, latchedIsFirstGen]);

  // Track elapsed time
  useEffect(() => {
    if (!latchedIsFirstGen) return;
    startTimeRef.current = Date.now();
    setElapsedSeconds(0);
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [latchedIsFirstGen]);

  // When generation finishes, mark completion time
  // FIX: Only mark as completed when generation is ACTUALLY done (isGenerating flips false),
  // not when scaffolding finishes. This prevents the "success" state from firing early.
  useEffect(() => {
    if (!isGenerating && latchedIsFirstGen && completedAt === null && Object.keys(fileProgress).length > 0) {
      setCompletedAt(Date.now());
    }
  }, [isGenerating, latchedIsFirstGen, completedAt, fileProgress]);

  // Auto-dismiss after generation completes AND preview is ready
  useEffect(() => {
    if (completedAt && previewReady) {
      const timer = setTimeout(() => setDismissed(true), 800); // brief reveal delay
      return () => clearTimeout(timer);
    }
  }, [completedAt, previewReady]);

  // Fallback: dismiss 15s after generation ends even if preview never confirms ready
  // (handles cases where the iframe crashes on load or never sends preview-ready)
  useEffect(() => {
    if (!completedAt) return;
    const timer = setTimeout(() => setDismissed(true), 15000);
    return () => clearTimeout(timer);
  }, [completedAt]);

  // Reset when starting a new generation — clears stale "success" when a new build starts
  useEffect(() => {
    if (latchedIsFirstGen && isGenerating) {
      setDismissed(false);
      setCompletedAt(null);
      setElapsedSeconds(0);
      startTimeRef.current = Date.now();
    }
  }, [latchedIsFirstGen, isGenerating]);

  // Compute activated phases from file progress — SINGLE SOURCE OF TRUTH
  // Uses fileProgress only (not files[]), so all counters agree.
  const activatedPhases = useMemo(() => {
    const progressPaths = Object.keys(fileProgress);
    const phases = BUILD_PHASES.map(phase => {
      const matchingPaths = progressPaths.filter(p => phase.match.test(p));
      return {
        ...phase,
        active: matchingPaths.length > 0,
        rawDone: matchingPaths.length > 0 && matchingPaths.every(p => fileProgress[p] === 'saved'),
      };
    });

    // Enforce sequential ordering: a phase is only "done" if all earlier active phases are done too.
    // This prevents "Setting up database" showing checked while "Scaffolding" still spins.
    let allPriorDone = true;
    return phases.map(phase => {
      if (!phase.active) return { ...phase, done: false };
      const done = allPriorDone && phase.rawDone;
      if (!done) allPriorDone = false;
      return { ...phase, done };
    });
  }, [fileProgress]);

  // Progress percentage — unified single source of truth across all components
  const progressKeys = Object.keys(fileProgress);
  const allFiles = [...new Set([...progressKeys, ...(files || [])])];
  const totalFiles = allFiles.length;
  const savedFiles = allFiles.filter(p => fileProgress[p] === 'saved' || (!progressKeys.includes(p) && fileProgress[p] !== 'writing')).length;
  const pct = totalFiles > 0 ? Math.round((savedFiles / totalFiles) * 100) : 0;

  // Dynamic subtitle — shows current build phase instead of static text
  const dynamicTip = useMemo(() => {
    if (completedAt) return 'Everything looks good — revealing your app now.';
    const activePhase = activatedPhases.find(p => p.active && !p.done);
    if (activePhase) return activePhase.label + '…';
    return BUILDER_TIPS[tipIndex];
  }, [completedAt, activatedPhases, tipIndex]);

  // Don't render if not latched as first generation or already dismissed
  if (!latchedIsFirstGen || dismissed) return null;

  const isDone = completedAt !== null;
  const isRevealing = isDone && previewReady;

  return (
    <div className={`builder-overlay${isRevealing ? ' builder-overlay--revealing' : ''}`} role="status" aria-label="App builder progress" aria-live="polite">
      {/* Animated background gradient */}
      <div className="builder-overlay-bg" aria-hidden="true" />

      <div className="builder-overlay-content">
        {/* Central icon */}
        <div className={`builder-overlay-icon${isDone ? ' builder-overlay-icon--done' : ''}`}>
          {isDone ? (
            <Check size={32} strokeWidth={2} />
          ) : (
            <Sparkles size={32} strokeWidth={1.5} />
          )}
        </div>

        {/* Title */}
        <h2 className="builder-overlay-title">
          {isRevealing ? 'Your app is ready!' : isDone ? 'Finalizing your app…' : 'Building your app'}
        </h2>

        {/* Tip / subtitle — now dynamic instead of static */}
        <p className="builder-overlay-tip" key={dynamicTip}>
          {dynamicTip}
        </p>

        {/* Single progress bar — the only progress indicator on the overlay */}
        <div className="builder-overlay-progress-rail">
          <div
            className="builder-overlay-progress-fill"
            style={{ width: isDone ? '100%' : pct > 0 ? `${pct}%` : undefined }}
          />
          {pct === 0 && !isDone && <div className="bh-indeterminate-bar builder-overlay-indeterminate" />}
        </div>

        {/* Phase list — sequential ordering enforced */}
        <div className="builder-overlay-phases">
          {activatedPhases.filter(p => p.active).map(phase => {
            const Icon = phase.icon;
            return (
              <div key={phase.id} className={`builder-phase${phase.done ? ' builder-phase--done' : ' builder-phase--active'}`}>
                <span className="builder-phase-icon" aria-hidden="true">
                  {phase.done ? <Check size={14} strokeWidth={2.5} /> : <Loader2 size={14} className="lucide-spin" />}
                </span>
                <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>{phase.label}</span>
              </div>
            );
          })}
          {activatedPhases.filter(p => p.active).length === 0 && (
            <div className="builder-phase builder-phase--active">
              <span className="builder-phase-icon" aria-hidden="true"><Loader2 size={14} className="lucide-spin" /></span>
              <Code2 size={14} strokeWidth={1.5} aria-hidden="true" />
              <span>Analyzing your requirements…</span>
            </div>
          )}
        </div>

        {/* Elapsed time + file counter — uses fileProgress as single source */}
        <div className="builder-overlay-elapsed">
          {elapsedSeconds > 0 && <span aria-label={`${elapsedSeconds} seconds elapsed`}>{elapsedSeconds}s</span>}
          {totalFiles > 0 && <span aria-label={`${savedFiles} of ${totalFiles} files written`}>{savedFiles}/{totalFiles} files</span>}
        </div>
      </div>
    </div>
  );
}
