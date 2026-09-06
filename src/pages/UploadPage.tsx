import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
  Sliders,
  FileText,
  MessageSquareText,
  Eye,
} from "lucide-react";
import { UploadFlow, PresetSelector, PRESET_MAP } from "@/components/UploadModal";
import { BackLink, PageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useCreateBatch,
  useListTemplates,
  trackTemplateUsage,
  type CreateBatchProgress,
} from "@/lib/api-client";
import { usePageTitle } from "@/lib/use-page-title";
import { trackAnalyticsEvent } from "@/components/AnalyticsConsent";

export default function UploadPage() {
  const [, setLocation] = useLocation();
  usePageTitle("Extraction Studio · BrainHalf", { noindex: true });
  const createBatch = useCreateBatch();
  const { data: templates } = useListTemplates();

  const [mode, setMode] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("mode") || "invoice";
    }
    return "invoice";
  });

  const [customPrompt, setCustomPrompt] = useState("");
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  // Sync mode with URL param
  const handleModeChange = (newMode: string, presetData?: { prompt?: string }) => {
    setMode(newMode);
    if (presetData?.prompt !== undefined) {
      setCustomPrompt(presetData.prompt);
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", newMode);
      window.history.replaceState(null, "", url.toString());
    }
    // Auto-close preset gallery once chosen for streamlined flow
    setIsGalleryOpen(false);
  };

  // Listen to browser navigation changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const currentMode = new URLSearchParams(window.location.search).get("mode");
    if (currentMode && currentMode !== mode) {
      setMode(currentMode);
    }
  }, [mode]);

  const isTemplate = mode.startsWith("template_");
  const templateObj = isTemplate ? templates?.find((t) => `template_${t.id}` === mode) : undefined;
  const actualMode = isTemplate ? templateObj?.baseMode || "custom" : mode;
  const promptRequired = actualMode === "custom" || actualMode === "vqa" || isTemplate;
  const currentPreset = PRESET_MAP[actualMode as keyof typeof PRESET_MAP];
  const CurrentIcon = currentPreset?.icon || FileText;

  const handleBatchCreated = (batchId: number) => {
    setLocation(`/app/batches/${batchId}`);
  };

  const handleCreateBatchWrapper = async (
    data: {
      documents: {
        filename: string;
        objectPath: string;
        contentType: string;
        sizeBytes?: number;
        contentHash?: string;
        rawFile?: File;
      }[];
      mode: string;
      forceReprocess?: boolean;
      customPrompt?: string;
    },
    onProgress?: (progress: CreateBatchProgress) => void,
  ) => {
    if (data.mode.startsWith("template_")) {
      const id = parseInt(data.mode.replace("template_", ""), 10);
      if (!isNaN(id)) {
        trackTemplateUsage(id);
        const template = templates?.find((t) => t.id === id);
        if (template) {
          trackAnalyticsEvent("template_used", {
            template_id: id,
            template_name: template.name,
            base_mode: template.baseMode,
          });
        }
      }
    }

    const resolvedMode = data.mode.startsWith("template_")
      ? templates?.find((t) => `template_${t.id}` === data.mode)?.baseMode || "custom"
      : data.mode;

    return createBatch.mutateAsync({
      data: { ...data, mode: resolvedMode },
      onProgress,
    });
  };

  return (
    <div className="relative flex w-full flex-1 flex-col pb-12">
      <PageHeader
        eyebrow={
          <>
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Extraction Studio
          </>
        }
        title="Document Extraction Studio"
        description="Select your target document engine, customize extraction criteria, and hand over your documents for high-accuracy OCR."
        back={<BackLink href="/app" label="Back to dashboard" />}
      />

      {/* Active Engine Command Bar */}
      <div className="mb-6 rounded-2xl border border-border/70 bg-gradient-to-r from-card via-card/95 to-primary/5 p-4 sm:p-5 shadow-xs transition-all">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary shadow-xs">
              <CurrentIcon className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                  Active Preset
                </span>
                <span className="text-muted-foreground/40">·</span>
                <Badge
                  variant="outline"
                  className="border-primary/30 bg-primary/10 font-semibold text-primary capitalize text-xs"
                >
                  {isTemplate ? "Custom Template" : currentPreset?.category || "Standard"}
                </Badge>
              </div>
              <h2 className="text-body-lg font-bold text-foreground">
                {isTemplate ? templateObj?.name || "Template" : currentPreset?.label || mode}
              </h2>
              <p className="text-body-sm text-muted-foreground max-w-2xl leading-relaxed">
                {isTemplate
                  ? templateObj?.description || "Saved custom extraction prompt template"
                  : currentPreset?.description}
              </p>
              {currentPreset?.extracts && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {currentPreset.extracts.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground/80 border border-border/50"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
            <Button
              variant={isGalleryOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setIsGalleryOpen(!isGalleryOpen)}
              className="gap-2 rounded-xl font-semibold border-border/80 shadow-xs"
            >
              <Sliders className="h-4 w-4 text-primary" />
              {isGalleryOpen ? "Hide Preset Gallery" : "Switch Engine / Preset"}
              {isGalleryOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>

        {/* Expandable Preset Gallery Drawer */}
        {isGalleryOpen && (
          <div className="mt-5 border-t border-border/60 pt-5 animate-in fade-in slide-in-from-top-3 duration-300">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-body font-semibold text-foreground">Choose Extraction Engine</h3>
                <p className="text-caption text-muted-foreground">
                  Switching engines applies instantly to any queued documents below without losing your files.
                </p>
              </div>
            </div>
            <PresetSelector
              value={mode}
              onChange={handleModeChange}
              customPrompt={customPrompt}
              onCustomPromptChange={setCustomPrompt}
              templates={templates}
            />
          </div>
        )}
      </div>

      {/* Inline Custom Prompt Studio (Shown when mode is custom, vqa, or template) */}
      {promptRequired && !isGalleryOpen && (
        <div className="mb-6 rounded-2xl border border-primary/30 bg-card p-5 shadow-xs space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {actualMode === "vqa" ? (
                <Eye className="h-5 w-5 text-primary" />
              ) : (
                <MessageSquareText className="h-5 w-5 text-primary" />
              )}
              <h3 className="text-body font-semibold text-foreground">
                {actualMode === "vqa" ? "Visual Q&A Query" : "Extraction Instructions & Schema"}
              </h3>
            </div>
            <span className="text-caption font-medium text-muted-foreground">
              {actualMode === "vqa" ? "Ask questions about images" : "Instruct the AI what fields to pull"}
            </span>
          </div>

          <textarea
            rows={3}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={
              actualMode === "vqa"
                ? "e.g., What is the total invoice amount? Is there an authorized manager signature on this document?"
                : "e.g., Extract student name, registration number, course code, exam scores, and letter grade..."
            }
            className="w-full resize-y rounded-xl border border-border/80 bg-background p-3.5 text-body-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/60 min-h-[90px]"
          />

          {promptRequired && customPrompt.trim().length === 0 && (
            <p className="text-caption font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <span>⚠️</span> Please provide extraction instructions or questions before starting the batch.
            </p>
          )}
        </div>
      )}

      {/* Direct Drag & Drop Extraction Canvas */}
      <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-xs sm:p-6 transition-all">
        <UploadFlow
          mode={mode}
          customPrompt={promptRequired ? customPrompt : undefined}
          onBatchCreated={handleBatchCreated}
          createBatchFn={handleCreateBatchWrapper}
        />
      </div>
    </div>
  );
}
