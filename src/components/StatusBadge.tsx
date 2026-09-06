import { Badge } from '@/components/ui/badge';

/**
 * The one status indicator for batches and documents.
 *
 * This replaces two components that both lived in StatusDot.tsx and disagreed:
 * `StatusDot` rendered an uppercase caption from design tokens, while
 * `StatusChip` rendered a pill from 35 hardcoded emerald / amber / red /
 * orange classes — a cool palette in a warm-palette app, and the reason the
 * same "Done" state looked different depending on which page you were on.
 * Only `StatusChip` was ever imported; `StatusDot` was dead.
 */
type Variant = 'success' | 'warning' | 'danger' | 'neutral';

const STATUSES: Record<string, { label: string; variant: Variant; pulse?: boolean }> = {
  completed: { label: 'Done', variant: 'success' },
  processing: { label: 'Processing', variant: 'warning', pulse: true },
  queued: { label: 'Queued', variant: 'neutral', pulse: true },
  failed: { label: 'Failed', variant: 'danger' },
  partial: { label: 'Partial', variant: 'warning' },
  /**
   * Neutral, not danger. The owner asked for this; it is not something that went
   * wrong, and colouring it red would put a batch someone deliberately stopped
   * next to one that broke.
   */
  cancelled: { label: 'Stopped', variant: 'neutral' },
};

const DOT: Record<Variant, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground',
};

export function StatusBadge({ status, title }: { status: string; title?: string }) {
  // An unrecognised status shows its raw value rather than vanishing — a silent
  // empty cell hides a backend change that a visible odd label surfaces.
  const s = STATUSES[status] ?? { label: status, variant: 'neutral' as Variant };

  return (
    <Badge variant={s.variant} className="rounded-full px-2 py-0.5 text-caption" title={title}>
      <span
        aria-hidden
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[s.variant]} ${s.pulse ? 'animate-pulse' : ''}`}
      />
      {s.label}
    </Badge>
  );
}
