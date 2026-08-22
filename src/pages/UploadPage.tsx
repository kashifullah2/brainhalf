import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { UploadFlow, PresetSelector } from "@/components/UploadModal";
import { useCreateBatch, type CreateBatchProgress } from "@/lib/api-client";
import { usePageTitle } from "@/lib/use-page-title";
import { cn } from "@/lib/utils";

export default function UploadPage() {
  const [, setLocation] = useLocation();
  usePageTitle("New batch · BrainHalf", { noindex: true });
  const createBatch = useCreateBatch();
  const [mode, setMode] = useState("invoice");
  const [customPrompt, setCustomPrompt] = useState("");
  const [step, setStep] = useState(1);

  const handleBatchCreated = (batchId: number) => {
    setLocation(`/app/batches/${batchId}`);
  };

  // "Custom Prompt" and "Visual Q&A" are meaningless without a prompt, so
  // Continue stays disabled until one is entered.
  const promptRequired = mode === "custom" || mode === "vqa";
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
    return createBatch.mutateAsync({ data, onProgress });
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

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-border/40 pb-8 mb-8">
        <div className="space-y-2">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
            New batch
          </h1>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl font-medium">
            Choose an extraction mode, then upload your documents.
          </p>
        </div>
        <button
          onClick={() => setLocation("/app")}
          className="inline-flex items-center text-sm font-bold text-foreground bg-card hover:bg-muted border border-border/80 px-6 py-3 rounded-full shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Return to Dashboard
        </button>
      </div>

      {/* Persistent Progress Indicator */}
      <div className="mb-8 flex items-center justify-between bg-card border border-border/40 p-5 rounded-2xl shadow-sm">
        <div className="flex flex-col">
          <span className="text-xs font-bold uppercase tracking-widest text-primary mb-1">Step {step} of 2</span>
          <span className="text-lg font-bold text-foreground">
            {step === 1 ? "Choose an extraction mode" : "Upload documents"}
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
            <PresetSelector value={mode} onChange={(id) => setMode(id)} customPrompt={customPrompt} onCustomPromptChange={setCustomPrompt} />
            <div className="flex flex-col items-end gap-2 mt-6">
              <button
                onClick={() => setStep(2)}
                disabled={!canContinue}
                className="bg-primary text-primary-foreground px-10 py-4 rounded-full font-bold shadow-md hover:bg-primary/90 transition-all hover:scale-[1.02] active:scale-[0.98] text-sm uppercase tracking-wide disabled:opacity-50 disabled:pointer-events-none"
              >
                Continue to Upload
              </button>
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
