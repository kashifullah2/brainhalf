import { useState, useCallback, useEffect } from "react";
import { useUpload } from "@/lib/upload";
import type { CreateBatchProgress, ExtractionTemplate } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import {
  ACCEPT_ATTRIBUTE,
  LIMIT_SUMMARY,
  rejectionReason,
} from "@/lib/upload-limits";
import { compressImageForUpload } from "@/lib/ocr-client";

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export type PresetCategory = "financial" | "forms" | "vision" | "general" | "custom";

export interface Preset {
  id: string;
  label: string;
  icon: React.ElementType;
  tagline: string;
  description: string;
  extracts: string[];
  category: PresetCategory;
  mostUsed?: boolean;
}

export const CATEGORY_ACCENTS: Record<
  PresetCategory,
  {
    iconBg: string;
    iconText: string;
    iconBorder: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    cardActive: string;
    cardRing: string;
  }
> = {
  financial: {
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-600 dark:text-amber-400",
    iconBorder: "border-amber-500/30",
    badgeBg: "bg-amber-500/10",
    badgeText: "text-amber-700 dark:text-amber-300",
    badgeBorder: "border-amber-500/30",
    cardActive: "border-amber-500 bg-amber-500/5 dark:bg-amber-500/10",
    cardRing: "ring-2 ring-amber-500/30",
  },
  forms: {
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-600 dark:text-blue-400",
    iconBorder: "border-blue-500/30",
    badgeBg: "bg-blue-500/10",
    badgeText: "text-blue-700 dark:text-blue-300",
    badgeBorder: "border-blue-500/30",
    cardActive: "border-blue-500 bg-blue-500/5 dark:bg-blue-500/10",
    cardRing: "ring-2 ring-blue-500/30",
  },
  vision: {
    iconBg: "bg-teal-500/10",
    iconText: "text-teal-600 dark:text-teal-400",
    iconBorder: "border-teal-500/30",
    badgeBg: "bg-teal-500/10",
    badgeText: "text-teal-700 dark:text-teal-300",
    badgeBorder: "border-teal-500/30",
    cardActive: "border-teal-500 bg-teal-500/5 dark:bg-teal-500/10",
    cardRing: "ring-2 ring-teal-500/30",
  },
  general: {
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    iconBorder: "border-primary/30",
    badgeBg: "bg-primary/10",
    badgeText: "text-primary",
    badgeBorder: "border-primary/30",
    cardActive: "border-primary bg-primary/5 dark:bg-primary/10",
    cardRing: "ring-2 ring-primary/30",
  },
  custom: {
    iconBg: "bg-primary/10",
    iconText: "text-primary",
    iconBorder: "border-primary/30",
    badgeBg: "bg-primary/10",
    badgeText: "text-primary",
    badgeBorder: "border-primary/30",
    cardActive: "border-primary bg-primary/5 dark:bg-primary/10",
    cardRing: "ring-2 ring-primary/30",
  },
};

import { OCR_MODES, type OcrMode } from "../../server/ocr-prompts";
import { errorMessage } from "@/lib/humanize-error";

