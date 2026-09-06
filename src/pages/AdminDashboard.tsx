// ---------------------------------------------------------------------------
// Admin console.
//
// Real platform metrics and dynamic model configuration from the database.
// Provider configuration is shown as configured / active model names.
// Models can be configured and dynamically tested live directly from this console.
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Download,
  FileText,
  FileUp,
  Gauge,
  Globe,
  Key,
  Languages,
  Mail,
  PenLine,
  PlayCircle,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  Terminal,
  Users,
  X,
  Zap,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState, ListSkeleton, PageHeader, StatCard } from "@/components/app";
import { usePageTitle } from "@/lib/use-page-title";
import {
  useAdminMetrics,
  useAdminSettings,
  useUpdateAdminSettings,
  useTestModel,
  useAdminUsers,
  type AdminMetrics,
  type AdminUser,
  type TestModelPayload,
  type TestModelResult,
} from "@/lib/api-client";
import { downloadBlob } from "@/lib/xlsx-writer";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

function timeAgo(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceToNow(d, { addSuffix: true });
}

export function formatBedrockModelLabel(modelId: string): string {
  if (modelId === "anthropic.claude-3-7-sonnet-20250219-v1:0") {
    return "Claude 3.7 Sonnet (✍️ Best Handwriting & 🌐 Multilingual)";
  }
  if (modelId === "anthropic.claude-3-5-sonnet-20241022-v2:0") {
    return "Claude 3.5 Sonnet v2 (🎯 Highest Accuracy OCR)";
  }
  if (modelId === "anthropic.claude-3-5-sonnet-20240620-v1:0") {
    return "Claude 3.5 Sonnet (High-Accuracy Vision)";
  }
  if (modelId === "anthropic.claude-3-opus-20240229-v1:0") {
    return "Claude 3 Opus (✍️ Complex Handwriting & Cursive)";
  }
  if (modelId === "amazon.nova-pro-v1:0") {
    return "Amazon Nova Pro (🌐 200+ Languages & Dense Tables)";
  }
  if (modelId === "amazon.nova-lite-v1:0") {
    return "Amazon Nova Lite (⚡ Ultra-Fast Multimodal)";
  }
  if (modelId === "anthropic.claude-3-5-haiku-20241022-v1:0") {
    return "Claude 3.5 Haiku (⚡ Fast & Modern)";
  }
  if (modelId === "anthropic.claude-3-haiku-20240307-v1:0") {
    return "Claude 3 Haiku (⚡ Fast & Budget)";
  }
  if (modelId === "anthropic.claude-3-sonnet-20240229-v1:0") {
    return "Claude 3 Sonnet (Balanced)";
  }
  if (modelId === "anthropic.claude-sonnet-4-20250514-v1:0") {
    return "Claude Sonnet 4 (Next-Gen Preview)";
  }
  if (modelId === "anthropic.claude-opus-4-20250514-v1:0") {
    return "Claude Opus 4 (Next-Gen Premium)";
  }
  if (modelId === "meta.llama3-2-90b-instruct-v1:0") {
    return "Llama 3.2 90B Vision (Open-Weights Flagship)";
  }
  if (modelId === "meta.llama3-2-11b-instruct-v1:0") {
    return "Llama 3.2 11B Vision (Fast Open-Weights)";
  }
  if (modelId === "mistral.pixtral-12b-2409-v1:0") {
    return "Mistral Pixtral 12B (Multimodal Vision)";
  }
  return modelId;
}


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
  testTarget?: "default" | "escalation" | "bedrock" | "textract";
}

