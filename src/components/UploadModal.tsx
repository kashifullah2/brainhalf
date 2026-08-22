import { useState, useCallback, useEffect } from "react";
import { useUpload } from "@/lib/upload";
import type { CreateBatchProgress } from "@/lib/api-client";
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
  Table2,
  Check,
  PenLine,
  Globe,
  MessageSquareText,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

export const PRESETS: Preset[] = [
  {
    id: "invoice",
    label: "Invoice",
    icon: FileText,
    tagline: "Billing fields",
    description:
      "Pulls vendor, amounts, dates, tax lines, and payment status from vendor invoices.",
    extracts: ["Invoice #", "Vendor", "Dates", "Subtotal", "Tax", "Total", "Status"],
  },
  {
    id: "fulltext",
    label: "Full Text",
    icon: FileIcon,
    tagline: "Raw transcription",
    description:
      "Transcribes everything on the page as it appears — layout and line breaks intact, no structure imposed.",
    extracts: ["Full transcription", "Document type"],
  },
  {
    id: "receipt",
    label: "Receipt",
    icon: ShoppingBag,
    tagline: "Point of sale",
    description:
      "Reads store receipts for merchant info, every line item, tax, tip, and payment method.",
    extracts: ["Merchant", "Line items", "Tax", "Tip", "Total", "Payment"],
  },
  {
    id: "keyvalue",
    label: "Key-Value",
    icon: ListFilter,
    tagline: "Any form",
    description:
      "Finds every labeled field on any document — printed forms, scans, checkboxes and all.",
    extracts: ["All fields", "Empty fields", "Checkboxes"],
  },
  {
    id: "table",
    label: "Table",
    icon: Table2,
    tagline: "Grids & sheets",
    description:
      "Extracts rows and columns from price lists, schedules, and comparison sheets.",
    extracts: ["Cells", "Headers", "Totals"],
  },
  {
    id: "handwriting",
    label: "Handwriting & Notes",
    icon: PenLine,
    tagline: "Cursive & print",
    description:
      "Reads handwritten letters, sticky notes, journal entries, and classroom notes — even messy cursive.",
    extracts: ["Full text", "Author guess", "Language"],
  },
  {
    id: "multilingual",
    label: "Multilingual Extraction",
    icon: Globe,
    tagline: "Any language",
    description:
      "Detects and transcribes text in Arabic, Chinese, Hindi, Japanese, Korean, Urdu, and 50+ other scripts.",
    extracts: ["Language", "Script", "Translation", "Original text"],
  },
  {
    id: "custom",
    label: "Custom Prompt",
    icon: MessageSquareText,
    tagline: "Your own rules",
    description:
      "Write your own extraction instructions. Tell the AI exactly what to look for and how to structure the output.",
    extracts: ["User-defined"],
  },
  {
    id: "vqa",
    label: "Visual Q&A",
    icon: Eye,
    tagline: "Ask about images",
    description:
      "Ask questions about the content of any image or document. The AI reads the visual and answers directly.",
    extracts: ["Answers", "Document type", "Visual details"],
  },
];

// ---------------------------------------------------------------------------
// Preset selector
// ---------------------------------------------------------------------------

