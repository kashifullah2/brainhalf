import { useState, useCallback, useEffect } from "react";
import { useUpload } from "@/lib/upload";
import type { CreateBatchProgress, ExtractionTemplate } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  FileIcon,
  Loader2,
  UploadCloud,
  FileText,
  ShoppingBag,
  ListFilter,
  Check,
  MessageSquareText,
  Eye,
  FileCode2,
  Table2,
  PenLine,
  Languages,
} from "lucide-react";
import { cn } from "@/lib/utils";
// The type and size rules live in one module now. This file carried its own copy
// with a single 25 MB cap, which was wrong for PDFs: they upload fine at that size
// and then fail extraction every time. See src/lib/upload-limits.ts.
import {
  ACCEPT_ATTRIBUTE,
  LIMIT_SUMMARY,
  rejectionReason,
} from "@/lib/upload-limits";
import { compressImageForUpload } from "@/lib/ocr-client";

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export interface Preset {
  id: string;
  label: string;
  icon: React.ElementType;
  tagline: string;
  description: string;
  extracts: string[];
}

import { OCR_MODES, type OcrMode } from "../../server/ocr-prompts";
import { errorMessage } from "@/lib/humanize-error";

export const PRESET_MAP: Record<OcrMode, Omit<Preset, "id">> = {
  invoice: {
    label: "Invoice",
    icon: FileText,
    tagline: "Billing fields",
    description: "Pulls vendor, amounts, dates, tax lines, and payment status from vendor invoices.",
    extracts: ["Invoice #", "Vendor", "Dates", "Subtotal", "Tax", "Total", "Status"],
  },
  fulltext: {
    label: "Full Text",
    icon: FileIcon,
    tagline: "Raw transcription",
    description: "Transcribes everything on the page as it appears — layout and line breaks intact, no structure imposed.",
    extracts: ["Full transcription", "Document type"],
  },
  receipt: {
    label: "Receipt",
    icon: ShoppingBag,
    tagline: "Point of sale",
    description: "Reads store receipts for merchant info, every line item, tax, tip, and payment method.",
    extracts: ["Merchant", "Line items", "Tax", "Tip", "Total", "Payment"],
  },
  keyvalue: {
    label: "Key-Value",
    icon: ListFilter,
    tagline: "Any form",
    description: "Finds every labeled field on any document — printed forms, scans, checkboxes and all.",
    extracts: ["All fields", "Empty fields", "Checkboxes"],
  },
  table: {
    label: "Table",
    icon: Table2,
    tagline: "Rows and columns",
    description: "Reads a schedule, price list or grid as rows — one exported row per line on the page.",
    extracts: ["Column headers", "One row per line"],
  },
  handwriting: {
    label: "Handwriting",
    icon: PenLine,
    tagline: "Cursive and print",
    description: "Transcribes handwritten pages verbatim, keeping line breaks, and reports how legible they were.",
    extracts: ["Transcription", "Writing style", "Legibility"],
  },
  multilingual: {
    label: "Multilingual",
    icon: Languages,
    tagline: "Any script",
    description: "Detects the languages and scripts on the page, transcribes them as written, then translates to English.",
    extracts: ["Original text", "English translation", "Languages"],
  },
  custom: {
    label: "Custom Prompt",
    icon: MessageSquareText,
    tagline: "Your own rules",
    description: "Write your own extraction instructions. Tell the AI exactly what to look for and how to structure the output.",
    extracts: ["User-defined"],
  },
  vqa: {
    label: "Visual Q&A",
    icon: Eye,
    tagline: "Ask about images",
    description: "Ask questions about the content of any image or document. The AI reads the visual and answers directly.",
    extracts: ["Answers", "Document type", "Visual details"],
  },
};

export const PRESETS: Preset[] = OCR_MODES.map((mode: OcrMode) => ({ id: mode, ...PRESET_MAP[mode] }));

// ---------------------------------------------------------------------------
// Preset selector
// ---------------------------------------------------------------------------