function configRows(metrics: AdminMetrics): ConfigRow[] {
  const { providers, bindings } = metrics;
  return [
    {
      label: "Default extraction tier",
      state: providers.defaultTier,
      detail: "Runs on every page.",
      testTarget: "default",
    },
    {
      label: "High-accuracy tier",
      state: providers.escalationTier,
      detail: "Re-reads pages the default tier scored below the review threshold.",
      testTarget: "escalation",
    },
    {
      label: "AWS credentials",
      state: providers.awsConfigured,
      detail: providers.awsConfigured
        ? `Textract and Bedrock reachable in ${providers.awsRegion ?? "us-east-1"}.`
        : "Textract and Bedrock are not in use on this deployment.",
      testTarget: providers.awsConfigured ? "textract" : undefined,
    },
    {
      label: "Bedrock vision model",
      state: providers.bedrockModel,
      detail: providers.bedrockModel
        ? "Used for high-accuracy tier and AWS extraction."
        : "Not set, so AWS extraction uses Textract only.",
      testTarget: providers.bedrockModel ? "bedrock" : undefined,
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
      <Badge
        variant="outline"
        className="max-w-[16rem] truncate font-mono text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      >
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

  // Diagnostics test dialog and lab state
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [testTarget, setTestTarget] = useState<string>("default");
  const [customFile, setCustomFile] = useState<{
    contentType: string;
    dataUrl: string;
    filename: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const testLabRef = useRef<HTMLDivElement>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);

  type AdminTab = "overview" | "users" | "engines" | "testlab";
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userFilter, setUserFilter] = useState<"all" | "google" | "password" | "verified" | "admins">("all");
  const [inspectingUser, setInspectingUser] = useState<AdminUser | null>(null);

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.pushState(null, "", url.toString());
    }
  };

  const {
    data: usersData,
    isLoading: isUsersLoading,
    refetch: refetchUsers,
    isFetching: isUsersFetching,
  } = useAdminUsers({
    q: userSearchQuery.trim() || undefined,
    filter: userFilter,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tabParam = new URLSearchParams(window.location.search).get("tab");
    if (tabParam === "users" || tabParam === "overview" || tabParam === "engines" || tabParam === "testlab") {
      setActiveTab(tabParam as AdminTab);
    }
  }, []);

  const handleExportUsers = () => {
    if (!usersData?.users?.length) return;
    const header = "ID,Full Name,Email,Auth Provider,Verified,Created At,Last Login,Total Batches,Total Documents\n";
    const rows = usersData.users.map((u) =>
      [
        u.id,
        `"${(u.fullName || '').replace(/"/g, '""')}"`,
        `"${u.email.replace(/"/g, '""')}"`,
        u.authProvider,
        u.emailVerified ? "Yes" : "No",
        u.createdAt,
        u.lastLoginAt ?? "Never",
        u.totalBatches,
        u.totalDocuments,
      ].join(",")
    );
    const csv = header + rows.join("\n");
    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      `brainhalf-users-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    toast({
      title: "Users exported",
      description: `${usersData.users.length} accounts exported as CSV.`,
    });
  };

  const handleCopyRaw = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedRaw(true);
    setTimeout(() => setCopiedRaw(false), 2000);
    toast({
      title: "Copied to clipboard",
      description: "Raw response payload copied to clipboard.",
    });
  };

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

  const executeTest = (target: string, customDoc = customFile) => {
    let payload: TestModelPayload = {};
    if (target === "default" || target === "escalation") {
      payload = { tier: target };
    } else if (target === "bedrock") {
      payload = { provider: "bedrock", model: bedrockModel };
    } else if (target === "handwriting") {
      payload = { provider: "bedrock", model: bedrockModel, mode: "handwriting" };
    } else if (target === "multilingual") {
      payload = { provider: "bedrock", model: bedrockModel, mode: "multilingual" };
    } else if (target === "hunyuan") {
      payload = { provider: "hunyuan", model: hunyuanModel };
    } else if (target === "textract") {
      payload = { provider: "textract" };
    } else if (target === "openai") {
      payload = { provider: "openai", model: openaiModel };
    }

    if (customDoc) {
      payload.document = customDoc;
    }

    testModelMutation.mutate(payload, {
      onSuccess: (res: TestModelResult) => {
        if (res.success) {
          toast({
            title: "Test Succeeded",
            description: `${res.provider} (${res.model}) finished in ${res.latencyMs}ms.`,
          });
        } else {
          toast({
            variant: "destructive",
            title: "Test Failed",
            description: res.error || "Model returned an error.",
          });
        }
      },
      onError: (err) => {
        toast({
          variant: "destructive",
          title: "Test Request Failed",
          description: err instanceof Error ? err.message : "Network error.",
        });
      },
    });
  };

  const handleQuickTest = (target: string) => {
    setTestTarget(target);
    handleTabChange("testlab");
    setTimeout(() => {
      testLabRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    executeTest(target, customFile);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCustomFile({
        contentType: file.type || "image/jpeg",
        dataUrl: reader.result as string,
        filename: file.name,
      });
    };
    reader.readAsDataURL(file);
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
              variant="default"
              size="sm"
              onClick={() => {
                handleTabChange("testlab");
                setTimeout(() => {
                  testLabRef.current?.scrollIntoView({ behavior: "smooth" });
                }, 100);
              }}
              className="gap-2 bg-primary text-primary-foreground font-medium shadow-sm hover:opacity-95"
            >
              <PlayCircle className="h-4 w-4" aria-hidden />
              Test Lab
            </Button>
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
            <Button size="sm" variant="outline" onClick={handleExport} disabled={!data} className="gap-2">
              <Download className="h-4 w-4" aria-hidden />
              Export
            </Button>
          </>
        }
      />

      {/* Test Extraction Dialog */}
      <Dialog open={isTestModalOpen} onOpenChange={setIsTestModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <PlayCircle className="h-5 w-5 text-primary" />
              Live Model Extraction Test
            </DialogTitle>
            <DialogDescription>
              Execute a real OCR extraction request against any configured engine or tier. You can use the built-in test document or upload your own scan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-body-sm font-semibold text-foreground">Target Engine / Tier</label>
                <Select value={testTarget} onValueChange={setTestTarget}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select target" />
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

              <div className="space-y-2">
                <label className="text-body-sm font-semibold text-foreground">Test Document</label>
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-2 text-xs truncate"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <FileUp className="h-4 w-4 shrink-0" />
                    {customFile ? customFile.filename : "Upload custom file…"}
                  </Button>
                  {customFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setCustomFile(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-caption text-muted-foreground">
                  {customFile ? "Custom document loaded." : "Default: 1×1 sample receipt document."}
                </p>
              </div>
            </div>

            <Button
              onClick={() => executeTest(testTarget, customFile)}
              disabled={testModelMutation.isPending}
              className="w-full gap-2"
            >
              <PlayCircle className={`h-4 w-4 ${testModelMutation.isPending ? "animate-spin" : ""}`} />
              {testModelMutation.isPending ? "Extracting document upstream…" : "Run Test Now"}
            </Button>

            {testModelMutation.isPending && (
              <div className="flex items-center justify-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-6 text-body-sm text-primary">
                <RefreshCw className="h-5 w-5 animate-spin shrink-0" />
                Calling upstream engine and evaluating schema latency…
              </div>
            )}

            {testModelMutation.data && !testModelMutation.isPending && (
              <div
                className={`rounded-lg border p-4 space-y-4 ${
                  testModelMutation.data.success
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-destructive/30 bg-destructive/5"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                  <div className="flex items-center gap-2">
                    {testModelMutation.data.success ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                    )}
                    <span className="font-semibold text-body">
                      {testModelMutation.data.success ? "Test Passed" : "Test Failed"}
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
                  <div className="rounded bg-destructive/10 p-3 font-mono text-xs text-destructive">
                    {testModelMutation.data.error}
                  </div>
                )}

                {testModelMutation.data.fields && testModelMutation.data.fields.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-caption font-semibold text-foreground">Extracted Fields ({testModelMutation.data.fields.length}):</p>
                    <div className="max-h-48 overflow-auto rounded border border-border/60 bg-background/80">
                      <table className="w-full text-left text-caption divide-y divide-border/50">
                        <thead className="bg-muted/50 text-muted-foreground">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Field</th>
                            <th className="px-3 py-1.5 font-medium">Value</th>
                            <th className="px-3 py-1.5 font-medium">Confidence</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/40 font-mono">
                          {testModelMutation.data.fields.map((f, i) => (
                            <tr key={i} className="hover:bg-muted/20">
                              <td className="px-3 py-1 text-foreground font-medium">{f.label}</td>
                              <td className="px-3 py-1 text-muted-foreground">{f.value}</td>
                              <td className="px-3 py-1 text-emerald-600 dark:text-emerald-400">
                                {Math.round(f.confidence * 100)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {testModelMutation.data.preview && (
                  <div className="space-y-1">
                    <p className="text-caption font-medium text-muted-foreground">Raw Response Preview:</p>
                    <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-3 font-mono text-xs text-foreground">
                      {testModelMutation.data.preview}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
          {/* Navigation Tabs */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-3">
            <button
              onClick={() => handleTabChange("overview")}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all",
                activeTab === "overview"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <Activity className="h-4 w-4" />
              Overview &amp; Health
            </button>
            <button
              onClick={() => handleTabChange("users")}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all",
                activeTab === "users"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <Users className="h-4 w-4" />
              User Signups
              {usersData?.summary?.totalUsers !== undefined && (
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full text-xs font-mono",
                    activeTab === "users"
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {usersData.summary.totalUsers}
                </span>
              )}
            </button>
            <button
              onClick={() => handleTabChange("engines")}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all",
                activeTab === "engines"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <Sliders className="h-4 w-4" />
              AI Models &amp; Engines
            </button>
            <button
              onClick={() => handleTabChange("testlab")}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all",
                activeTab === "testlab"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
              )}
            >
              <PlayCircle className="h-4 w-4" />
              OCR Test Lab
            </button>
          </div>

          {activeTab === "overview" && (
            <>
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

          {/* Deployment Configuration Table with Direct Test Buttons */}
          <section
            aria-labelledby="admin-config"
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-muted/30 px-5 py-4">
              <div>
                <h2 id="admin-config" className="text-body-lg font-semibold text-foreground">
                  Deployment configuration
                </h2>
                <p className="mt-0.5 text-body-sm text-muted-foreground">
                  Presence only. Test any engine or tier directly using the test options below.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={() => handleTabChange("engines")}
                >
                  <Sliders className="h-3.5 w-3.5 text-primary" />
                  Configure Engines
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={() => handleTabChange("testlab")}
                >
                  <PlayCircle className="h-3.5 w-3.5 text-primary" />
                  Test Lab
                </Button>
              </div>
            </div>
            <dl className="divide-y divide-border/50">
              {rows.map((row) => (
                <div
                  key={row.label}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5 hover:bg-muted/10 transition-colors"
                >
                  <div className="min-w-0">
                    <dt className="text-body-sm font-semibold text-foreground">{row.label}</dt>
                    <dd className="text-caption text-muted-foreground">{row.detail}</dd>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StateBadge state={row.state} />
                    {row.testTarget && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => handleQuickTest(row.testTarget!)}
                        disabled={testModelMutation.isPending}
                        title={`Run live test for ${row.label}`}
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        Test
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </dl>
          </section>
            </>
          )}

          {/* Model Configuration & Engine Management Section */}
          {activeTab === "engines" && (
          <section
            aria-labelledby="model-management"
            className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-muted/30 px-5 py-4">
              <div>
                <h2 id="model-management" className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
                  <Sliders className="h-5 w-5 text-primary" aria-hidden />
                  Model Configuration &amp; Engine Management
                </h2>
                <p className="mt-0.5 text-body-sm text-muted-foreground">
                  Select default and high-accuracy extraction engines, models, and credentials. Overrides take effect immediately across all nodes.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTabChange("testlab")}
                  className="gap-2 text-xs"
                >
                  <PlayCircle className="h-4 w-4 text-primary" />
                  Test Lab
                </Button>
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
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
              {/* Default Tier Configuration */}
              <div className="space-y-4 rounded-lg border border-border/60 p-4 bg-background/50">
                <div className="flex items-center justify-between">
                  <h3 className="text-body font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    Default Extraction Tier
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Runs on every page</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-primary gap-1"
                      onClick={() => handleQuickTest("default")}
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      Test
                    </Button>
                  </div>
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
                      <SelectItem value="bedrock">AWS Bedrock (Multimodal Vision - Fast & Reliable)</SelectItem>
                      <SelectItem value="hunyuan">Hunyuan (Dedicated OCR Engine)</SelectItem>
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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">Re-reads low confidence</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-primary gap-1"
                      onClick={() => handleQuickTest("escalation")}
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      Test
                    </Button>
                  </div>
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
                            {formatBedrockModelLabel(m)}
                          </SelectItem>
                        ))
                      ) : (
                        <>
                          <SelectItem value="anthropic.claude-3-7-sonnet-20250219-v1:0" className="font-mono text-xs">
                            Claude 3.7 Sonnet (✍️ Best Handwriting &amp; 🌐 Multilingual)
                          </SelectItem>
                          <SelectItem value="anthropic.claude-3-5-sonnet-20241022-v2:0" className="font-mono text-xs">
                            Claude 3.5 Sonnet v2 (🎯 Highest Accuracy Vision &amp; OCR)
                          </SelectItem>
                          <SelectItem value="amazon.nova-pro-v1:0" className="font-mono text-xs">
                            Amazon Nova Pro (🌐 200+ Languages &amp; Tables)
                          </SelectItem>
                          <SelectItem value="amazon.nova-lite-v1:0" className="font-mono text-xs">
                            Amazon Nova Lite (⚡ Ultra-Fast Multimodal)
                          </SelectItem>
                          <SelectItem value="anthropic.claude-3-opus-20240229-v1:0" className="font-mono text-xs">
                            Claude 3 Opus (✍️ Complex Handwriting &amp; Cursive)
                          </SelectItem>
                          <SelectItem value="anthropic.claude-3-5-haiku-20241022-v1:0" className="font-mono text-xs">
                            Claude 3.5 Haiku (⚡ Fast &amp; Modern)
                          </SelectItem>
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
          )}

          {/* User Signups & Accounts Tab Content */}
          {activeTab === "users" && (
            <div className="space-y-6">
              {/* Summary Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-border/70 bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Total Signups</span>
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
                    {usersData?.summary?.totalUsers ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Registered user accounts</p>
                </div>

                <div className="rounded-xl border border-border/70 bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Verified Email</span>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                    {usersData?.summary?.verifiedUsers ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Confirmed emails</p>
                </div>

                <div className="rounded-xl border border-border/70 bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Google SSO</span>
                    <Globe className="h-4 w-4 text-blue-500" />
                  </div>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
                    {usersData?.summary?.googleUsers ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Google linked signups</p>
                </div>

                <div className="rounded-xl border border-border/70 bg-card p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Active (7 Days)</span>
                    <Activity className="h-4 w-4 text-amber-500" />
                  </div>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
                    {usersData?.summary?.active7d ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Active this week</p>
                </div>
              </div>

              {/* Search & Action Bar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto flex-1">
                  <div className="relative w-full sm:w-72">
                    <Input
                      type="search"
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      placeholder="Search by name or email..."
                      className="h-9 pr-8 text-xs rounded-xl bg-card border-border/70"
                    />
                    {userSearchQuery && (
                      <button
                        onClick={() => setUserSearchQuery("")}
                        className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <Select value={userFilter} onValueChange={(v: "all" | "google" | "password" | "verified" | "admins") => setUserFilter(v)}>
                    <SelectTrigger className="h-9 w-[150px] border-border/70 text-xs rounded-xl bg-card">
                      <SelectValue placeholder="Filter users" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="all">All accounts</SelectItem>
                      <SelectItem value="google">Google SSO only</SelectItem>
                      <SelectItem value="password">Email / Password</SelectItem>
                      <SelectItem value="verified">Verified only</SelectItem>
                      <SelectItem value="admins">Admins only</SelectItem>
                    </SelectContent>
                  </Select>

                  {(userSearchQuery || userFilter !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setUserSearchQuery("");
                        setUserFilter("all");
                      }}
                      className="h-9 px-2 text-xs"
                    >
                      <X className="h-3 w-3 mr-1" /> Reset
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetchUsers()}
                    disabled={isUsersFetching}
                    className="h-9 gap-1.5 rounded-xl text-xs"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", isUsersFetching && "animate-spin")} />
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportUsers}
                    disabled={!usersData?.users?.length}
                    className="h-9 gap-1.5 rounded-xl text-xs font-semibold"
                  >
                    <Download className="h-3.5 w-3.5 text-primary" />
                    Export Users (.csv)
                  </Button>
                </div>
              </div>

              {/* Users Table */}
              {isUsersLoading ? (
                <ListSkeleton rows={5} />
              ) : !usersData?.users?.length ? (
                <div className="rounded-xl border border-dashed border-border/80 p-8 text-center bg-card">
                  <Users className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-body-sm font-semibold text-foreground">No users match criteria</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Try widening your search or clearing the filter.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-3">User</th>
                          <th className="px-4 py-3">Auth Method</th>
                          <th className="px-4 py-3">Role &amp; Status</th>
                          <th className="px-4 py-3">Usage Activity</th>
                          <th className="px-4 py-3">Signed Up</th>
                          <th className="px-4 py-3">Last Active</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50 text-xs">
                        {usersData.users.map((u) => (
                          <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs overflow-hidden border border-border/60 shrink-0">
                                  {u.pictureUrl ? (
                                    <img src={u.pictureUrl} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    (u.firstName?.[0] || u.email[0] || "U").toUpperCase()
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground truncate">{u.fullName}</p>
                                  <p className="text-muted-foreground truncate text-[11px] font-mono">{u.email}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {u.authProvider === "google" ? (
                                <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 gap-1 text-[10px]">
                                  <Globe className="h-2.5 w-2.5" />
                                  Google SSO
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-border/60 bg-muted/60 text-muted-foreground gap-1 text-[10px]">
                                  <Mail className="h-2.5 w-2.5" />
                                  Email / Password
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {u.isAdmin ? (
                                  <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[10px]">
                                    Admin
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-muted-foreground text-[10px]">
                                    User
                                  </Badge>
                                )}
                                {u.emailVerified ? (
                                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                                    Verified
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-muted-foreground/70 text-[10px]">
                                    Unverified
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-foreground">
                                {u.totalBatches} batch{u.totalBatches === 1 ? "" : "es"}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {u.totalDocuments} doc{u.totalDocuments === 1 ? "" : "s"}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              <p>{new Date(u.createdAt).toLocaleDateString()}</p>
                              <p className="text-[10px] text-muted-foreground/70">{timeAgo(u.createdAt)}</p>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              {u.lastLoginAt ? (
                                <>
                                  <p>{new Date(u.lastLoginAt).toLocaleDateString()}</p>
                                  <p className="text-[10px] text-muted-foreground/70">{timeAgo(u.lastLoginAt)}</p>
                                </>
                              ) : (
                                <span className="text-muted-foreground/50">Never</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setInspectingUser(u)}
                                className="h-7 text-xs px-2 rounded-lg"
                              >
                                Inspect
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Interactive Live Model & OCR Testing Lab */}
          {activeTab === "testlab" && (
            <section
              ref={testLabRef}
              id="test-lab"
              aria-labelledby="test-lab-heading"
              className="overflow-hidden rounded-xl border border-border bg-card shadow-sm scroll-mt-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-muted/30 px-5 py-4">
                <div>
                  <h2 id="test-lab-heading" className="flex items-center gap-2 text-body-lg font-semibold text-foreground">
                  <PlayCircle className="h-5 w-5 text-primary" aria-hidden />
                  Interactive Model & OCR Testing Lab
                </h2>
                <p className="mt-0.5 text-body-sm text-muted-foreground">
                  Test and benchmark any active tier or AI engine in real-time. Verify latency, token consumption, and field extraction accuracy.
                </p>
              </div>
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary font-medium text-xs px-2.5 py-1 flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Live Verification
              </Badge>
            </div>

            <div className="p-6 space-y-6">
              {/* Quick Preset Selector Chips */}
              <div className="space-y-2">
                <label className="text-caption font-semibold text-foreground">Quick Test Targets</label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={testTarget === "default" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      setTestTarget("default");
                      executeTest("default", customFile);
                    }}
                    disabled={testModelMutation.isPending}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Default Tier ({defaultTierProvider})
                  </Button>
                  <Button
                    type="button"
                    variant={testTarget === "escalation" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      setTestTarget("escalation");
                      executeTest("escalation", customFile);
                    }}
                    disabled={testModelMutation.isPending}
                  >
                    <Cpu className="h-3.5 w-3.5" />
                    High-Accuracy Tier ({highAccuracyProvider})
                  </Button>
                  <Button
                    type="button"
                    variant={testTarget === "bedrock" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      setTestTarget("bedrock");
                      executeTest("bedrock", customFile);
                    }}
                    disabled={testModelMutation.isPending}
                  >
                    <Zap className="h-3.5 w-3.5" />
                    AWS Bedrock ({bedrockModel.split(".")[1] || bedrockModel})
                  </Button>
                  <Button
                    type="button"
                    variant={testTarget === "handwriting" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      setTestTarget("handwriting");
                      executeTest("handwriting", customFile);
                    }}
                    disabled={testModelMutation.isPending}
                  >
                    <PenLine className="h-3.5 w-3.5 text-purple-500" />
                    ✍️ Handwriting Test
                  </Button>
                  <Button
                    type="button"
                    variant={testTarget === "multilingual" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      setTestTarget("multilingual");
                      executeTest("multilingual", customFile);
                    }}
                    disabled={testModelMutation.isPending}
                  >
                    <Languages className="h-3.5 w-3.5 text-amber-500" />
                    🌐 Multilingual Test
                  </Button>
                  <Button
                    type="button"
                    variant={testTarget === "hunyuan" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      setTestTarget("hunyuan");
                      executeTest("hunyuan", customFile);
                    }}
                    disabled={testModelMutation.isPending}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Hunyuan OCR
                  </Button>
                  <Button
                    type="button"
                    variant={testTarget === "textract" ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => {
                      setTestTarget("textract");
                      executeTest("textract", customFile);
                    }}
                    disabled={testModelMutation.isPending}
                  >
                    <Gauge className="h-3.5 w-3.5" />
                    AWS Textract
                  </Button>
                </div>
              </div>

              {/* Custom Target and Document Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/50">
                <div className="space-y-2">
                  <label className="text-body-sm font-semibold text-foreground">Select Target Engine / Model</label>
                  <Select value={testTarget} onValueChange={setTestTarget}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select target engine" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default Tier (Current active engine: {defaultTierProvider})</SelectItem>
                      <SelectItem value="escalation">High-Accuracy Tier (Escalation: {highAccuracyProvider})</SelectItem>
                      <SelectItem value="bedrock">AWS Bedrock ({bedrockModel})</SelectItem>
                      <SelectItem value="hunyuan">Tencent Hunyuan ({hunyuanModel})</SelectItem>
                      <SelectItem value="textract">AWS Textract (Native OCR)</SelectItem>
                      <SelectItem value="openai">OpenAI ({openaiModel})</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-body-sm font-semibold text-foreground">Test Document</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-2 text-xs truncate"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FileUp className="h-4 w-4 shrink-0" />
                      {customFile ? customFile.filename : "Upload custom scan / photo / PDF…"}
                    </Button>
                    {customFile && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setCustomFile(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {customFile
                      ? `Custom file loaded (${customFile.filename}). Ready to extract.`
                      : "Default: Built-in 320×120 synthetic document scan."}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => executeTest(testTarget, customFile)}
                  disabled={testModelMutation.isPending}
                  className="gap-2 bg-primary text-primary-foreground font-medium px-5"
                >
                  <PlayCircle className={`h-4 w-4 ${testModelMutation.isPending ? "animate-spin" : ""}`} />
                  {testModelMutation.isPending ? "Running extraction test…" : "Run Extraction Test"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsTestModalOpen(true)}
                  className="gap-2"
                >
                  <Terminal className="h-4 w-4 text-muted-foreground" />
                  Open in Floating Window
                </Button>
              </div>

              {/* Progress State */}
              {testModelMutation.isPending && (
                <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-5 text-body-sm text-primary animate-pulse">
                  <RefreshCw className="h-5 w-5 animate-spin shrink-0" />
                  <div>
                    <p className="font-semibold">Executing upstream extraction test…</p>
                    <p className="text-caption text-primary/80">Signing payload, querying AI engine, and calculating latency.</p>
                  </div>
                </div>
              )}

              {/* Live Test Results Panel */}
              {testModelMutation.data && !testModelMutation.isPending && (
                <div
                  className={`rounded-lg border p-5 space-y-4 ${
                    testModelMutation.data.success
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-destructive/30 bg-destructive/5"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {testModelMutation.data.success ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                      )}
                      <span className="font-bold text-body">
                        {testModelMutation.data.success ? "Extraction Successful" : "Extraction Failed"}
                      </span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {testModelMutation.data.provider}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-xs">
                        {testModelMutation.data.model}
                      </Badge>
                      {testModelMutation.data.tier && (
                        <Badge variant="secondary" className="text-xs capitalize">
                          {testModelMutation.data.tier} tier
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-4 text-caption text-muted-foreground">
                      <span>Latency: <strong className="text-foreground">{testModelMutation.data.latencyMs} ms</strong></span>
                      {typeof testModelMutation.data.tokensUsed === "number" && (
                        <span>Tokens: <strong className="text-foreground">{testModelMutation.data.tokensUsed}</strong></span>
                      )}
                    </div>
                  </div>

                  {testModelMutation.data.error && (
                    <div className="rounded-lg bg-destructive/10 p-3.5 font-mono text-xs text-destructive border border-destructive/20">
                      <strong>Error: </strong>{testModelMutation.data.error}
                    </div>
                  )}

                  {testModelMutation.data.fields && testModelMutation.data.fields.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-caption font-semibold text-foreground">
                          Parsed Fields ({testModelMutation.data.fields.length}):
                        </p>
                        <span className="text-caption text-muted-foreground">
                          Confidence score computed per-field
                        </span>
                      </div>
                      <div className="max-h-56 overflow-auto rounded-lg border border-border/60 bg-background/80">
                        <table className="w-full text-left text-caption divide-y divide-border/50">
                          <thead className="bg-muted/50 text-muted-foreground">
                            <tr>
                              <th className="px-3.5 py-2 font-semibold">Field</th>
                              <th className="px-3.5 py-2 font-semibold">Extracted Value</th>
                              <th className="px-3.5 py-2 font-semibold">Confidence</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/40 font-mono">
                            {testModelMutation.data.fields.map((f, i) => (
                              <tr key={i} className="hover:bg-muted/20">
                                <td className="px-3.5 py-1.5 text-foreground font-medium">{f.label}</td>
                                <td className="px-3.5 py-1.5 text-muted-foreground">{f.value}</td>
                                <td className="px-3.5 py-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                                  {Math.round(f.confidence * 100)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {testModelMutation.data.preview && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-caption font-semibold text-muted-foreground">Raw Model Response / Output:</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() => handleCopyRaw(testModelMutation.data!.preview!)}
                        >
                          {copiedRaw ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedRaw ? "Copied" : "Copy Raw"}
                        </Button>
                      </div>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-muted/60 p-3.5 font-mono text-xs text-foreground border border-border/50">
                        {testModelMutation.data.preview}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
          )}
        </div>
      )}

      {/* Inspect User Account Modal */}
      <Dialog open={inspectingUser !== null} onOpenChange={(open) => !open && setInspectingUser(null)}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Users className="h-5 w-5 text-primary" />
              User Account Profile
            </DialogTitle>
            <DialogDescription>
              Registration, authentication, and usage analytics for this account.
            </DialogDescription>
          </DialogHeader>

          {inspectingUser && (
            <div className="space-y-4 pt-2 text-xs">
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-muted/40 border border-border/60">
                <div className="h-10 w-10 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm overflow-hidden border border-border/60 shrink-0">
                  {inspectingUser.pictureUrl ? (
                    <img src={inspectingUser.pictureUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    (inspectingUser.firstName?.[0] || inspectingUser.email[0] || "U").toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-foreground truncate">{inspectingUser.fullName}</p>
                  <p className="text-muted-foreground truncate font-mono text-[11px]">{inspectingUser.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 rounded-xl border border-border/50 bg-background/50">
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">User ID</span>
                  <span className="font-mono text-[11px] text-foreground truncate block">{inspectingUser.id}</span>
                </div>
                <div className="p-2.5 rounded-xl border border-border/50 bg-background/50">
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Auth Method</span>
                  <span className="font-semibold text-foreground capitalize">{inspectingUser.authProvider} SSO</span>
                </div>
                <div className="p-2.5 rounded-xl border border-border/50 bg-background/50">
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Email Status</span>
                  <span className={cn("font-semibold", inspectingUser.emailVerified ? "text-emerald-600" : "text-amber-600")}>
                    {inspectingUser.emailVerified ? "Verified" : "Unverified"}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl border border-border/50 bg-background/50">
                  <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Role</span>
                  <span className={cn("font-semibold", inspectingUser.isAdmin ? "text-primary font-bold" : "text-foreground")}>
                    {inspectingUser.isAdmin ? "Administrator" : "Standard User"}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Batches Created:</span>
                  <span className="font-bold text-foreground">{inspectingUser.totalBatches} runs</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Documents Processed:</span>
                  <span className="font-bold text-foreground">{inspectingUser.totalDocuments} pages</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Joined:</span>
                  <span className="text-foreground">{new Date(inspectingUser.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Last Activity:</span>
                  <span className="text-foreground">
                    {inspectingUser.lastLoginAt ? new Date(inspectingUser.lastLoginAt).toLocaleString() : "Never"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

