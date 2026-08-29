import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, X, Copy } from "lucide-react";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { humanizeExtractionError } from "@/lib/humanize-error";
import { getConfidenceThreshold } from "@/lib/review-queue-store";
import { confidenceTone, ConfidenceIndicator } from "@/components/ConfidenceIndicator";
import { storageUrl } from "@/lib/api-client";

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
      <div className="flex items-start justify-between p-5 border-b border-border/60 bg-muted/10 shrink-0">
        <div className="flex flex-col min-w-0 pr-4">
          <h3 className="text-base font-bold text-foreground truncate" title={doc.filename}>{doc.filename}</h3>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[12px] font-medium text-muted-foreground">{doc.overallConfidence !== undefined ? `${(doc.overallConfidence * 100).toFixed(0)}% overall confidence` : "No confidence score"}</span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 rounded-lg shrink-0 hover:bg-muted/50 -mr-1">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* Source Image Left Panel */}
        {doc.objectPath ? (
          <div className="hidden sm:flex w-1/2 border-r border-border/60 bg-muted/30 p-4 items-center justify-center">
            <img 
              src={storageUrl(doc.objectPath)} 
              alt={doc.filename}
              className="max-w-full max-h-full object-contain rounded-lg shadow-sm border border-border/40"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="hidden sm:flex w-1/2 border-r border-border/60 bg-muted/30 p-4 items-center justify-center">
            <div className="text-muted-foreground text-sm font-medium">No preview available</div>
          </div>
        )}

        {/* Extracted Fields Right Panel */}
        <ScrollArea className="flex-1 p-5">
          <div className="space-y-6">
          {/* Failed documents carry the extraction error; without it the
              field list would render empty with no explanation. The raw string
              stays available as a tooltip. */}
          {doc.status === "failed" && (() => {
            const human = humanizeExtractionError(doc.error);
            return (
              <div
                className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-destructive"
                title={doc.error ?? undefined}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs font-extrabold uppercase tracking-widest">
                    {human.title}
                  </p>
                  <p className="break-words text-xs font-medium opacity-80">
                    {human.body}
                  </p>
                  {human.operatorHint ? (
                    <p className="break-words pt-1 text-[11px] font-medium text-muted-foreground">
                      {human.operatorHint}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })()}
          {/* An "Extracted Fields" heading over nothing looked like a rendering
              fault on every failed document. */}
          {doc.extractedFields?.length ? (
            <div>
              <h4 className="text-[13px] font-semibold text-foreground mb-4">Extracted Fields</h4>
            <div className="space-y-2">
              {doc.extractedFields?.map((field: any, idx: number) => {
                const conf = field.confidence ?? 0.9;
                return (
                  <div key={idx} className="flex flex-col gap-1 p-3 rounded-xl border border-border/40 bg-card hover:border-border/80 transition-colors group">
                    <div className="flex justify-between items-center">
                      <span className="text-[12px] font-medium text-muted-foreground">{humanizeFieldLabel(field.normalizedField)}</span>
                      <div className="flex items-center gap-2">
                        {conf < threshold && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-500">
                            {(conf * 100).toFixed(0)}% conf
                          </span>
                        )}
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" 
                          onClick={() => navigator.clipboard.writeText(field.editedValue ?? field.value ?? "")}
                        >
                          <Copy className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                    <div className="text-[13px] text-foreground font-mono whitespace-pre-wrap break-words leading-relaxed">{field.editedValue ?? field.value ?? "—"}</div>
                  </div>
                );
              })}
            </div>
            </div>
          ) : doc.ocrText ? (
            <div>
              <h4 className="text-[13px] font-semibold text-foreground mb-4">Transcription</h4>
              <div className="p-3 rounded-xl border border-border/40 bg-card hover:border-border/80 transition-colors group">
                <div className="flex justify-end mb-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" 
                    onClick={() => navigator.clipboard.writeText(doc.ocrText ?? "")}
                  >
                    <Copy className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </div>
                <div className="text-[13px] text-foreground font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {doc.ocrText}
                </div>
              </div>
            </div>
          ) : doc.status !== "failed" ? (
            <p className="rounded-2xl border border-dashed border-border/60 p-4 text-center text-xs font-semibold text-muted-foreground">
              No fields were pulled from this page.
            </p>
          ) : null}
        </div>
        </ScrollArea>
      </div>
    </div>
  );
}
