// ---------------------------------------------------------------------------
// Admin console.
//
// Real platform metrics and dynamic model configuration from the database.
// Provider configuration is shown as configured / active model names.
// Models can be configured and dynamically tested live directly from this console.
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileText,
  Gauge,
  Key,
  PlayCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorState, ListSkeleton, PageHeader, StatCard } from "@/components/app";
import { usePageTitle } from "@/lib/use-page-title";
import {
  useAdminMetrics,
  useAdminSettings,
  useUpdateAdminSettings,
  useTestModel,
  type AdminMetrics,
  type TestModelPayload,
} from "@/lib/api-client";
import { downloadBlob } from "@/lib/xlsx-writer";
import { useToast } from "@/hooks/use-toast";

/** "—" rather than "0%" or "100%": an unmeasured rate is not a good one. */
function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function integer(value: number): string {
  return value.toLocaleString();
}

interface ConfigRow {
  label: string;
  /** True = configured, false = not, string = a non-secret value worth showing. */
  state: boolean | string | null;
  detail: string;
}

function configRows(metrics: AdminMetrics): ConfigRow[] {
  const { providers, bindings } = metrics;
  return [
    {
      label: "Default extraction tier",
      state: providers.defaultTier,
      detail: "Runs on every page.",
    },
    {
      label: "High-accuracy tier",
      state: providers.escalationTier,
      detail: "Re-reads pages the default tier scored below the review threshold.",
    },
    {
      label: "AWS credentials",
      state: providers.awsConfigured,
      detail: providers.awsConfigured
        ? `Textract and Bedrock reachable in ${providers.awsRegion ?? "us-east-1"}.`
        : "Textract and Bedrock are not in use on this deployment.",
    },
    {
      label: "Bedrock vision model",
      state: providers.bedrockModel,
      detail: providers.bedrockModel
        ? "Used for high-accuracy tier and AWS extraction."
        : "Not set, so AWS extraction uses Textract only.",
    },
    {
      label: "Background queue",
      state: bindings.queue,
      detail: bindings.queue
        ? "Batches are extracted by the worker, so closing the tab is safe."
        : "Extraction runs in the browser: closing the tab stops the batch.",
    },
    {
      label: "Google sign-in",
      state: providers.googleSignIn,
      detail: "Client id present, so the Google button is offered.",
    },
    {
      label: "Transactional email",
      state: providers.transactionalEmail,
      detail: providers.transactionalEmail
        ? "Password resets and contact messages are delivered."
        : "Password reset tokens are created but not emailed.",
    },
    {
      label: "Document storage",
      state: bindings.storage,
      detail: "R2 bucket holding the uploaded originals.",
    },
  ];
}

function StateBadge({ state }: { state: boolean | string | null }) {
  if (typeof state === "string") {
    return (
      <Badge variant="outline" className="max-w-[16rem] truncate font-mono text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        {state}
      </Badge>
    );
  }
  if (state) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      >
        Configured
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Not configured
    </Badge>
  );
}

