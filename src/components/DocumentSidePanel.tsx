import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, X, Copy } from "lucide-react";
import { humanizeFieldLabel } from "@/lib/humanizeField";
import { humanizeExtractionError } from "@/lib/humanize-error";
import { useConfidenceThreshold } from "@/hooks/use-confidence-threshold";
import { ConfidenceBadge } from "@/components/ConfidenceIndicator";
import { storageUrl } from "@/lib/api-client";

export function DocumentSidePanel({ doc, onClose }: { doc: any; onClose: () => void }) {
  // Same shared value as the table beside the panel, so both colour the same
  // field identically — they used to fetch it separately and could disagree.
  const threshold = useConfidenceThreshold();

  if (!doc) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <div className="flex items-start justify-between p-5 border-b border-border/60 bg-muted/10 shrink-0">
        <div className="flex flex-col min-w-0 pr-4">
          <h3 className="text-body-xl font-semibold text-foreground truncate" title={doc.filename}>{doc.filename}</h3>
          <div className="flex items-center gap-2 mt-1.5">
            {/* Muted grey said "71% overall confidence" in the same tone it
                would have said 99%. Below the account's threshold this is the
                number the panel was opened to check, so it carries the warning
                colour the flagged fields below it already use. */}
            <span
              className={`text-label font-medium ${
                doc.overallConfidence !== undefined && doc.overallConfidence < threshold
                  ? "text-warning"
                  : "text-muted-foreground"
              }`}
            >
              {doc.overallConfidence !== undefined
                ? `${(doc.overallConfidence * 100).toFixed(0)}% overall confidence`
                : "No confidence score"}
            </span>
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
            {/* Was `max-w-full max-h-full`, so the page rendered at its own
                intrinsic size — a small scan sat marooned in the middle of a
                large empty panel. h-full/w-full with object-contain scales it up
                to the space available without distorting it. Not lazy: this is
                the reason the panel was opened. */}
            <img
              src={storageUrl(doc.objectPath)}
              alt={`Page image for ${doc.filename}`}
              className="h-full w-full rounded-lg border border-border/40 object-contain shadow-sm"
              decoding="async"
            />
          </div>
        ) : (
          <div className="hidden sm:flex w-1/2 border-r border-border/60 bg-muted/30 p-4 items-center justify-center">
            <div className="text-muted-foreground text-body font-medium">No preview available</div>
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
                className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-destructive"
                title={doc.error ?? undefined}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-1">
                  <p className="text-body-sm font-semibold">
                    {human.title}
                  </p>
                  <p className="break-words text-label font-medium opacity-80">
                    {human.body}
                  </p>
                  {human.operatorHint ? (
                    <p className="break-words pt-1 text-caption font-medium text-muted-foreground">
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
              <h4 className="text-body-sm font-semibold text-foreground mb-4">Extracted Fields</h4>
            <div className="space-y-2">
              {doc.extractedFields?.map((field: any, idx: number) => {
                const conf = field.confidence ?? 0.9;
                return (
                  <div key={idx} className="flex flex-col gap-1 p-3 rounded-xl border border-border/40 bg-card hover:border-border/80 transition-colors group">
                    <div className="flex justify-between items-center">
                      <span className="text-label font-medium text-muted-foreground">{humanizeFieldLabel(field.normalizedField)}</span>
                      <div className="flex items-center gap-2">
                        {conf < threshold && <ConfidenceBadge value={conf} threshold={threshold} />}
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
                    <div className="text-body-sm text-foreground font-mono whitespace-pre-wrap break-words leading-relaxed">{field.editedValue ?? field.value ?? "—"}</div>
                  </div>
                );
              })}
            </div>
            </div>
          ) : doc.ocrText ? (
            <div>
              <h4 className="text-body-sm font-semibold text-foreground mb-4">Transcription</h4>
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
                <div className="text-body-sm text-foreground font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {doc.ocrText}
                </div>
              </div>
            </div>
          ) : doc.status !== "failed" ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-label font-semibold text-muted-foreground">
              No fields were pulled from this page.
            </p>
          ) : null}
        </div>
        </ScrollArea>
      </div>
    </div>
  );
}
