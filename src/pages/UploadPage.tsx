import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Wand2 } from "lucide-react";
import { UploadFlow, PresetSelector } from "@/components/UploadModal";
import { BackLink, PageHeader } from "@/components/app";
import { Button } from "@/components/ui/button";
import { useCreateBatch, useListTemplates, trackTemplateUsage, type CreateBatchProgress } from "@/lib/api-client";
import { usePageTitle } from "@/lib/use-page-title";
import { trackAnalyticsEvent } from "@/components/analytics-consent";
import { cn } from "@/lib/utils";

export default function UploadPage() {
  const [, setLocation] = useLocation();
  usePageTitle("New batch · BrainHalf", { noindex: true });
  const createBatch = useCreateBatch();
  const { data: templates } = useListTemplates();
  const [mode, setMode] = useState("invoice");
  const [customPrompt, setCustomPrompt] = useState("");
  const [step, setStep] = useState(1);

  const handleBatchCreated = (batchId: number) => {
    setLocation(`/app/batches/${batchId}`);
  };

  const isTemplate = mode.startsWith("template_");
  const templateObj = isTemplate ? templates?.find(t => `template_${t.id}` === mode) : undefined;
  const actualMode = isTemplate ? (templateObj?.baseMode || "custom") : mode;
  const promptRequired = actualMode === "custom" || actualMode === "vqa" || isTemplate;
  const canContinue = !promptRequired || customPrompt.trim().length > 0;

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
        const template = templates?.find(t => t.id === id);
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
      ? (templates?.find(t => `template_${t.id}` === data.mode)?.baseMode || "custom")
      : data.mode;

    return createBatch.mutateAsync({ 
      data: { ...data, mode: resolvedMode }, 
      onProgress 
    });
  };

  return (
    <div className="relative flex w-full flex-1 flex-col">
      <PageHeader
        eyebrow={<><Wand2 className="h-3.5 w-3.5" /> New batch</>}
        title="What are we reading today?"
        description="Pick the kind of document you have, then hand over the files."
        back={<BackLink href="/app" label="Back to dashboard" />}
      />

      {/* One line, not four. This card used to carry its own heading and its own
          description directly under the page heading and page description that
          say the same thing — roughly 200px of chrome before the first preset,
          on a step that then left a dead band at the bottom of the viewport.
          The step name and the progress bars are the part that earns its
          height. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-body-sm font-semibold text-primary">Step {step} of 2</span>
          <span className="text-body-sm text-muted-foreground">·</span>
          <span className="text-body font-semibold text-foreground">
            {step === 1 ? "Tell BrainHalf what to look for" : "Hand over your documents"}
          </span>
        </div>
        <div className="flex gap-2" role="presentation">
          <div className={cn("h-1.5 w-12 rounded-full transition-colors duration-500", step >= 1 ? "bg-primary" : "bg-muted")} />
          <div className={cn("h-1.5 w-12 rounded-full transition-colors duration-500", step >= 2 ? "bg-primary" : "bg-muted")} />
        </div>
      </div>

      {/* flex-1: the leftover viewport height goes to the step's own content —
          the dropzone on step 2 grows into it — instead of pooling underneath
          the card as empty canvas. */}
      <div className="flex w-full flex-1 flex-col">
        {step === 1 ? (
          <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <PresetSelector 
              value={mode} 
              onChange={(id, presetData) => {
                setMode(id);
                if (presetData?.prompt !== undefined) {
                  setCustomPrompt(presetData.prompt);
                }
              }} 
              customPrompt={customPrompt} 
              onCustomPromptChange={setCustomPrompt}
              templates={templates}
            />
            <div className="flex flex-col items-end gap-2">
              <Button
                size="lg"
                onClick={() => setStep(2)}
                disabled={!canContinue}
                className="text-body font-semibold"
              >
                Continue to upload
              </Button>
              {!canContinue && (
                <p className="text-label font-medium text-muted-foreground">
                  {mode === "vqa" ? "Add at least one question to continue." : "Describe what to extract to continue."}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
            <div className="flex justify-start">
              <button onClick={() => setStep(1)} className="text-muted-foreground hover:text-foreground font-semibold text-body-sm flex items-center gap-1.5 transition-colors">
                <ArrowLeft className="h-4 w-4" /> Back to mode selection
              </button>
            </div>
            <div className="flex-1 rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:p-6">
              <UploadFlow
                key={mode}
                mode={mode}
                customPrompt={promptRequired ? customPrompt : undefined}
                onBatchCreated={handleBatchCreated}
                createBatchFn={handleCreateBatchWrapper}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
