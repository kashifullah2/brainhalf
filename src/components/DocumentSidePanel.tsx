import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, X } from "lucide-react";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { getConfidenceThreshold } from "@/lib/review-queue-store";
import { confidenceTone, ConfidenceIndicator } from "@/components/ConfidenceIndicator";

export function DocumentSidePanel({ doc, onClose }: { doc: any; onClose: () => void }) {
  // Same shared threshold as the table beside the panel, so both color the
  // same field identically.
  const [threshold, setThreshold] = useState(0.8);

  useEffect(() => {
    getConfidenceThreshold()
      .then(setThreshold)
      .catch(() => {
        /* keep the default */
      });
  }, []);

  if (!doc) return null;

  return (
    <div className="flex flex-col h-full bg-card border border-border/60 rounded-3xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border/60 bg-muted/20">
        <div className="flex flex-col min-w-0 pr-2">
          <h3 className="text-sm font-extrabold truncate text-foreground" title={doc.filename}>{doc.filename}</h3>
          {doc.overallConfidence !== undefined && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Doc Score:</span>
              <ConfidenceIndicator value={doc.overallConfidence} threshold={threshold} />
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-full shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          {/* Failed documents carry the extraction error; without it the
              field list would render empty with no explanation. */}
          {doc.status === "failed" && doc.error && (
            <div className="flex items-start gap-3 p-4 rounded-2xl border border-destructive/40 bg-destructive/5 text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-extrabold uppercase tracking-widest">Extraction failed</p>
                <p className="text-xs font-medium mt-1 opacity-80 break-words">{doc.error}</p>
              </div>
            </div>
          )}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Extracted Fields</h4>
            <div className="space-y-3">
              {doc.extractedFields?.map((field: any, idx: number) => {
                const conf = field.confidence ?? 0.9;
                const tone = confidenceTone(conf, threshold);

                const badgeColor =
                  tone === "success"
                    ? "bg-success/10 text-success border-success/20"
                    : tone === "warning"
                    ? "bg-warning/10 text-warning border-warning/20"
                    : "bg-destructive/10 text-destructive border-destructive/20";

                return (
                  <div key={idx} className="flex flex-col gap-1.5 p-3 rounded-xl bg-muted/20 border border-border/40 hover:bg-muted/40 transition-colors">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">{humanizeFieldLabel(field.normalizedField)}</span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-mono font-bold border ${badgeColor}`}
                          title={conf >= threshold
                            ? `Above your ${(threshold * 100).toFixed(0)}% review threshold`
                            : `Below your ${(threshold * 100).toFixed(0)}% review threshold — queued for review`}
                        >
                          {(conf * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-foreground break-all">{field.editedValue ?? field.value ?? "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