export function PresetSelector({
  value,
  onChange,
  customPrompt,
  onCustomPromptChange,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  customPrompt?: string;
  onCustomPromptChange?: (prompt: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
    {/* items-stretch (the grid default) keeps every row's cards the same
        height; items-start left each card at its own height and the row
        edges looked ragged whenever the selected card expanded. */}
    <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4")}>
      {PRESETS.map((preset) => {
        const Icon = preset.icon;
        const selected = value === preset.id;
        
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset.id)}
            className={cn(
              "relative flex h-full flex-col p-4 rounded-2xl border-2 text-left transition-all duration-300 group overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary/40",
              selected
                ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-md ring-1 ring-primary/20 scale-[1.01]"
                : "border-border/60 bg-card hover:border-primary/40 hover:shadow-sm"
            )}
          >
            {/* Ambient Background Glow for Selected */}
            {selected && (
              <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.15),transparent_60%)] pointer-events-none" />
            )}

            <div className="relative z-10 flex items-start gap-4">
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] transition-colors",
                  selected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                )}
              >
                <Icon className="h-5 w-5" />
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "text-sm font-bold truncate",
                      selected ? "text-primary" : "text-foreground"
                    )}
                  >
                    {preset.label}
                  </p>
                  {selected && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                  {preset.tagline}
                </p>

                {/* Always visible. When this only rendered for the selected card,
                    the grid still stretched every sibling to the expanded card's
                    height, leaving the unselected ones as tall empty boxes. */}
                <p className="mt-2 text-[13px] leading-relaxed font-medium text-muted-foreground">
                  {preset.description}
                </p>

                <div
                  className={cn(
                    "grid transition-all duration-300 ease-in-out",
                    selected ? "grid-rows-[1fr] mt-3 opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="overflow-hidden flex flex-col gap-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mr-1 py-1">
                        Extracts:
                      </span>
                      {preset.extracts.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md px-2 py-1 text-[11px] font-bold tracking-wide uppercase bg-primary/10 text-primary border border-primary/20"
                        >
                          {tag}
                        </span>
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

    {/* Custom prompt textarea — only visible when "custom" is selected */}
    {value === "custom" && (
      <div className="rounded-2xl border-2 border-primary/30 bg-card p-6 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-primary" />
          <label
            htmlFor="custom-prompt-input"
            className="text-sm font-bold text-foreground"
          >
            Your Extraction Instructions
          </label>
        </div>
        <textarea
          id="custom-prompt-input"
          rows={5}
          placeholder={`Example:\nExtract the student name, roll number, subject, marks obtained, and grade from this marksheet. Return as JSON.`}
          value={customPrompt ?? ""}
          onChange={(e) => onCustomPromptChange?.(e.target.value)}
          className="w-full resize-y rounded-xl border border-border/60 bg-background p-4 text-sm font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all min-h-[120px]"
        />
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
          The AI will follow your instructions exactly. Be specific about the fields you want.
        </p>
      </div>
    )}

    {/* VQA question textarea — only visible when "vqa" is selected */}
    {value === "vqa" && (
      <div className="rounded-2xl border-2 border-primary/30 bg-card p-6 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <label
            htmlFor="vqa-prompt-input"
            className="text-sm font-bold text-foreground"
          >
            Your Question(s)
          </label>
        </div>
        <textarea
          id="vqa-prompt-input"
          rows={4}
          placeholder={`Example:\nWhat is the total amount on this invoice?\nIs there a signature on this document?\nWhat language is the text written in?`}
          value={customPrompt ?? ""}
          onChange={(e) => onCustomPromptChange?.(e.target.value)}
          className="w-full resize-y rounded-xl border border-border/60 bg-background p-4 text-sm font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all min-h-[100px]"
        />
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
          Ask any question about the image. The AI will analyze the visual content and answer directly.
        </p>
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

interface FileUploadRowProps {
  file: File;
  onSuccess: (doc: UploadedDocument) => void;
  onRemove: () => void;
  autoStart: boolean;
}

const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/** Matches the cap enforced by functions/api/storage/upload.ts. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Small files read better in KB than as "0.02 MB". */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function rejectionReason(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) {
    return `Can't read this file type (${file.type || "unknown"}). Use JPG, PNG, WEBP, or PDF.`;
  }
  if (file.size === 0) {
    return "This file is empty.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

function FileUploadRow({ file, onSuccess, onRemove, autoStart }: FileUploadRowProps) {
  const { uploadFile, progress } = useUpload();
  const [typeError] = useState<string | null>(() => rejectionReason(file));
  const [status, setStatus] = useState<"pending" | "uploading" | "success" | "error">(
    typeError ? "error" : "pending",
  );
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  const startUpload = useCallback(async () => {
    if (typeError) return;
    setStatus("uploading");
    setFailureMessage(null);
    try {
      const res = await uploadFile(file);
      setStatus("success");
      onSuccess({
        filename: file.name,
        objectPath: res.objectPath,
        contentType: res.contentType || file.type,
        sizeBytes: res.sizeBytes,
        contentHash: res.contentHash,
        rawFile: file,
      });
    } catch (error) {
      setStatus("error");
      setFailureMessage(
        error instanceof Error ? error.message : "Upload failed. Try again.",
      );
    }
  }, [file, uploadFile, onSuccess, typeError]);

  useEffect(() => {
    if (autoStart && status === "pending") startUpload();
  }, [autoStart, status, startUpload]);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-4 border rounded-xl bg-card transition-colors",
        status === "error" ? "border-destructive/40 bg-destructive/5" : "border-border/60"
      )}
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileIcon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate text-foreground" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs font-semibold text-muted-foreground mt-0.5 font-mono tabular-nums">
            {formatFileSize(file.size)}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          {status === "success" && <CheckCircle2 className="h-5 w-5 text-success" />}
          {status === "uploading" && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          {status === "pending" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs font-bold rounded-full hover:text-destructive hover:bg-destructive/10 uppercase tracking-wide"
              onClick={onRemove}
            >
              Remove
            </Button>
          )}
          {status === "error" && !typeError && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs font-bold rounded-full uppercase tracking-wide"
              onClick={startUpload}
            >
              Retry
            </Button>
          )}
          {status === "error" && typeError && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs font-bold rounded-full hover:text-destructive hover:bg-destructive/10 uppercase tracking-wide"
              onClick={onRemove}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      {status === "uploading" && <Progress value={progress} className="h-1 mx-0.5 mt-2" />}
      {status === "error" && (
        <p className="text-xs font-semibold text-destructive px-0.5 mt-1">
          {typeError ?? failureMessage ?? "Upload failed. Try again."}
        </p>
      )}
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
    data: {
      documents: UploadedDocument[];
      mode: string;
      forceReprocess?: boolean;
      customPrompt?: string;
      engine?: "auto" | "hunyuan" | "textract";
    },
    onProgress?: (progress: CreateBatchProgress) => void,
  ) => Promise<{ id: number; failedCount?: number }>;
}

/** A file plus a stable id, so removing one cannot mismatch by index. */
interface QueuedFile {
  id: string;
  file: File;
}

function newQueueId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `q_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function UploadFlow({ mode, customPrompt, onBatchCreated, createBatchFn }: UploadFlowProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  // Keyed by queue id so removing a file always removes its upload too.
  const [uploaded, setUploaded] = useState<Record<string, UploadedDocument>>({});
  const [isStarted, setIsStarted] = useState(false);
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [forceReprocess, setForceReprocess] = useState(false);
  const [engine, setEngine] = useState<"auto" | "hunyuan" | "textract">("auto");
  const [progress, setProgress] = useState<CreateBatchProgress | null>(null);

  const sanitizeFile = (file: File): File => {
    // Only rewrite names the OS itself made meaningless (iOS photo library,
    // clipboard pastes). Everything else keeps the name the user recognises;
    // uniqueness comes from the queue id and the server-side document id.
    const isOpaqueName =
      /^AssetAccess/i.test(file.name) ||
      /^image[-.]/i.test(file.name) ||
      /^(image|photo|scan)\.(jpe?g|png|webp)$/i.test(file.name);

    if (!isOpaqueName) return file;

    const extIndex = file.name.lastIndexOf(".");
    const ext = extIndex === -1 ? "" : file.name.slice(extIndex);
    const stamp = new Date(file.lastModified || Date.now())
      .toISOString()
      .slice(0, 16)
      .replace("T", "_")
      .replace(":", "");

    return new File([file], `Scan_${stamp}${ext}`, {
      type: file.type,
      lastModified: file.lastModified,
    });
  };

  const addFiles = (incoming: FileList) => {
    const queued = Array.from(incoming).map((file) => ({
      id: newQueueId(),
      file: sanitizeFile(file),
    }));
    setQueue((prev) => [...prev, ...queued]);
    setIsStarted(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addFiles(e.target.files);
      // Reset the input so picking the same file again still fires a change.
      e.target.value = "";
    }
  };

  const handleSuccess = useCallback((id: string, doc: UploadedDocument) => {
    setUploaded((prev) => ({ ...prev, [id]: doc }));
  }, []);

  const handleRemove = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
    setUploaded((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // Ordered, and containing only files still in the queue.
  const readyDocuments = queue
    .map((item) => uploaded[item.id])
    .filter((doc): doc is UploadedDocument => Boolean(doc));

  const handleCreateBatch = async () => {
    if (readyDocuments.length === 0) return;
    setIsCreatingBatch(true);
    setBatchError(null);
    setProgress(null);
    try {
      const batch = await createBatchFn(
        { documents: readyDocuments, mode, forceReprocess, customPrompt, engine },
        setProgress,
      );
      onBatchCreated(batch.id);
    } catch (err) {
      setBatchError((err as Error).message || "Couldn't start the batch. Try again.");
      setIsCreatingBatch(false);
      setProgress(null);
    }
  };

  const selectedPreset = PRESETS.find((p) => p.id === mode)!;

  return (
    <div className="flex flex-col gap-8 py-2">
      {!isStarted && (
        <div className="flex flex-col h-full min-h-[400px]">
          <label
            htmlFor="file-upload"
            className={cn(
              "group relative overflow-hidden flex flex-col items-center justify-center text-center gap-6 rounded-[2rem] p-12 cursor-pointer transition-all w-full flex-1",
              "bg-background/40 hover:bg-background/60 border-2 border-dashed border-primary/30 hover:border-primary/60 shadow-inner"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files?.length) {
                addFiles(e.dataTransfer.files);
              }
            }}
          >
            {/* Ambient Animated Glow inside the Dropzone */}
            <span
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.08),transparent_60%)] opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
            />
            
            <div className="relative z-10 flex flex-col items-center gap-5">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.5rem] bg-background border border-primary/20 text-primary shadow-2xl group-hover:scale-110 group-hover:-translate-y-2 group-hover:rotate-3 transition-all duration-500">
                <UploadCloud className="h-10 w-10 text-primary" />
              </div>
              <div className="space-y-2">
                <p className="text-2xl font-extrabold tracking-tight text-foreground">
                  Drag & Drop Files Here
                </p>
                <p className="text-sm font-medium text-muted-foreground/80 max-w-md mx-auto leading-relaxed">
                  Support for PDF, JPG, PNG, and WEBP, up to 25 MB per file.
                  High-resolution scans give the best results.
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="secondary"
              className="relative z-10 pointer-events-none rounded-full px-8 h-12 shadow-md font-bold uppercase tracking-wide text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-all mt-4"
            >
              Browse Files
            </Button>
            <input
              id="file-upload"
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              multiple
              className="sr-only"
              onChange={handleFileChange}
            />
          </label>
        </div>
      )}

      {/* File list */}
      {queue.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-foreground">
                {queue.length} file{queue.length !== 1 ? "s" : ""} selected
              </p>
              <p className="text-[11px] uppercase tracking-widest font-semibold text-muted-foreground mt-1">
                Mode: {selectedPreset.label}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label
                htmlFor="file-upload-more"
                className="cursor-pointer text-[11px] uppercase tracking-widest font-bold text-primary hover:underline"
              >
                Add more
                <input
                  id="file-upload-more"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  multiple
                  className="sr-only"
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-1">
            {queue.map((item) => (
              <FileUploadRow
                key={item.id}
                file={item.file}
                autoStart={isStarted}
                onSuccess={(doc) => handleSuccess(item.id, doc)}
                onRemove={() => handleRemove(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Process button */}
      {isStarted && queue.length > 0 && (
        <div className="flex flex-col gap-4 pt-6 border-t border-border/50">
          {/* Two equal-height columns filling the row. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2 p-3 border border-border/40 rounded-xl bg-muted/20">
              <span className="text-[11px] font-bold text-foreground uppercase tracking-widest">Extraction Model</span>
              <div className="flex bg-background border border-border/40 rounded-lg overflow-hidden flex-wrap">
                <button
                  type="button"
                  className={cn("flex-1 px-2 py-1.5 text-[11px] font-bold transition-colors min-w-[50px]", engine === "auto" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}
                  onClick={() => setEngine("auto")}
                >Auto</button>
                <button
                  type="button"
                  className={cn("flex-1 px-2 py-1.5 text-[11px] font-bold transition-colors border-l border-border/40 min-w-[50px]", engine === "hunyuan" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}
                  onClick={() => setEngine("hunyuan")}
                  title="Force BH Model 1 (Fast, standard extraction)"
                >
                  BH Model 1
                </button>
                <button
                  type="button"
                  className={cn("flex-1 px-2 py-1.5 text-[11px] font-bold transition-colors border-l border-border/40 min-w-[50px] rounded-r-md", engine === "textract" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}
                  onClick={() => setEngine("textract")}
                  title="Force BH Model 2 (Forms & Tables high precision)"
                >
                  BH Model 2
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 max-w-[280px]">
                {engine === "auto" ? "Starts with BH Model 1, escalates to BH Model 2 on low confidence." :
                 engine === "hunyuan" ? "Forces BrainHalf Model 1 for fast document extraction." :
                 engine === "textract" ? "Uses BrainHalf Model 2 for high-precision form and table parsing." : ""}
              </p>
            </div>

            <label className="flex items-center gap-3 p-3 border border-border/40 rounded-xl bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors">
              <div className="relative flex items-center shrink-0">
              <input 
                type="checkbox"
                checked={forceReprocess}
                onChange={(e) => setForceReprocess(e.target.checked)}
                className="peer h-5 w-5 appearance-none rounded border border-primary/30 bg-background checked:bg-primary checked:border-primary transition-colors cursor-pointer"
              />
              <Check className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-3.5 w-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" strokeWidth={3} />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground">Re-run fresh extraction</span>
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Bypass cache for fresh extraction</span>
            </div>
          </label>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground font-mono tabular-nums">
              {readyDocuments.length} of {queue.length} uploaded
            </p>
            <Button
              onClick={handleCreateBatch}
              disabled={readyDocuments.length === 0 || isCreatingBatch}
              className="rounded-full px-8 h-12 text-sm font-bold uppercase tracking-wide shadow-sm"
            >
              {isCreatingBatch ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Extracting...
                </>
              ) : (
                `Process ${readyDocuments.length} doc${readyDocuments.length !== 1 ? "s" : ""}`
              )}
            </Button>
          </div>

          {/* Per-document progress. Extraction runs one document at a time, so
              without this the button simply sat spinning for minutes. */}
          {isCreatingBatch && progress && (
            <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold text-foreground truncate">
                  {progress.status === "failed" ? "Failed: " : "Extracting: "}
                  <span className="font-mono">{progress.filename}</span>
                </p>
                <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground font-mono tabular-nums shrink-0">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <Progress
                value={Math.round((progress.current / Math.max(1, progress.total)) * 100)}
                className="h-1.5"
              />
              {progress.error && (
                <p className="text-[11px] font-semibold text-destructive">
                  {progress.error} — the rest of the batch continues.
                </p>
              )}
            </div>
          )}
          {batchError && (
            <p className="text-sm text-destructive font-bold bg-destructive/10 p-3 rounded-lg">
              {batchError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}