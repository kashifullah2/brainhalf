import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Wand2 } from "lucide-react";
import { UploadFlow, PresetSelector } from "@/components/UploadModal";
import { PageHeader } from "@/components/app";
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

  // "Custom Prompt" and "Visual Q&A" are meaningless without a prompt, so
  // Continue stays disabled until one is entered. Templates with custom base 
  // also need a prompt.
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
    // If a template was used, increment its usage counter.
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
    
    // The backend expects the underlying mode (invoice, custom, vqa, etc.), 
    // not "template_123". The customPrompt is what makes it unique.
    const resolvedMode = data.mode.startsWith("template_") 
      ? (templates?.find(t => `template_${t.id}` === data.mode)?.baseMode || "custom")
      : data.mode;

    return createBatch.mutateAsync({ 
      data: { ...data, mode: resolvedMode }, 
      onProgress 
    });
  };

  // AppLayout's <main> supplies the container width and page padding; the old
  // max-w-7xl/py-8 here doubled them.
  return (
    <div className="relative flex flex-col flex-1 w-full">
      {/* Futuristic background elements */}
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] rounded-full bg-accent/5 blur-[100px]" />
      </div>

      <PageHeader
        eyebrow={<><Wand2 className="h-3.5 w-3.5" /> New extraction</>}
        title="What are we reading today?"
        description="Pick the kind of document you have, then hand over the files. Two steps, no setup."
        actions={
          <Button
            variant="outline"
            className="h-12 rounded-full border-border/80 bg-card px-6 text-sm font-bold shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            onClick={() => setLocation("/app")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Return to Dashboard
          </Button>
        }
      />

      {/* Persistent Progress Indicator */}
      <div className="mb-8 flex items-center justify-between bg-card border border-border/40 p-5 rounded-2xl shadow-sm">
        <div className="flex flex-col">
          <span className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Step {step} of 2</span>
          <span className="text-lg font-bold text-foreground">
            {step === 1 ? "Tell brainhalf what to look for" : "Hand over your documents"}
          </span>
          <span className="mt-0.5 text-xs font-medium text-muted-foreground">
            {step === 1
              ? "Presets cover the usual suspects — or describe it yourself."
              : "Drop them in together; each page is read on its own."}
          </span>
        </div>
        <div className="flex gap-2">
          <div className={cn("h-2.5 w-16 rounded-full transition-colors duration-500", step >= 1 ? "bg-primary" : "bg-muted")} />
          <div className={cn("h-2.5 w-16 rounded-full transition-colors duration-500", step >= 2 ? "bg-primary" : "bg-muted")} />
        </div>
      </div>

      {/* Main Workspace: Wizard Steps */}
      <div className="w-full">
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
            <div className="flex flex-col items-end gap-2 mt-6">
              <Button
                onClick={() => setStep(2)}
                disabled={!canContinue}
                className="h-auto rounded-full px-10 py-4 text-sm font-bold uppercase tracking-wide shadow-md transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Continue to upload
              </Button>
              {!canContinue && (
                <p className="text-xs font-semibold text-muted-foreground">
                  {mode === "vqa" ? "Add at least one question to continue." : "Describe what to extract to continue."}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-8 duration-500">
            <div className="flex justify-start">
              <button
                onClick={() => setStep(1)}
                className="text-muted-foreground hover:text-foreground font-bold text-sm flex items-center gap-2 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" /> Back to mode selection
              </button>
            </div>

            {/* Flat card, consistent with every other panel in the app. */}
            <div className="bg-card border border-border/60 rounded-3xl p-4 sm:p-6 shadow-sm">
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