export default function AdminDashboard() {
  usePageTitle("Admin console · BrainHalf", { canonicalPath: "/app/admin", noindex: true });
  const { toast } = useToast();

  const { data, isLoading, isError, error, refetch, isFetching } = useAdminMetrics({
    query: { refetchInterval: 30_000 },
  });

  const {
    data: settingsData,
    isLoading: isSettingsLoading,
    refetch: refetchSettings,
  } = useAdminSettings();

  const updateSettingsMutation = useUpdateAdminSettings();
  const testModelMutation = useTestModel();

  // Model configuration form state
  const [defaultTierProvider, setDefaultTierProvider] = useState<"hunyuan" | "bedrock" | "openai">("hunyuan");
  const [hunyuanModel, setHunyuanModel] = useState<string>("hunyuan-ocr");
  const [highAccuracyProvider, setHighAccuracyProvider] = useState<"bedrock" | "openai">("bedrock");
  const [bedrockModel, setBedrockModel] = useState<string>("amazon.nova-lite-v1:0");
  const [openaiModel, setOpenAIModel] = useState<string>("gpt-4o-mini");
  const [openaiApiKey, setOpenAIApiKey] = useState<string>("");

  // Diagnostics test target state
  const [testTarget, setTestTarget] = useState<string>("default");

  // Sync state from server settings
  useEffect(() => {
    if (settingsData?.settings) {
      const s = settingsData.settings;
      setDefaultTierProvider(s.defaultTierProvider || "hunyuan");
      setHunyuanModel(s.hunyuanModel || "hunyuan-ocr");
      setHighAccuracyProvider(s.highAccuracyProvider || "bedrock");
      setBedrockModel(s.bedrockModel || "amazon.nova-lite-v1:0");
      setOpenAIModel(s.openaiModel || "gpt-4o-mini");
    }
  }, [settingsData]);

  const rows = useMemo(() => (data ? configRows(data) : []), [data]);

  const handleExport = () => {
    if (!data) return;
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `brainhalf-metrics-${data.generatedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`,
    );
    toast({
      title: "Metrics exported",
      description: "The figures shown on this page were saved as JSON.",
    });
  };

  const handleSaveSettings = () => {
    updateSettingsMutation.mutate(
      {
        defaultTierProvider,
        hunyuanModel,
        highAccuracyProvider,
        bedrockModel,
        openaiModel,
        openaiApiKey: openaiApiKey.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast({
            title: "Configuration saved",
            description: "Engine choices and active models updated across all nodes.",
          });
          setOpenAIApiKey("");
          void refetchSettings();
          void refetch();
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Failed to save configuration",
            description: err instanceof Error ? err.message : "An unexpected error occurred.",
          });
        },
      },
    );
  };

  const handleRunDiagnostic = () => {
    let payload: TestModelPayload = {};
    if (testTarget === "default" || testTarget === "escalation") {
      payload = { tier: testTarget };
    } else if (testTarget === "bedrock") {
      payload = { provider: "bedrock", model: bedrockModel };
    } else if (testTarget === "hunyuan") {
      payload = { provider: "hunyuan", model: hunyuanModel };
    } else if (testTarget === "textract") {
      payload = { provider: "textract" };
    } else if (testTarget === "openai") {
      payload = { provider: "openai", model: openaiModel };
    }

    testModelMutation.mutate(payload, {
      onSuccess: (res) => {
        if (res.success) {
          toast({
            title: "Diagnostic passed",
            description: `${res.provider} (${res.model}) responded successfully in ${res.latencyMs}ms.`,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Diagnostic test failed",
            description: res.error || "Model returned an error response.",
          });
        }
      },
      onError: (err) => {
        toast({
          variant: "destructive",
          title: "Diagnostic request failed",
          description: err instanceof Error ? err.message : "Network error.",
        });
      },
    });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Admin console
          </>
        }
        title="Platform overview"
        description={
          data
            ? `Counted from the database at ${new Date(data.generatedAt).toLocaleTimeString()}.`
            : "Live counts from the application database."
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refetch();
                void refetchSettings();
              }}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden />
              {isFetching ? "Refreshing…" : "Refresh"}
            </Button>
            <Button size="sm" onClick={handleExport} disabled={!data} className="gap-2">
              <Download className="h-4 w-4" aria-hidden />
              Export metrics
            </Button>
          </>
        }
      />

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : isError || !data ? (
        <ErrorState
          title="Metrics are not available"
          body={
            error?.message ??
            "This account cannot read platform metrics, or the database is unreachable."
          }
          onRetry={() => {
            void refetch();
            void refetchSettings();
          }}
        />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="admin-throughput">
            <h2 id="admin-throughput" className="sr-only">
              Throughput
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Documents"
                value={integer(data.counts.documents)}
                hint={`in ${integer(data.counts.batches)} batches`}
                icon={FileText}
                tone="primary"
              />
              <StatCard
                label="Completed"
                value={integer(data.counts.completed)}
                hint={`${integer(data.counts.completedLastDay)} in the last day`}
                icon={CheckCircle2}
                tone={data.counts.completed > 0 ? "success" : "muted"}
              />
              <StatCard
                label="In flight"
                value={integer(data.counts.queued + data.counts.processing)}
                hint={`${integer(data.counts.queued)} queued`}
                icon={Activity}
                tone={data.counts.queued + data.counts.processing > 0 ? "warning" : "muted"}
              />
              <StatCard
                label="Failed"
                value={integer(data.counts.failed)}
                hint={data.counts.failed > 0 ? "needs a retry" : undefined}
                icon={AlertTriangle}
                tone={data.counts.failed > 0 ? "destructive" : "muted"}
              />
            </div>
          </section>

          <section aria-labelledby="admin-quality">
            <h2 id="admin-quality" className="sr-only">
              Extraction quality
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Completion rate"
                value={percent(data.quality.successRate)}
                hint={
                  data.quality.successRate === null
                    ? "nothing finished yet"
                    : "of documents that finished"
                }
                icon={Gauge}
                tone={
                  data.quality.successRate === null
                    ? "muted"
                    : data.quality.successRate >= 0.95
                      ? "success"
                      : "warning"
                }
              />
              <StatCard
                label="Mean confidence"
                value={percent(data.quality.meanConfidence)}
                hint={
                  data.quality.meanConfidence === null
                    ? "nothing scored yet"
                    : "across scored documents"
                }
                icon={Cpu}
                tone={
                  data.quality.meanConfidence === null
                    ? "muted"
                    : data.quality.meanConfidence >= data.quality.threshold
                      ? "success"
                      : "warning"
                }
              />
              <StatCard
                label="Below threshold"
                value={integer(data.quality.belowThreshold)}
                hint={`under ${Math.round(data.quality.threshold * 100)}%`}
                icon={AlertTriangle}
                tone={data.quality.belowThreshold > 0 ? "warning" : "muted"}
              />
              <StatCard
                label="Registered users"
                value={integer(data.counts.users)}
                icon={Users}
                tone="primary"
              />
            </div>
          </section>

          {data.counts.stuck > 0 ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
            >
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div className="space-y-1">
                <p className="text-body font-semibold text-foreground">
                  {integer(data.counts.stuck)} document
                  {data.counts.stuck === 1 ? "" : "s"} interrupted mid-extraction
                </p>
                <p className="text-body-sm text-muted-foreground">
                  These have been processing longer than the recovery threshold. The
                  sweep in server/stuck-documents.ts returns them to the queue
                  automatically and fails them once they run out of attempts, so this
                  should clear itself.
                </p>
              </div>
            </div>
          ) : null}

          {/* Model Configuration & Engine Management Section */}
          <section
            aria-labelledby="model-management"
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-muted/30 px-5 py-4">
              <div>
                <h2 id="model-management" className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
                  <Sliders className="h-5 w-5 text-primary" aria-hidden />
                  Model Configuration & Engine Management
                </h2>
                <p className="mt-0.5 text-body-sm text-muted-foreground">
                  Select default and high-accuracy extraction engines, models, and credentials. Overrides take effect immediately without redeployment.
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleSaveSettings}
                disabled={updateSettingsMutation.isPending || isSettingsLoading}
                className="gap-2"
              >
                <Save className={`h-4 w-4 ${updateSettingsMutation.isPending ? "animate-spin" : ""}`} aria-hidden />
                {updateSettingsMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
              {/* Default Tier Configuration */}
              <div className="space-y-4 rounded-lg border border-border/60 p-4 bg-background/50">
                <div className="flex items-center justify-between">
                  <h3 className="text-body font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    Default Extraction Tier
                  </h3>
                  <Badge variant="outline" className="text-xs">Runs on every page</Badge>
                </div>
                
                <div className="space-y-2">
                  <label className="text-caption font-medium text-foreground">Default Engine</label>
                  <Select
                    value={defaultTierProvider}
                    onValueChange={(val: "hunyuan" | "bedrock" | "openai") => setDefaultTierProvider(val)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select Default Engine" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hunyuan">Hunyuan (Dedicated OCR Engine)</SelectItem>
                      <SelectItem value="bedrock">AWS Bedrock (Multimodal Vision)</SelectItem>
                      <SelectItem value="openai">OpenAI (Vision Model)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {defaultTierProvider === "hunyuan" && (
                  <div className="space-y-2">
                    <label className="text-caption font-medium text-foreground">Hunyuan Model</label>
                    <Select
                      value={hunyuanModel}
                      onValueChange={(val) => setHunyuanModel(val)}
                    >
                      <SelectTrigger className="w-full font-mono text-xs">
                        <SelectValue placeholder="Select Hunyuan Model" />
                      </SelectTrigger>
                      <SelectContent>
                        {settingsData?.availableModels?.hunyuan ? (
                          settingsData.availableModels.hunyuan.map((m) => (
                            <SelectItem key={m} value={m} className="font-mono text-xs">
                              {m}
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="hunyuan-ocr" className="font-mono text-xs">hunyuan-ocr</SelectItem>
                            <SelectItem value="hunyuan-standard" className="font-mono text-xs">hunyuan-standard</SelectItem>
                            <SelectItem value="hunyuan-turbo" className="font-mono text-xs">hunyuan-turbo</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {/* High-Accuracy Tier Configuration */}
              <div className="space-y-4 rounded-lg border border-border/60 p-4 bg-background/50">
                <div className="flex items-center justify-between">
                  <h3 className="text-body font-semibold text-foreground flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-blue-500" />
                    High-Accuracy (Escalation) Tier
                  </h3>
                  <Badge variant="outline" className="text-xs">Re-reads low confidence</Badge>
                </div>

                <div className="space-y-2">
                  <label className="text-caption font-medium text-foreground">Escalation Engine</label>
                  <Select
                    value={highAccuracyProvider}
                    onValueChange={(val: "bedrock" | "openai") => setHighAccuracyProvider(val)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select High-Accuracy Engine" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bedrock">AWS Bedrock (Recommended)</SelectItem>
                      <SelectItem value="openai">OpenAI (GPT-4o / Vision)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-caption font-medium text-foreground">AWS Bedrock Vision Model</label>
                  <Select
                    value={bedrockModel}
                    onValueChange={(val) => setBedrockModel(val)}
                  >
                    <SelectTrigger className="w-full font-mono text-xs">
                      <SelectValue placeholder="Select Bedrock Model" />
                    </SelectTrigger>
                    <SelectContent>
                      {settingsData?.availableModels?.bedrock ? (
                        settingsData.availableModels.bedrock.map((m) => (
                          <SelectItem key={m} value={m} className="font-mono text-xs">
                            {m}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="amazon.nova-lite-v1:0" className="font-mono text-xs">amazon.nova-lite-v1:0 (Fast Multimodal)</SelectItem>
                          <SelectItem value="amazon.nova-pro-v1:0" className="font-mono text-xs">amazon.nova-pro-v1:0 (High Accuracy)</SelectItem>
                          <SelectItem value="anthropic.claude-3-haiku-20240307-v1:0" className="font-mono text-xs">anthropic.claude-3-haiku-20240307-v1:0</SelectItem>
                          <SelectItem value="anthropic.claude-3-5-sonnet-20240620-v1:0" className="font-mono text-xs">anthropic.claude-3-5-sonnet-20240620-v1:0</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* OpenAI Model and Optional Credentials */}
              <div className="space-y-4 rounded-lg border border-border/60 p-4 bg-background/50 md:col-span-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-body font-semibold text-foreground flex items-center gap-2">
                    <Key className="h-4 w-4 text-emerald-500" />
                    OpenAI Integration (Optional Alternative)
                  </h3>
                  {settingsData?.settings?.providersStatus?.openai ? (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs">
                      Configured ({settingsData.settings.openaiApiKeyMasked ?? "Active"})
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground text-xs">
                      Not configured (Bedrock active)
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-caption font-medium text-foreground">OpenAI Model</label>
                    <Select
                      value={openaiModel}
                      onValueChange={(val) => setOpenAIModel(val)}
                    >
                      <SelectTrigger className="w-full font-mono text-xs">
                        <SelectValue placeholder="Select OpenAI Model" />
                      </SelectTrigger>
                      <SelectContent>
                        {settingsData?.availableModels?.openai ? (
                          settingsData.availableModels.openai.map((m) => (
                            <SelectItem key={m} value={m} className="font-mono text-xs">
                              {m}
                            </SelectItem>
                          ))
                        ) : (
                          <>
                            <SelectItem value="gpt-4o-mini" className="font-mono text-xs">gpt-4o-mini</SelectItem>
                            <SelectItem value="gpt-4o" className="font-mono text-xs">gpt-4o</SelectItem>
                            <SelectItem value="o3-mini" className="font-mono text-xs">o3-mini</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-caption font-medium text-foreground">
                      OpenAI API Key {settingsData?.settings?.openaiApiKeyMasked ? "(Leave blank to keep current)" : ""}
                    </label>
                    <Input
                      type="password"
                      placeholder={settingsData?.settings?.openaiApiKeyMasked || "sk-proj-..."}
                      value={openaiApiKey}
                      onChange={(e) => setOpenAIApiKey(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Model Diagnostics & Live Testing Tool */}
          <section
            aria-labelledby="model-diagnostics"
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border/60 bg-muted/30 px-5 py-4">
              <h2 id="model-diagnostics" className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
                <PlayCircle className="h-5 w-5 text-primary" aria-hidden />
                Model Diagnostics & Live Verification
              </h2>
              <p className="mt-0.5 text-body-sm text-muted-foreground">
                Perform an end-to-end extraction test against any configured engine or active tier to verify latency, token consumption, and response validity.
              </p>
            </div>

            <div className="p-6 space-y-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="min-w-[240px] flex-1">
                  <Select value={testTarget} onValueChange={setTestTarget}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select test target" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default Tier (Current configured engine)</SelectItem>
                      <SelectItem value="escalation">High-Accuracy Tier (Escalation)</SelectItem>
                      <SelectItem value="bedrock">AWS Bedrock ({bedrockModel})</SelectItem>
                      <SelectItem value="hunyuan">Tencent Hunyuan ({hunyuanModel})</SelectItem>
                      <SelectItem value="textract">AWS Textract (Analyze/Detect)</SelectItem>
                      <SelectItem value="openai">OpenAI ({openaiModel})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleRunDiagnostic}
                  disabled={testModelMutation.isPending}
                  className="gap-2"
                >
                  <PlayCircle className={`h-4 w-4 ${testModelMutation.isPending ? "animate-spin" : ""}`} aria-hidden />
                  {testModelMutation.isPending ? "Running test…" : "Run diagnostic test"}
                </Button>
              </div>

              {testModelMutation.isPending && (
                <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-body-sm text-primary">
                  <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                  Sending diagnostic document upstream to test latency and schema parsing…
                </div>
              )}

              {testModelMutation.data && (
                <div
                  className={`rounded-lg border p-4 space-y-3 ${
                    testModelMutation.data.success
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-destructive/30 bg-destructive/5"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {testModelMutation.data.success ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                      )}
                      <span className="font-semibold text-body">
                        {testModelMutation.data.success ? "Test Succeeded" : "Test Failed"}
                      </span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {testModelMutation.data.provider}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        {testModelMutation.data.model}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-3 text-caption text-muted-foreground">
                      <span>Latency: <strong className="text-foreground">{testModelMutation.data.latencyMs} ms</strong></span>
                      {typeof testModelMutation.data.tokensUsed === "number" && (
                        <span>Tokens: <strong className="text-foreground">{testModelMutation.data.tokensUsed}</strong></span>
                      )}
                    </div>
                  </div>

                  {testModelMutation.data.error && (
                    <div className="text-body-sm text-destructive font-mono bg-destructive/10 p-2 rounded">
                      {testModelMutation.data.error}
                    </div>
                  )}

                  {testModelMutation.data.preview && (
                    <div className="space-y-1">
                      <p className="text-caption font-medium text-muted-foreground">Parsed Extraction Preview:</p>
                      <pre className="max-h-48 overflow-auto rounded bg-muted/60 p-3 font-mono text-xs text-foreground">
                        {testModelMutation.data.preview}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Deployment Configuration Table */}
          <section
            aria-labelledby="admin-config"
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border/60 bg-muted/30 px-5 py-4">
              <h2 id="admin-config" className="text-body-lg font-semibold text-foreground">
                Deployment configuration
              </h2>
              <p className="mt-0.5 text-body-sm text-muted-foreground">
                Presence only. No credential, or any part of one, is sent to this page.
              </p>
            </div>
            <dl className="divide-y divide-border/50">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <dt className="text-body-sm font-semibold text-foreground">{row.label}</dt>
                    <dd className="text-caption text-muted-foreground">{row.detail}</dd>
                  </div>
                  <StateBadge state={row.state} />
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