export const PRESET_MAP: Record<OcrMode, Omit<Preset, "id">> = {
  invoice: {
    label: "Invoice",
    icon: FileText,
    tagline: "Billing & accounts payable",
    description: "Pulls vendor details, totals, due dates, line items, tax lines, and payment statuses from commercial invoices.",
    extracts: ["Invoice #", "Vendor", "Dates", "Subtotal", "Tax", "Total", "Status"],
    category: "financial",
    mostUsed: true,
  },
  receipt: {
    label: "Receipt",
    icon: ShoppingBag,
    tagline: "Point of sale & receipts",
    description: "Extracts store receipts for merchant info, itemized goods, sales tax, tips, and payment methods.",
    extracts: ["Merchant", "Line items", "Tax", "Tip", "Total", "Payment"],
    category: "financial",
  },
  keyvalue: {
    label: "Key-Value",
    icon: ListFilter,
    tagline: "Structured forms & applications",
    description: "Locates every labeled field, pair, scan mark, and filled checkbox on printed forms and applications.",
    extracts: ["All fields", "Empty fields", "Checkboxes", "Key-value pairs"],
    category: "forms",
  },
  table: {
    label: "Table",
    icon: Table2,
    tagline: "Tabular schedules & sheets",
    description: "Reads tables, rosters, and financial grids into structured rows — perfect for exporting to Excel or CSV.",
    extracts: ["Column headers", "Structured rows", "Cell data"],
    category: "forms",
  },
  handwriting: {
    label: "Handwriting",
    icon: PenLine,
    tagline: "Cursive & script OCR",
    description: "Transcribes handwritten letters, doctor notes, and annotations verbatim, reporting legibility scores.",
    extracts: ["Transcription", "Writing style", "Legibility score"],
    category: "vision",
  },
  multilingual: {
    label: "Multilingual",
    icon: Languages,
    tagline: "200+ languages & scripts",
    description: "Identifies languages and scripts (Arabic, Chinese, Cyrillic, Devanagari, Japanese, Latin), transcribes, and translates.",
    extracts: ["Original script", "English translation", "Detected languages"],
    category: "vision",
  },
  fulltext: {
    label: "Full Text",
    icon: FileIcon,
    tagline: "Raw verbatim transcription",
    description: "Transcribes every character and word on the document preserving original reading order and layout.",
    extracts: ["Verbatim text", "Reading flow", "Document type"],
    category: "general",
  },
  custom: {
    label: "Custom Prompt",
    icon: MessageSquareText,
    tagline: "Custom instructions & schema",
    description: "Craft your own custom extraction prompt and schema instructions tailored to your proprietary workflow.",
    extracts: ["User-defined schema", "Custom fields"],
    category: "custom",
  },
  vqa: {
    label: "Visual Q&A",
    icon: Eye,
    tagline: "Conversational visual queries",
    description: "Ask specific questions about visual elements, charts, stamps, diagrams, or text in any document.",
    extracts: ["Direct answers", "Visual details", "Source grounding"],
    category: "custom",
    mostUsed: true,
  },
};

export const PRESETS: Preset[] = OCR_MODES.map((mode: OcrMode) => ({ id: mode, ...PRESET_MAP[mode] }));