export function PresetSelector({
  value,
  onChange,
  customPrompt,
  onCustomPromptChange,
  className,
  templates = [],
}: {
  value: string;
  onChange: (id: string, presetData?: { prompt?: string }) => void;
  customPrompt?: string;
  onCustomPromptChange?: (prompt: string) => void;
  className?: string;
  templates?: ExtractionTemplate[];
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4")}>
        {/* Saved Templates First */}
        {[...templates].sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).map((template) => {
          const selected = value === `template_${template.id}`;
          return (
            <button
              key={`template_${template.id}`}
              type="button"
              onClick={() => onChange(`template_${template.id}`, { prompt: template.prompt || undefined })}
              className={cn(
                "relative flex h-full flex-col p-4 rounded-xl border text-left transition-all duration-300 group overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm ring-1 ring-primary/20"
                  : "border-border/60 bg-card hover:border-primary/40 hover:shadow-sm"
              )}
            >
              <div className="relative z-10 flex items-start gap-3">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors border", selected ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border/40 group-hover:bg-primary/10 group-hover:text-primary")}>
                  <FileCode2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("truncate text-body-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{template.name}</p>
                    {selected && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-2.5 w-2.5" strokeWidth={3} /></span>}
                  </div>
                  <p className="text-caption font-medium text-muted-foreground">Saved template</p>
                  <p className="mt-1.5 text-label leading-relaxed font-medium text-muted-foreground">{template.description || `Based on ${PRESETS.find((p) => p.id === template.baseMode)?.label || template.baseMode}`}</p>
                  <div className={cn("grid transition-all duration-300 ease-in-out", selected ? "grid-rows-[1fr] mt-2 opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="overflow-hidden flex flex-col gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="py-0.5 text-caption text-muted-foreground">Based on</span>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-caption font-medium text-primary">{PRESETS.find((p) => p.id === template.baseMode)?.label || template.baseMode}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}

        {/* Built-in Presets */}
        {PRESETS.map((preset) => {
          const Icon = preset.icon;
          const selected = value === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange(preset.id)}
              className={cn(
                "relative flex h-full flex-col p-4 rounded-xl border text-left transition-all duration-300 group overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm ring-1 ring-primary/20"
                  : "border-border/60 bg-card hover:border-primary/40 hover:shadow-sm"
              )}
            >
              <div className="relative z-10 flex items-start gap-3">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors border", selected ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border/40 group-hover:bg-primary/10 group-hover:text-primary")}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn("truncate text-body-sm font-semibold", selected ? "text-primary" : "text-foreground")}>{preset.label}</p>
                    {selected && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-2.5 w-2.5" strokeWidth={3} /></span>}
                  </div>
                  <p className="text-caption font-medium text-muted-foreground">{preset.tagline}</p>
                  <p className="mt-1.5 text-label leading-relaxed font-medium text-muted-foreground">{preset.description}</p>
                  <div className={cn("grid transition-all duration-300 ease-in-out", selected ? "grid-rows-[1fr] mt-2 opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="overflow-hidden flex flex-col gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {preset.extracts.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded bg-primary/10 px-1.5 py-0.5 text-caption font-medium text-primary">{tag}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {(value === "custom" || value.startsWith("template_")) && (
        <div className="rounded-xl border border-primary/30 bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-300 shadow-sm">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-primary" />
            <label htmlFor="custom-prompt-input" className="text-body-sm font-semibold text-foreground">Your Extraction Instructions</label>
          </div>
          <textarea
            id="custom-prompt-input"
            rows={4}
            placeholder="Extract the student name, roll number, subject, and marks..."
            value={customPrompt ?? ""}
            onChange={(e) => onCustomPromptChange?.(e.target.value)}
            className="w-full resize-y rounded-lg border border-border/60 bg-background p-3 text-body-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/50 min-h-[100px]"
          />
        </div>
      )}

      {value === "vqa" && (
        <div className="rounded-xl border border-primary/30 bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-300 shadow-sm">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            <label htmlFor="vqa-prompt-input" className="text-body-sm font-semibold text-foreground">Your Question(s)</label>
          </div>
          <textarea
            id="vqa-prompt-input"
            rows={4}
            placeholder="What is the total amount on this invoice?"
            value={customPrompt ?? ""}
            onChange={(e) => onCustomPromptChange?.(e.target.value)}
            className="w-full resize-y rounded-lg border border-border/60 bg-background p-3 text-body-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/50 min-h-[100px]"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File upload row
// ---------------------------------------------------------------------------

export interface UploadedDocument {
  filename: string;
  objectPath: string;
  contentType: string;
  sizeBytes?: number;
  contentHash?: string;
  rawFile?: File;
}

type RowStatus = "pending" | "uploading" | "success" | "error";

interface FileUploadRowProps {
  file: File;
  onSuccess: (doc: UploadedDocument) => void;
  onRemove: () => void;
  autoStart: boolean;
  /**
   * Lifts this row's state to the flow above it. Without it the flow only knew
   * which uploads had SUCCEEDED, so it could not tell "two files still going" from
   * "two files failed" -- and enabled the Process button either way.
   */
  onStatusChange: (status: RowStatus) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function FileUploadRow({ file, onSuccess, onRemove, autoStart, onStatusChange }: FileUploadRowProps) {
  const { uploadFile, progress } = useUpload();
  const [typeError] = useState<string | null>(() => rejectionReason(file));
  const [status, setStatus] = useState<RowStatus>(typeError ? "error" : "pending");
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);

  const startUpload = useCallback(async () => {
    if (typeError) return;
    setStatus("uploading");
    setFailureMessage(null);
    try {
      const res = await uploadFile(file);
      setStatus("success");
      onSuccess({ filename: file.name, objectPath: res.objectPath, contentType: res.contentType || file.type, sizeBytes: res.sizeBytes, contentHash: res.contentHash, rawFile: file });
    } catch (error) {
      setStatus("error");
      setFailureMessage(errorMessage(error, "Upload failed."));
    }
  }, [file, uploadFile, onSuccess, typeError]);

  useEffect(() => {
    if (autoStart && status === "pending") startUpload();
  }, [autoStart, status, startUpload]);

  return (
    <div className={cn("flex flex-col gap-2 p-3 border rounded-lg bg-card transition-colors", status === "error" ? "border-destructive/40 bg-destructive/5" : "border-border/60")}>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted"><FileIcon className="h-4 w-4 text-muted-foreground" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-semibold truncate text-foreground">{file.name}</p>
          <p className="text-caption font-medium text-muted-foreground mt-0.5">{formatFileSize(file.size)}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {status === "success" && <CheckCircle2 className="h-4 w-4 text-success" />}
          {status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {status === "pending" && <Button variant="ghost" size="sm" className="h-7 px-2.5 text-caption font-semibold rounded-md hover:text-destructive hover:bg-destructive/10" onClick={onRemove}>Remove</Button>}
          {status === "error" && !typeError && <Button variant="outline" size="sm" className="h-7 px-2.5 text-caption font-semibold rounded-md" onClick={startUpload}>Retry</Button>}
          {status === "error" && typeError && <Button variant="ghost" size="sm" className="h-7 px-2.5 text-caption font-semibold rounded-md hover:text-destructive hover:bg-destructive/10" onClick={onRemove}>Remove</Button>}
        </div>
      </div>
      {status === "uploading" && <Progress value={progress} className="h-1 mx-0.5 mt-1" />}
      {status === "error" && <p className="text-caption font-medium text-destructive px-0.5 mt-0.5">{typeError ?? failureMessage ?? "Upload failed."}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload flow
// ---------------------------------------------------------------------------

interface UploadFlowProps {
  mode: string;
  customPrompt?: string;
  onBatchCreated: (batchId: number) => void;
  createBatchFn: (
    data: { documents: UploadedDocument[]; mode: string; forceReprocess?: boolean; customPrompt?: string; },
    onProgress?: (progress: CreateBatchProgress) => void,
  ) => Promise<{ id: number; failedCount?: number; status?: string }>;
}

interface QueuedFile { id: string; file: File; }
function newQueueId(): string { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `q_${Date.now()}`; }

export function UploadFlow({ mode, customPrompt, onBatchCreated, createBatchFn }: UploadFlowProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [uploaded, setUploaded] = useState<Record<string, UploadedDocument>>({});
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const [isStarted, setIsStarted] = useState(false);
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [forceReprocess, setForceReprocess] = useState(false);
  const [progress, setProgress] = useState<CreateBatchProgress | null>(null);

  const sanitizeFile = (file: File): File => {
    const isOpaqueName = /^AssetAccess/i.test(file.name) || /^image[-.]/i.test(file.name) || /^(image|photo|scan)\.(jpe?g|png|webp)$/i.test(file.name);
    if (!isOpaqueName) return file;
    const extIndex = file.name.lastIndexOf(".");
    const ext = extIndex === -1 ? "" : file.name.slice(extIndex);
    const stamp = new Date(file.lastModified || Date.now()).toISOString().slice(0, 16).replace("T", "_").replace(":", "");
    return new File([file], `Scan_${stamp}${ext}`, { type: file.type, lastModified: file.lastModified });
  };

  const addFiles = async (incoming: FileList) => {
    setIsStarted(true);
    const filesArray = Array.from(incoming);
    const compressedFiles = await Promise.all(
      filesArray.map(async (file) => {
        try {
          return await compressImageForUpload(file);
        } catch {
          return file; // fallback
        }
      })
    );
    const queued = compressedFiles.map((file) => ({ id: newQueueId(), file: sanitizeFile(file) }));
    setQueue((prev) => [...prev, ...queued]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ""; }
  };

  const handleSuccess = useCallback((id: string, doc: UploadedDocument) => { setUploaded((prev) => ({ ...prev, [id]: doc })); }, []);

  const handleStatusChange = useCallback((id: string, status: RowStatus) => {
    setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }));
  }, []);

  const handleRemove = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
    setUploaded((prev) => { const next = { ...prev }; delete next[id]; return next; });
    setStatuses((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const readyDocuments = queue.map((item) => uploaded[item.id]).filter((doc): doc is UploadedDocument => Boolean(doc));

  // Which files are still moving, and which are never going to arrive.
  //
  // The Process button used to be enabled the moment ONE upload succeeded, so
  // clicking while the rest were still in flight created a batch that silently
  // omitted them -- no warning, no record, and the files looked uploaded on screen.
  const inFlightCount = queue.filter((item) => {
    const status = statuses[item.id] ?? "pending";
    return status === "pending" || status === "uploading";
  }).length;
  const failedCount = queue.filter((item) => statuses[item.id] === "error").length;
  const isSettled = inFlightCount === 0;

  const handleCreateBatch = async () => {
    if (readyDocuments.length === 0 || !isSettled) return;
    setIsCreatingBatch(true); setBatchError(null); setProgress(null);
    try {
      const batch = await createBatchFn({ documents: readyDocuments, mode, forceReprocess, customPrompt }, setProgress);
      if (batch.status === "queued") {
        setTimeout(() => onBatchCreated(batch.id), 1500);
      } else {
        onBatchCreated(batch.id);
      }
    } catch (err) {
      setBatchError(errorMessage(err, "Couldn't start the batch."));
      setIsCreatingBatch(false); setProgress(null);
    }
  };

  const selectedPreset = PRESETS.find((p) => p.id === mode) ?? null;
  // Drag feedback. onDragOver only called preventDefault, so the dropzone gave
  // no sign it would accept the file being held over it.
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className="flex flex-col gap-6 py-2">
      {!isStarted && (
        <div className="flex flex-col h-full min-h-[300px]">
          <label
            htmlFor="file-upload"
            className={cn(
              "group relative flex w-full flex-1 cursor-pointer flex-col items-center justify-center gap-4 overflow-hidden rounded-xl border-2 border-dashed p-10 text-center shadow-sm transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border bg-background/40 hover:border-primary/50 hover:bg-background/60"
            )}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Only clear when the pointer leaves the dropzone itself, not
              // when it crosses one of its children.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(false);
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
            }}
          >
            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-background border border-border/60 text-muted-foreground shadow-sm group-hover:scale-105 group-hover:text-primary group-hover:border-primary/20 transition-all duration-300">
                <UploadCloud className="h-8 w-8" />
              </div>
              <div className="space-y-1.5">
                <p className="text-body-lg font-semibold text-foreground">Drop documents here</p>
                <p className="text-body-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">{LIMIT_SUMMARY}. The sharper the scan, the better the extraction.</p>
              </div>
            </div>
            <Button type="button" variant="secondary" className="relative z-10 pointer-events-none rounded-lg px-6 h-9 shadow-sm font-semibold text-label bg-primary text-primary-foreground hover:bg-primary/90 transition-all mt-2">
              Browse files
            </Button>
            <input id="file-upload" type="file" accept={ACCEPT_ATTRIBUTE} multiple className="sr-only" onChange={handleFileChange} />
          </label>
        </div>
      )}

      {queue.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-body-sm font-semibold text-foreground">{queue.length} file{queue.length !== 1 ? "s" : ""} selected</p>
              <p className="text-caption font-medium text-muted-foreground mt-0.5">Mode: {selectedPreset?.label ?? "Custom Template"}</p>
            </div>
            <label htmlFor="file-upload-more" className="cursor-pointer text-label font-semibold text-primary hover:underline">
              Add more
              <input id="file-upload-more" type="file" accept={ACCEPT_ATTRIBUTE} multiple className="sr-only" onChange={handleFileChange} />
            </label>
          </div>
          <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
            {queue.map((item) => (
              <FileUploadRow
                key={item.id}
                file={item.file}
                autoStart={isStarted}
                onSuccess={(doc) => handleSuccess(item.id, doc)}
                onStatusChange={(status) => handleStatusChange(item.id, status)}
                onRemove={() => handleRemove(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {isStarted && queue.length > 0 && (
        <div className="flex flex-col gap-4 pt-5 border-t border-border/60">
          <label className="flex items-center gap-3 p-3 border border-border/60 rounded-xl bg-card cursor-pointer hover:bg-muted/40 transition-colors">
            <input type="checkbox" checked={forceReprocess} onChange={(e) => setForceReprocess(e.target.checked)} className="rounded border border-primary/30 h-4 w-4 accent-primary" />
            <div className="flex flex-col">
              <span className="text-body-sm font-semibold text-foreground">Re-extract duplicates</span>
              <span className="text-caption text-muted-foreground">Process files again even if this account already has them. Off means a duplicate is flagged and reused.</span>
            </div>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-label font-semibold text-muted-foreground">
                {readyDocuments.length} of {queue.length} uploaded
              </p>
              {/* Say what will happen, before it happens. */}
              {inFlightCount > 0 ? (
                <p className="mt-0.5 text-caption font-medium text-muted-foreground">
                  Waiting for {inFlightCount} more upload{inFlightCount === 1 ? "" : "s"} to finish.
                </p>
              ) : failedCount > 0 ? (
                <p className="mt-0.5 text-caption font-medium text-destructive">
                  {failedCount} file{failedCount === 1 ? "" : "s"} failed to upload and{" "}
                  {failedCount === 1 ? "will" : "will"} not be included. Retry or remove{" "}
                  {failedCount === 1 ? "it" : "them"} first.
                </p>
              ) : null}
            </div>
            <Button
              onClick={handleCreateBatch}
              disabled={readyDocuments.length === 0 || isCreatingBatch || !isSettled}
              className="rounded-lg px-6 h-9 text-body-sm font-semibold shadow-sm"
            >
              {isCreatingBatch ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting...</>
              ) : !isSettled ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Uploading…</>
              ) : (
                `Process ${readyDocuments.length} doc${readyDocuments.length !== 1 ? "s" : ""}`
              )}
            </Button>
          </div>
          {isCreatingBatch && progress && (
            // A polite live region rather than silent visual progress: extraction
            // takes minutes on a large batch, and a bar with no announcement means
            // a screen-reader user cannot tell whether anything is happening.
            // aria-atomic keeps "Extracting <file>, 7 of 40" as one utterance
            // instead of reading the changed fragment on its own.
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-label font-semibold text-foreground truncate">
                  {progress.status === "failed"
                    ? "Failed: "
                    : progress.status === "queued"
                      ? "Queued: "
                      : "Extracting: "}{" "}
                  {progress.filename}
                </p>
                <span className="text-caption font-semibold text-muted-foreground tabular-nums shrink-0">{progress.current} / {progress.total}</span>
              </div>
              <Progress value={Math.round((progress.current / Math.max(1, progress.total)) * 100)} className="h-1.5" />
              {progress.error && <p className="text-caption font-medium text-destructive">{progress.error}</p>}
            </div>
          )}
          {/* Appears after "Start extraction" fails, with focus still on the
              button. role="alert" is what makes it audible. */}
          {batchError && (
            <p
              role="alert"
              className="text-label text-destructive font-semibold bg-destructive/10 p-3 rounded-xl"
            >
              {batchError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}