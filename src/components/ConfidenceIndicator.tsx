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

const TONE_CLASSES: Record<ConfidenceTone, { bar: string; text: string }> = {
  success: { bar: "bg-success", text: "text-success" },
  warning: { bar: "bg-warning", text: "text-warning" },
  destructive: { bar: "bg-destructive", text: "text-destructive" },
};

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
      <span className={`text-[11px] font-mono font-bold ${classes.text}`}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
