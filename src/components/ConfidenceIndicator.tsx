/**
 * Threshold-aware confidence display.
 *
 * Product semantic: a field scoring at or above the user's review threshold
 * is trusted (green); below it is routed to the Review Queue (amber); far
 * below it is likely garbage (red). Bands follow the configured threshold
 * everywhere instead of fixed values.
 */

export type ConfidenceTone = "success" | "warning" | "destructive";

/** Absolute floor: below this the extraction is treated as unreliable no
 *  matter how permissive the user's threshold is. */
export const VERY_LOW_CONFIDENCE = 0.6;

export function confidenceTone(value: number, threshold: number): ConfidenceTone {
  if (value >= threshold) return "success";
  if (value < VERY_LOW_CONFIDENCE) return "destructive";
  return "warning";
}

const TONE_CLASSES: Record<ConfidenceTone, { bar: string; text: string; chip: string }> = {
  success: { bar: "bg-success", text: "text-success", chip: "bg-success/12 text-success" },
  warning: { bar: "bg-warning", text: "text-warning", chip: "bg-warning/12 text-warning" },
  destructive: {
    bar: "bg-destructive",
    text: "text-destructive",
    chip: "bg-destructive/12 text-destructive",
  },
};

/**
 * The inline "88% conf" chip. BatchDetails and DocumentSidePanel each carried
 * their own copy — one `rounded-sm`, one `rounded`, both hardcoding an amber
 * that the palette does not contain — and neither reacted to a score dropping
 * below the unreliable floor.
 */
export function ConfidenceBadge({
  value,
  threshold,
  className = "",
}: {
  value: number;
  threshold: number;
  className?: string;
}) {
  const tone = confidenceTone(value, threshold);
  const pct = Math.round(Math.min(100, Math.max(0, value * 100)));
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 font-data text-micro font-semibold tabular-nums ${TONE_CLASSES[tone].chip} ${className}`}
      title={
        value >= threshold
          ? `Above your ${Math.round(threshold * 100)}% review threshold`
          : `Below your ${Math.round(threshold * 100)}% review threshold — queued for review`
      }
    >
      {pct}% conf
    </span>
  );
}

export function ConfidenceIndicator({
  value,
  threshold,
}: {
  value: number;
  threshold: number;
}) {
  const tone = confidenceTone(value, threshold);
  const classes = TONE_CLASSES[tone];
  const pct = Math.min(100, Math.max(0, value * 100));
  const title =
    value >= threshold
      ? `Above your ${(threshold * 100).toFixed(0)}% review threshold`
      : `Below your ${(threshold * 100).toFixed(0)}% review threshold — queued for review`;

  return (
    <div className="flex items-center gap-2" title={`Confidence: ${pct.toFixed(1)}%. ${title}`}>
      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden shadow-inner">
        <div className={`h-full ${classes.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-caption font-mono font-semibold ${classes.text}`}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