const CATEGORY_LABELS: Record<string, { label: string; icon?: React.ElementType }> = {
  all: { label: "All Presets" },
  financial: { label: "💼 Financial" },
  forms: { label: "📋 Forms & Tables" },
  vision: { label: "🧠 Vision & AI" },
  general: { label: "📄 Fulltext" },
  custom: { label: "✨ Custom & Q&A" },
  templates: { label: "🔖 Saved Templates" },
};

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
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filteredPresets = PRESETS.filter((p) => {
    if (selectedCategory === "all") return true;
    if (selectedCategory === "templates") return false;
    return p.category === selectedCategory;
  });

  const showTemplates =
    templates.length > 0 && (selectedCategory === "all" || selectedCategory === "templates");

  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 pb-3">
        {(["all", "financial", "forms", "vision", "custom", ...(templates.length > 0 ? ["templates"] : [])] as const).map(
          (cat) => {
            const active = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {CATEGORY_LABELS[cat]?.label || cat}
                {cat === "templates" && (
                  <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px]">
                    {templates.length}
                  </span>
                )}
              </button>
            );
          }
        )}
      </div>

      {/* Saved Templates */}
      {showTemplates && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground/80">
              Saved Workflow Templates ({templates.length})
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {[...templates]
              .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
              .map((template) => {
                const selected = value === `template_${template.id}`;
                return (
                  <button
                    key={`template_${template.id}`}
                    type="button"
                    onClick={() =>
                      onChange(`template_${template.id}`, { prompt: template.prompt || undefined })
                    }
                    className={cn(
                      "relative flex h-full flex-col p-4 rounded-xl border text-left transition-all duration-200 group overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary bg-primary/5 dark:bg-primary/10 shadow-sm ring-2 ring-primary/30"
                        : "border-border/70 bg-card hover:border-primary/50 hover:shadow-xs"
                    )}
                  >
                    <div className="relative z-10 flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors border",
                          selected
                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                            : "bg-muted text-muted-foreground border-border/40 group-hover:bg-primary/10 group-hover:text-primary"
                        )}
                      >
                        <FileCode2 className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              "truncate text-body-sm font-semibold",
                              selected ? "text-primary" : "text-foreground"
                            )}
                          >
                            {template.name}
                          </p>
                          {selected ? (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                              <Check className="h-3 w-3" strokeWidth={3} />
                            </span>
                          ) : (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              Template
                            </span>
                          )}
                        </div>
                        <p className="text-label leading-relaxed font-medium text-muted-foreground line-clamp-2">
                          {template.description ||
                            `Preset: ${PRESETS.find((p) => p.id === template.baseMode)?.label || template.baseMode}`}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            Base: {PRESETS.find((p) => p.id === template.baseMode)?.label || template.baseMode}
                          </span>
                          {template.useCount !== undefined && template.useCount > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              · Used {template.useCount}x
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Built-in Presets */}
      {selectedCategory !== "templates" && (
        <div className="space-y-3">
          {showTemplates && (
            <p className="text-caption font-semibold uppercase tracking-wider text-muted-foreground/80">
              Core OCR & Vision Engines ({filteredPresets.length})
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 transition-all duration-150 ease-in-out">
            {filteredPresets.map((preset) => {
              const Icon = preset.icon;
              const selected = value === preset.id;
              const accent = CATEGORY_ACCENTS[preset.category] || CATEGORY_ACCENTS.custom;
              return (
                <div
                  key={preset.id}
                  className="transition-all duration-150 ease-in-out animate-in fade-in duration-150"
                >
                  <button
                    type="button"
                    onClick={() => onChange(preset.id)}
                    className={cn(
                      "relative flex h-full w-full flex-col p-4 rounded-xl border text-left transition-all duration-150 group overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? cn("shadow-sm ring-2", accent.cardActive, accent.cardRing)
                        : "border-border/70 bg-card hover:border-primary/50 hover:shadow-xs"
                    )}
                  >
                    <div className="relative z-10 flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-all duration-150",
                          selected
                            ? "bg-primary text-primary-foreground border-primary shadow-xs"
                            : cn(accent.iconBg, accent.iconText, accent.iconBorder)
                        )}
                      >
                        <Icon className="h-4 w-4 stroke-[1.75]" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p
                              className={cn(
                                "truncate text-body-sm font-semibold",
                                selected ? "text-primary" : "text-foreground"
                              )}
                            >
                              {preset.label}
                            </p>
                            {preset.mostUsed && (
                              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.2 text-[9px] font-bold text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                🔥 Most used
                              </span>
                            )}
                          </div>
                          {selected ? (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                              <Check className="h-3 w-3" strokeWidth={3} />
                            </span>
                          ) : (
                            <span className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border shrink-0 transition-colors",
                              accent.badgeBg, accent.badgeText, accent.badgeBorder
                            )}>
                              {preset.category}
                            </span>
                          )}
                        </div>
                        <p className="text-caption font-semibold text-primary/80 dark:text-primary/90">
                          {preset.tagline}
                        </p>
                        <p className="mt-1 text-label leading-relaxed font-normal text-muted-foreground line-clamp-2">
                          {preset.description}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {preset.extracts.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 border border-border/40"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom Prompt Textarea */}
      {(value === "custom" || value.startsWith("template_")) && (
        <div className="rounded-xl border border-primary/30 bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-300 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4 text-primary" />
              <label htmlFor="custom-prompt-input" className="text-body-sm font-semibold text-foreground">
                Extraction Prompt Instructions
              </label>
            </div>
            <span className="text-caption text-muted-foreground">Markdown & schema instructions supported</span>
          </div>
          <textarea
            id="custom-prompt-input"
            rows={4}
            placeholder="e.g., Extract student name, registration number, course title, exam scores, and letter grade..."
            value={customPrompt ?? ""}
            onChange={(e) => onCustomPromptChange?.(e.target.value)}
            className="w-full resize-y rounded-lg border border-border/70 bg-background p-3.5 text-body-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 min-h-[110px]"
          />
        </div>
      )}

      {/* Visual Q&A Textarea */}
      {value === "vqa" && (
        <div className="rounded-xl border border-primary/30 bg-card p-5 space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-300 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <label htmlFor="vqa-prompt-input" className="text-body-sm font-semibold text-foreground">
                Document Questions (Visual Q&A)
              </label>
            </div>
            <span className="text-caption text-muted-foreground">The AI reads visual cues, stamps & text</span>
          </div>
          <textarea
            id="vqa-prompt-input"
            rows={4}
            placeholder="e.g., What is the total invoice balance after discounts? Is there an authorized manager signature present?"
            value={customPrompt ?? ""}
            onChange={(e) => onCustomPromptChange?.(e.target.value)}
            className="w-full resize-y rounded-lg border border-border/70 bg-background p-3.5 text-body-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 min-h-[110px]"
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

  const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";

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
      setFailureMessage(errorMessage(error, "Upload failed."));
    }
  }, [file, uploadFile, onSuccess, typeError]);

  useEffect(() => {
    if (autoStart && status === "pending") startUpload();
  }, [autoStart, status, startUpload]);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3.5 border rounded-xl bg-card transition-all duration-200 shadow-2xs",
        status === "error"
          ? "border-destructive/40 bg-destructive/5"
          : status === "success"
            ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10"
            : "border-border/70 hover:border-border"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-[10px] font-bold uppercase",
            isPdf
              ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400"
              : "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400"
          )}
        >
          {isPdf ? "PDF" : "IMG"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-body-sm font-semibold truncate text-foreground">{file.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-caption font-medium text-muted-foreground">{formatFileSize(file.size)}</span>
            <span className="text-muted-foreground/40">·</span>
            {status === "pending" && <span className="text-caption text-muted-foreground">Queued</span>}
            {status === "uploading" && (
              <span className="text-caption font-medium text-primary animate-pulse">Uploading {progress}%...</span>
            )}
            {status === "success" && (
              <span className="text-caption font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check className="h-3 w-3" /> Ready
              </span>
            )}
            {status === "error" && (
              <span className="text-caption font-medium text-destructive">Failed</span>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {status === "uploading" && (
            <div className="relative flex h-7 w-7 items-center justify-center shrink-0">
              <svg className="h-7 w-7 transform -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-muted/40 stroke-current"
                  strokeWidth="3.5"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-primary stroke-current transition-all duration-200"
                  strokeWidth="3.5"
                  strokeDasharray={`${progress}, 100`}
                  strokeLinecap="round"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className="absolute text-[8px] font-mono font-bold text-primary tabular-nums">
                {progress}%
              </span>
            </div>
          )}
          {status === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          {status === "pending" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-caption font-semibold rounded-md hover:text-destructive hover:bg-destructive/10"
              onClick={onRemove}
            >
              Remove
            </Button>
          )}
          {status === "error" && !typeError && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-caption font-semibold rounded-md border-primary/30 text-primary"
              onClick={startUpload}
            >
              Retry
            </Button>
          )}
          {(status === "error" || status === "success") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-caption font-semibold rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={onRemove}
              title="Remove file from queue"
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      {status === "error" && (
        <p className="text-caption font-medium text-destructive px-0.5 mt-0.5">
          {typeError ?? failureMessage ?? "Upload failed."}
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

  const handleClearAll = () => {
    setQueue([]);
    setUploaded({});
    setStatuses({});
    setIsStarted(false);
  };

  const readyDocuments = queue.map((item) => uploaded[item.id]).filter((doc): doc is UploadedDocument => Boolean(doc));

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
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div className="flex flex-col gap-5 py-1">
      {/* Animated Unified Dropzone Component (Transitions smoothly between empty full box & staged horizontal bar) */}
      <label
        htmlFor="file-upload"
        className={cn(
          "group relative flex w-full cursor-pointer overflow-hidden rounded-xl border-2 border-dashed transition-all duration-300 ease-in-out shadow-2xs",
          isDragging
            ? "border-primary bg-primary/10 ring-2 ring-primary/20"
            : "border-border/80 bg-background/50 hover:border-primary/50 hover:bg-background/80",
          queue.length === 0
            ? "flex-col items-center justify-center p-8 text-center min-h-[220px]"
            : "flex-row items-center justify-between px-4 py-3.5 min-h-[56px]"
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        {queue.length === 0 ? (
          <div className="relative z-10 flex flex-col items-center gap-3.5 transition-all duration-300">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary shadow-xs group-hover:scale-105 transition-transform duration-300">
              <UploadCloud className="h-7 w-7 stroke-[1.75]" />
            </div>
            <div className="space-y-1">
              <p className="text-body-lg font-bold text-foreground">Drop documents here</p>
              <p className="text-caption text-muted-foreground max-w-sm mx-auto leading-relaxed">
                {LIMIT_SUMMARY}. High resolution scans yield higher extraction confidence.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="relative z-10 pointer-events-none rounded-xl px-5 h-9 shadow-xs font-semibold text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-all mt-1"
            >
              Browse files
            </Button>
          </div>
        ) : (
          <div className="relative z-10 flex items-center justify-between w-full gap-3 transition-all duration-300">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shrink-0">
                <UploadCloud className="h-4 w-4" />
              </div>
              <p className="text-body-sm text-foreground">
                <span className="font-semibold text-primary">Drop more documents</span> here or click to browse
              </p>
            </div>
            <span className="text-caption font-semibold text-primary hover:underline shrink-0">Browse files</span>
          </div>
        )}
        <input id="file-upload" type="file" accept={ACCEPT_ATTRIBUTE} multiple className="sr-only" onChange={handleFileChange} />
      </label>

      {queue.length > 0 && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Staging header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <p className="text-body-sm font-semibold text-foreground">
                {queue.length} document{queue.length !== 1 ? "s" : ""} staged
              </p>
              <span className="text-muted-foreground/50">·</span>
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary font-semibold text-xs">
                {selectedPreset?.label ?? "Custom Template"}
              </Badge>
            </div>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-caption font-semibold text-muted-foreground hover:text-destructive transition-colors"
            >
              Clear all
            </button>
          </div>

          {/* Staged files list */}
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

          {/* SETTINGS: Re-extract duplicates toggle switch */}
          <div className="flex items-center justify-between p-4 border border-border/70 rounded-xl bg-card shadow-2xs">
            <div className="space-y-0.5 pr-4">
              <label htmlFor="reextract-switch" className="text-body-sm font-semibold text-foreground cursor-pointer">
                Re-extract duplicates
              </label>
              <p className="text-caption text-muted-foreground">
                Force fresh extraction — bypasses cached OCR results (Default: off — duplicates reuse cached results)
              </p>
            </div>
            <Switch
              id="reextract-switch"
              checked={forceReprocess}
              onCheckedChange={setForceReprocess}
            />
          </div>

          {batchError && (
            <p role="alert" className="text-label text-destructive font-semibold bg-destructive/10 p-3 rounded-xl">
              {batchError}
            </p>
          )}

          {/* STICKY CTA FOOTER BAR */}
          <div className="sticky bottom-0 z-20 mt-2 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-background/95 p-4 shadow-xl backdrop-blur-md">
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-foreground">
                {readyDocuments.length} of {queue.length} document{queue.length !== 1 ? "s" : ""} ready for extraction
              </p>
              {inFlightCount > 0 ? (
                <p className="text-caption font-medium text-muted-foreground">
                  Uploading {inFlightCount} file{inFlightCount === 1 ? "" : "s"} to secure storage...
                </p>
              ) : failedCount > 0 ? (
                <p className="text-caption font-medium text-destructive">
                  {failedCount} file{failedCount === 1 ? "" : "s"} failed. Remove or retry to proceed.
                </p>
              ) : isCreatingBatch && progress ? (
                <p className="text-caption font-medium text-primary truncate max-w-xs">
                  Reading: {progress.filename} ({progress.current}/{progress.total})
                </p>
              ) : (
                <p className="text-caption text-muted-foreground">
                  {readyDocuments.length > 0 ? "Ready to launch high-accuracy OCR worker pipeline." : "Add at least one document to start."}
                </p>
              )}
            </div>
            <Button
              onClick={handleCreateBatch}
              disabled={readyDocuments.length === 0 || isCreatingBatch || !isSettled}
              size="lg"
              className="relative overflow-hidden shrink-0 rounded-xl bg-primary px-8 text-body-sm font-bold text-primary-foreground shadow-md transition-all hover:bg-primary/90 disabled:opacity-50 border-none min-w-[240px] h-11"
            >
              {isCreatingBatch && progress ? (
                <>
                  {/* Inline fill-progress background fill */}
                  <span
                    className="absolute inset-0 bg-white/20 dark:bg-black/25 transition-all duration-300 pointer-events-none"
                    style={{ width: `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%` }}
                  />
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    Uploading {Math.round((progress.current / Math.max(1, progress.total)) * 100)}% ({progress.current}/{progress.total})
                  </span>
                </>
              ) : isCreatingBatch ? (
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Starting batch…
                </span>
              ) : !isSettled ? (
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Uploading {inFlightCount} file{inFlightCount === 1 ? "" : "s"}…
                </span>
              ) : (
                <span className="relative z-10">
                  Start Extraction ({readyDocuments.length} doc{readyDocuments.length !== 1 ? "s" : ""})
                </span>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}