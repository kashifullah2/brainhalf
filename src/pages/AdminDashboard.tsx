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
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  Download,
  Eye,
  Gauge,
  FileText,
  FileUp,
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

  // Diagnostics test lab state
  const [testTarget, setTestTarget] = useState<string>("default");
  const [testDocSource, setTestDocSource] = useState<"sample" | "custom">("sample");
  const [customFile, setCustomFile] = useState<{
    contentType: string;
    dataUrl: string;
    filename: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const testLabRef = useRef<HTMLDivElement>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [testResultTab, setTestResultTab] = useState<"parsed" | "raw">("parsed");

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

  const executeTest = (target: string, customDoc = testDocSource === "custom" ? customFile : null) => {
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
    executeTest(target, testDocSource === "custom" ? customFile : null);
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
      setTestDocSource("custom");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      {/* Contextual Dynamic Page Header */}
      <PageHeader
        eyebrow={
          <>
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
            Admin Console
          </>
        }
        title={
          activeTab === "overview"
            ? "Platform Health & Metrics"
            : activeTab === "users"
              ? "User Accounts & Signups"
              : activeTab === "engines"
                ? "AI Models & Engine Orchestration"
                : "Live OCR Test & Benchmark Lab"
        }
        description={
          activeTab === "overview"
            ? data
              ? `Live system telemetry counted from the database at ${new Date(data.generatedAt).toLocaleTimeString()}.`
              : "Live telemetry from application database and edge infrastructure."
            : activeTab === "users"
              ? "Manage registered user accounts, authentication providers, and usage activity across BrainHalf."
              : activeTab === "engines"
                ? "Select default and high-accuracy vision models, Bedrock capability champions, and API keys."
                : "Benchmark vision models with live documents, measure extraction latency, and inspect JSON payloads."
        }
        actions={
          <>
            {activeTab === "overview" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTabChange("engines")}
                  className="gap-2 text-xs"
                >
                  <Sliders className="h-3.5 w-3.5 text-primary" />
                  Configure Models
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void refetch();
                    void refetchSettings();
                  }}
                  disabled={isFetching}
                  className="gap-2 text-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden />
                  {isFetching ? "Refreshing…" : "Refresh"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExport}
                  disabled={!data}
                  className="gap-2 text-xs"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Export JSON
                </Button>
              </>
            )}

            {activeTab === "users" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetchUsers()}
                  disabled={isUsersFetching}
                  className="gap-2 text-xs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isUsersFetching ? "animate-spin" : ""}`} aria-hidden />
                  {isUsersFetching ? "Refreshing…" : "Refresh"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportUsers}
                  disabled={!usersData?.users?.length}
                  className="gap-2 text-xs font-semibold"
                >
                  <Download className="h-3.5 w-3.5 text-primary" aria-hidden />
                  Export Users (.csv)
                </Button>
              </>
            )}

            {activeTab === "engines" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTabChange("testlab")}
                  className="gap-2 text-xs"
                >
                  <PlayCircle className="h-3.5 w-3.5 text-primary" />
                  Test Lab
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveSettings}
                  disabled={updateSettingsMutation.isPending || isSettingsLoading}
                  className="gap-2 text-xs font-semibold bg-primary text-primary-foreground shadow-xs"
                >
                  <Save className={`h-3.5 w-3.5 ${updateSettingsMutation.isPending ? "animate-spin" : ""}`} aria-hidden />
                  {updateSettingsMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </>
            )}

            {activeTab === "testlab" && (
              <Button
                variant="default"
                size="sm"
                onClick={() => executeTest(testTarget, testDocSource === "custom" ? customFile : null)}
                disabled={testModelMutation.isPending}
                className="gap-2 text-xs font-semibold bg-primary text-primary-foreground shadow-xs"
              >
                <PlayCircle className={`h-3.5 w-3.5 ${testModelMutation.isPending ? "animate-spin" : ""}`} aria-hidden />
                {testModelMutation.isPending ? "Extracting..." : "Run Test Now"}
              </Button>
            )}
          </>
        }
      />

      {/* Modern Executive Navigation Tabs Rail */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-3">
        <button
          onClick={() => handleTabChange("overview")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200",
            activeTab === "overview"
              ? "bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
          )}
        >
          <Activity className="h-4 w-4" />
          Overview &amp; Health
        </button>
        <button
          onClick={() => handleTabChange("users")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200",
            activeTab === "users"
              ? "bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
          )}
        >
          <Users className="h-4 w-4" />
          User Signups
          {usersData?.summary?.totalUsers !== undefined && (
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs font-mono font-bold",
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
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200",
            activeTab === "engines"
              ? "bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
          )}
        >
          <Sliders className="h-4 w-4" />
          AI Models &amp; Engines
        </button>
        <button
          onClick={() => handleTabChange("testlab")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200",
            activeTab === "testlab"
              ? "bg-primary text-primary-foreground shadow-xs ring-2 ring-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
          )}
        >
          <PlayCircle className="h-4 w-4" />
          OCR Test Lab
        </button>
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : isError ? (
        <ErrorState
          title="Couldn't load platform metrics"
          body={error instanceof Error ? error.message : "The metrics endpoint did not return a valid response."}
          onRetry={() => {
            void refetch();
            void refetchSettings();
          }}
        />
      ) : data ? (
        <div className="space-y-6">
          {/* TAB 1: OVERVIEW & HEALTH */}
          {activeTab === "overview" && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <section aria-labelledby="admin-throughput">
                <h2 id="admin-throughput" className="sr-only">Throughput</h2>
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

              {data.counts.stuck > 0 && (
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
                      These have been processing longer than the recovery threshold. The sweep returns them to the queue automatically.
                    </p>
                  </div>
                </div>
              )}

              {/* Deployment Configuration Table */}
              <section
                aria-labelledby="admin-config"
                className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-muted/30 px-5 py-4">
                  <div>
                    <h2 id="admin-config" className="text-body-lg font-semibold text-foreground">
                      Deployment Configuration &amp; Cloud Infrastructure
                    </h2>
                    <p className="mt-0.5 text-body-sm text-muted-foreground">
                      Hardware bindings, credentials, and models running live on Cloudflare Pages and Workers.
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
            </div>
          )}

          {/* TAB 2: USER SIGNUPS & ACCOUNTS */}
          {activeTab === "users" && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Executive KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-card to-primary/5 p-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Signups</span>
                    <div className="h-8 w-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                      <Users className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                    {usersData?.summary?.totalUsers ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Registered accounts</p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-card to-emerald-500/5 p-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Verified Email</span>
                    <div className="h-8 w-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center border border-emerald-500/20">
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                    {usersData?.summary?.verifiedUsers ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {usersData?.summary?.totalUsers
                      ? `${Math.round(((usersData.summary.verifiedUsers ?? 0) / usersData.summary.totalUsers) * 100)}% verified rate`
                      : "Confirmed emails"}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-card to-blue-500/5 p-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Google SSO</span>
                    <div className="h-8 w-8 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center border border-blue-500/20">
                      <Globe className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
                    {usersData?.summary?.googleUsers ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Google OAuth accounts</p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-card to-amber-500/5 p-4 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active (7 Days)</span>
                    <div className="h-8 w-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center border border-amber-500/20">
                      <Activity className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
                    {usersData?.summary?.active7d ?? 0}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Logged in this week</p>
                </div>
              </div>

              {/* Filter & Search Toolbar */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-card p-3 rounded-2xl border border-border/70 shadow-2xs">
                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto flex-1">
                  <div className="relative w-full sm:w-80">
                    <Input
                      type="search"
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      placeholder="Search users by name or email..."
                      className="h-9 pr-8 text-xs rounded-xl bg-background border-border/70"
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

                  {/* Filter Pills */}
                  <div className="flex flex-wrap items-center gap-1">
                    {(["all", "verified", "google", "password", "admins"] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setUserFilter(f)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-semibold capitalize transition-all",
                          userFilter === f
                            ? "bg-primary text-primary-foreground shadow-2xs"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        {f === "google" ? "Google SSO" : f === "password" ? "Password" : f}
                      </button>
                    ))}
                  </div>

                  {(userSearchQuery || userFilter !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setUserSearchQuery("");
                        setUserFilter("all");
                      }}
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3 mr-1" /> Reset
                    </Button>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void refetchUsers()}
                    disabled={isUsersFetching}
                    className="h-8 gap-1.5 rounded-xl text-xs"
                  >
                    <RefreshCw className={cn("h-3 w-3", isUsersFetching && "animate-spin")} />
                    Refresh
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportUsers}
                    disabled={!usersData?.users?.length}
                    className="h-8 gap-1.5 rounded-xl text-xs font-semibold"
                  >
                    <Download className="h-3 w-3 text-primary" />
                    Export CSV
                  </Button>
                </div>
              </div>

              {/* Users Table */}
              {isUsersLoading ? (
                <ListSkeleton rows={5} />
              ) : !usersData?.users?.length ? (
                <div className="rounded-2xl border border-dashed border-border/80 p-12 text-center bg-card">
                  <Users className="mx-auto h-9 w-9 text-muted-foreground mb-2 opacity-50" />
                  <p className="text-body-sm font-semibold text-foreground">No users match criteria</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Try changing your search terms or clearing filters.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-border/70 bg-card overflow-hidden shadow-2xs">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border/60 bg-muted/30 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <th className="px-5 py-3.5">User Account</th>
                          <th className="px-4 py-3.5">Auth Method</th>
                          <th className="px-4 py-3.5">Account Status</th>
                          <th className="px-4 py-3.5">Activity Volume</th>
                          <th className="px-4 py-3.5">Signed Up</th>
                          <th className="px-4 py-3.5">Last Active</th>
                          <th className="px-5 py-3.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50 text-xs">
                        {usersData.users.map((u) => (
                          <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs overflow-hidden border border-border/60 shrink-0 shadow-2xs">
                                  {u.pictureUrl ? (
                                    <img src={u.pictureUrl} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    (u.firstName?.[0] || u.email[0] || "U").toUpperCase()
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-foreground truncate text-body-sm">
                                    {u.fullName || "Anonymous User"}
                                  </p>
                                  <p className="text-muted-foreground truncate text-caption font-mono mt-0.5">
                                    {u.email}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5">
                              {u.authProvider === "google" ? (
                                <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 gap-1.5 text-[11px] font-medium py-0.5">
                                  <Globe className="h-3 w-3" />
                                  Google SSO
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-border/60 bg-muted/60 text-muted-foreground gap-1.5 text-[11px] font-medium py-0.5">
                                  <Mail className="h-3 w-3" />
                                  Email &amp; Password
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-3.5">
                              {u.isAdmin ? (
                                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/40 text-[11px] font-semibold gap-1">
                                  <ShieldCheck className="h-3 w-3" /> Admin {u.emailVerified ? "· Verified" : ""}
                                </Badge>
                              ) : u.emailVerified ? (
                                <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium gap-1">
                                  <Check className="h-3 w-3" /> Verified User
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="border-border text-muted-foreground text-[11px] font-medium">
                                  Unverified User
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-3.5">
                              {u.totalBatches > 0 ? (
                                <div>
                                  <p className="font-semibold text-foreground">
                                    {u.totalBatches} batch{u.totalBatches === 1 ? "" : "es"}
                                  </p>
                                  <p className="text-caption text-muted-foreground">
                                    {u.totalDocuments} document{u.totalDocuments === 1 ? "" : "s"}
                                  </p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground/60 text-caption italic">No batches yet</span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              <p className="font-medium text-foreground/80">{new Date(u.createdAt).toLocaleDateString()}</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(u.createdAt)}</p>
                            </td>
                            <td className="px-4 py-3.5 text-muted-foreground">
                              {u.lastLoginAt ? (
                                <>
                                  <p className="font-medium text-foreground/80">{new Date(u.lastLoginAt).toLocaleDateString()}</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo(u.lastLoginAt)}</p>
                                </>
                              ) : (
                                <span className="text-muted-foreground/50 italic">Never</span>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setInspectingUser(u)}
                                className="h-7 text-xs px-2.5 rounded-lg gap-1.5 border-border/70 hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-all font-medium"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                Details
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

          {/* TAB 3: AI MODELS & ENGINES */}
          {activeTab === "engines" && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Default Tier Card */}
                <div className="rounded-2xl border border-border/70 bg-card p-6 space-y-5 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-border/60 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-body font-bold text-foreground">Default Extraction Tier</h3>
                        <p className="text-caption text-muted-foreground">Executes on every standard page upload</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold">
                      Primary
                    </Badge>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-caption font-semibold text-foreground">Primary Extraction Provider</label>
                      <Select
                        value={defaultTierProvider}
                        onValueChange={(v: "hunyuan" | "bedrock" | "openai") => setDefaultTierProvider(v)}
                      >
                        <SelectTrigger className="w-full rounded-xl bg-background border-border/70">
                          <SelectValue placeholder="Select primary provider" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="bedrock">AWS Bedrock (Multimodal Vision - Fast &amp; Reliable)</SelectItem>
                          <SelectItem value="hunyuan">Tencent Hunyuan OCR (High-Speed Specialized OCR)</SelectItem>
                          <SelectItem value="openai">OpenAI Vision (Cloud Fallback)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {defaultTierProvider === "hunyuan" && (
                      <div className="space-y-2 animate-in fade-in duration-200">
                        <label className="text-caption font-semibold text-foreground">Hunyuan Model ID</label>
                        <Input
                          value={hunyuanModel}
                          onChange={(e) => setHunyuanModel(e.target.value)}
                          className="font-mono text-xs rounded-xl bg-background"
                          placeholder="hunyuan-ocr"
                        />
                      </div>
                    )}

                    {defaultTierProvider === "bedrock" && (
                      <div className="space-y-2 animate-in fade-in duration-200">
                        <label className="text-caption font-semibold text-foreground">Bedrock Vision Model</label>
                        <Select value={bedrockModel} onValueChange={setBedrockModel}>
                          <SelectTrigger className="w-full rounded-xl bg-background border-border/70 text-xs font-mono">
                            <SelectValue placeholder="Select Bedrock Model" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[300px] rounded-xl">
                            {settingsData?.availableModels?.bedrock?.length ? (
                              settingsData.availableModels.bedrock.map((m) => (
                                <SelectItem key={m} value={m} className="font-mono text-xs">
                                  {formatBedrockModelLabel(m)}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="amazon.nova-lite-v1:0" className="font-mono text-xs">
                                {formatBedrockModelLabel("amazon.nova-lite-v1:0")}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div className="pt-2 flex items-center justify-between border-t border-border/60">
                      <span className="text-caption text-muted-foreground">Test target: {defaultTierProvider}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickTest("default")}
                        className="gap-1.5 text-xs rounded-xl border-primary/30 text-primary hover:bg-primary/10"
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        Test Tier
                      </Button>
                    </div>
                  </div>
                </div>

                {/* High-Accuracy Escalation Tier Card */}
                <div className="rounded-2xl border border-border/70 bg-card p-6 space-y-5 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-border/60 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500 border border-blue-500/20">
                        <Cpu className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-body font-bold text-foreground">High-Accuracy Escalation Tier</h3>
                        <p className="text-caption text-muted-foreground">Re-reads pages when default confidence is low</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-semibold">
                      Escalation
                    </Badge>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-caption font-semibold text-foreground">Escalation Provider</label>
                      <Select
                        value={highAccuracyProvider}
                        onValueChange={(v: "bedrock" | "openai") => setHighAccuracyProvider(v)}
                      >
                        <SelectTrigger className="w-full rounded-xl bg-background border-border/70">
                          <SelectValue placeholder="Select escalation provider" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="bedrock">AWS Bedrock (Recommended for Vision &amp; Handwriting)</SelectItem>
                          <SelectItem value="openai">OpenAI (Direct Vision API)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-caption font-semibold text-foreground">Escalation Vision Model</label>
                      <Select value={bedrockModel} onValueChange={setBedrockModel}>
                        <SelectTrigger className="w-full rounded-xl bg-background border-border/70 text-xs font-mono">
                          <SelectValue placeholder="Select Model" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px] rounded-xl">
                          {settingsData?.availableModels?.bedrock?.length ? (
                            settingsData.availableModels.bedrock.map((m) => (
                              <SelectItem key={m} value={m} className="font-mono text-xs">
                                {formatBedrockModelLabel(m)}
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="anthropic.claude-3-5-sonnet-20241022-v2:0" className="font-mono text-xs">
                              Claude 3.5 Sonnet v2 (🎯 Highest Accuracy OCR)
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="pt-2 flex items-center justify-between border-t border-border/60">
                      <span className="text-caption text-muted-foreground">Target model: {bedrockModel.split(".")[1] || bedrockModel}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickTest("escalation")}
                        className="gap-1.5 text-xs rounded-xl border-primary/30 text-primary hover:bg-primary/10"
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        Test Escalation
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* OpenAI Integration Card */}
              <div className="rounded-2xl border border-border/70 bg-card p-6 space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      <Key className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-body-sm font-bold text-foreground">OpenAI Integration &amp; Fallback Credentials</h4>
                      <p className="text-caption text-muted-foreground">Optional external API credentials for direct model queries</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {settingsData?.settings?.openaiApiKeyMasked ? "Configured" : "Optional"}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-caption font-semibold text-foreground">OpenAI Model</label>
                    <Select value={openaiModel} onValueChange={setOpenAIModel}>
                      <SelectTrigger className="w-full rounded-xl bg-background text-xs font-mono">
                        <SelectValue placeholder="Select OpenAI Model" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {settingsData?.availableModels?.openai?.map((m) => (
                          <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
                        )) || (
                          <SelectItem value="gpt-4o-mini" className="font-mono text-xs">gpt-4o-mini</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-caption font-semibold text-foreground">
                      OpenAI API Key {settingsData?.settings?.openaiApiKeyMasked ? "(Leave blank to keep current)" : ""}
                    </label>
                    <Input
                      type="password"
                      placeholder={settingsData?.settings?.openaiApiKeyMasked || "sk-proj-..."}
                      value={openaiApiKey}
                      onChange={(e) => setOpenAIApiKey(e.target.value)}
                      className="font-mono text-xs rounded-xl bg-background"
                    />
                  </div>
                </div>
              </div>

              {/* Sticky Action Footer */}
              <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl border border-primary/20 bg-primary/5">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <p className="text-xs font-medium text-foreground">
                    Configuration overrides take effect immediately across all Cloudflare worker nodes and edge functions.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveSettings}
                  disabled={updateSettingsMutation.isPending || isSettingsLoading}
                  className="gap-2 text-xs font-semibold bg-primary text-primary-foreground shadow-xs px-6"
                >
                  <Save className={`h-4 w-4 ${updateSettingsMutation.isPending ? "animate-spin" : ""}`} />
                  {updateSettingsMutation.isPending ? "Saving configuration…" : "Save Configuration"}
                </Button>
              </div>
            </div>
          )}

          {/* TAB 4: LIVE OCR TEST & BENCHMARK LAB (SPLIT WORKBENCH) */}
          {activeTab === "testlab" && (
            <div ref={testLabRef} className="space-y-6 animate-in fade-in duration-300">
              {/* Quick Benchmark Preset Buttons */}
              <div className="space-y-2">
                <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                  Quick Benchmark Targets
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "default", label: `Default Tier (${defaultTierProvider})`, icon: Sparkles },
                    { id: "escalation", label: `High-Accuracy (${highAccuracyProvider})`, icon: Cpu },
                    { id: "bedrock", label: `Nova Lite (⚡ Fast)`, icon: Zap },
                    { id: "handwriting", label: `Claude 3.7 (✍️ Handwriting)`, icon: PenLine },
                    { id: "multilingual", label: `Nova Pro (🌐 200+ Langs)`, icon: Languages },
                    { id: "hunyuan", label: `Tencent Hunyuan OCR`, icon: FileText },
                    { id: "textract", label: `AWS Textract`, icon: Globe },
                  ].map((preset) => {
                    const Icon = preset.icon;
                    const active = testTarget === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setTestTarget(preset.id);
                          executeTest(preset.id, testDocSource === "custom" ? customFile : null);
                        }}
                        disabled={testModelMutation.isPending}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 border",
                          active
                            ? "bg-primary text-primary-foreground border-primary shadow-xs ring-2 ring-primary/20"
                            : "border-border/70 bg-card text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Split Workbench Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Left Column: Test Configuration & Source Document (5 Cols) */}
                <div className="lg:col-span-5 rounded-2xl border border-border/70 bg-card p-5 space-y-5 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-border/60 pb-3.5">
                    <h3 className="text-body-sm font-bold text-foreground flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-primary" />
                      Workbench Controls
                    </h3>
                    <Badge variant="outline" className="text-[10px] border-primary/30 bg-primary/10 text-primary font-mono">
                      Target: {testTarget}
                    </Badge>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-caption font-semibold text-foreground">Target Engine / Tier</label>
                      <Select value={testTarget} onValueChange={setTestTarget}>
                        <SelectTrigger className="w-full rounded-xl bg-background border-border/70 text-xs">
                          <SelectValue placeholder="Select target" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          <SelectItem value="default">Default Tier ({defaultTierProvider})</SelectItem>
                          <SelectItem value="escalation">High-Accuracy Tier ({highAccuracyProvider})</SelectItem>
                          <SelectItem value="bedrock">AWS Bedrock ({bedrockModel})</SelectItem>
                          <SelectItem value="handwriting">AWS Bedrock (Handwriting Mode)</SelectItem>
                          <SelectItem value="multilingual">AWS Bedrock (Multilingual Mode)</SelectItem>
                          <SelectItem value="hunyuan">Tencent Hunyuan ({hunyuanModel})</SelectItem>
                          <SelectItem value="textract">AWS Textract (Tables &amp; Forms)</SelectItem>
                          <SelectItem value="openai">OpenAI ({openaiModel})</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Source Document Picker */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-caption font-semibold text-foreground">Source Document</label>
                        <div className="flex rounded-lg border border-border/60 p-0.5 bg-muted/40 text-[11px] font-semibold">
                          <button
                            type="button"
                            onClick={() => setTestDocSource("sample")}
                            className={cn(
                              "px-2 py-0.5 rounded-md transition-all",
                              testDocSource === "sample" ? "bg-background text-foreground shadow-2xs" : "text-muted-foreground"
                            )}
                          >
                            Sample Scan
                          </button>
                          <button
                            type="button"
                            onClick={() => setTestDocSource("custom")}
                            className={cn(
                              "px-2 py-0.5 rounded-md transition-all",
                              testDocSource === "custom" ? "bg-background text-foreground shadow-2xs" : "text-muted-foreground"
                            )}
                          >
                            Upload Custom
                          </button>
                        </div>
                      </div>

                      {testDocSource === "sample" ? (
                        <div className="flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-muted/20">
                          <div className="h-12 w-12 rounded-lg bg-background border border-border/80 flex items-center justify-center text-muted-foreground font-mono text-[10px] shrink-0">
                            DOC
                          </div>
                          <div className="min-w-0">
                            <p className="text-body-sm font-semibold text-foreground truncate">Built-in Synthetic Invoice</p>
                            <p className="text-caption text-muted-foreground">Standard 320×120 commercial receipt scan</p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="image/png,image/jpeg,image/webp,application/pdf"
                            className="hidden"
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed border-border/80 hover:border-primary/50 bg-background/50 text-center transition-all"
                          >
                            <FileUp className="h-5 w-5 text-primary mb-1" />
                            <p className="text-xs font-semibold text-foreground">
                              {customFile ? customFile.filename : "Click to select scan / PDF"}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">PNG, JPG, WEBP, or PDF up to 25MB</p>
                          </button>
                          {customFile && (
                            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-xs">
                              <span className="font-mono text-[11px] truncate text-primary">{customFile.filename}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setCustomFile(null);
                                  setTestDocSource("sample");
                                }}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={() => executeTest(testTarget, testDocSource === "custom" ? customFile : null)}
                      disabled={testModelMutation.isPending}
                      className="w-full gap-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground shadow-xs h-10 mt-2"
                    >
                      <PlayCircle className={cn("h-4 w-4", testModelMutation.isPending && "animate-spin")} />
                      {testModelMutation.isPending ? "Executing live extraction…" : "Execute Benchmark Test"}
                    </Button>
                  </div>
                </div>

                {/* Right Column: Live Telemetry & Output Workbench (7 Cols) */}
                <div className="lg:col-span-7 rounded-2xl border border-border/70 bg-card p-5 space-y-4 shadow-2xs min-h-[420px] flex flex-col">
                  <div className="flex items-center justify-between border-b border-border/60 pb-3">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-primary" />
                      <h3 className="text-body-sm font-bold text-foreground">Extraction Telemetry &amp; Payload</h3>
                    </div>

                    {testModelMutation.data && (
                      <div className="flex rounded-lg border border-border/60 p-0.5 bg-muted/40 text-[11px] font-semibold">
                        <button
                          type="button"
                          onClick={() => setTestResultTab("parsed")}
                          className={cn(
                            "px-2.5 py-0.5 rounded-md transition-all",
                            testResultTab === "parsed" ? "bg-background text-foreground shadow-2xs" : "text-muted-foreground"
                          )}
                        >
                          Structured Data
                        </button>
                        <button
                          type="button"
                          onClick={() => setTestResultTab("raw")}
                          className={cn(
                            "px-2.5 py-0.5 rounded-md transition-all",
                            testResultTab === "raw" ? "bg-background text-foreground shadow-2xs" : "text-muted-foreground"
                          )}
                        >
                          Raw Response
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Benchmark Status Output */}
                  {testModelMutation.isPending ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-3">
                      <RefreshCw className="h-8 w-8 animate-spin text-primary opacity-80" />
                      <p className="text-body-sm font-semibold text-foreground">Executing Upstream Extraction Request</p>
                      <p className="text-caption text-muted-foreground max-w-sm">
                        Calling {testTarget} model via edge worker. Measuring network latency, token consumption, and response schema...
                      </p>
                    </div>
                  ) : testModelMutation.data ? (
                    <div className="space-y-4 flex-1 flex flex-col">
                      {/* Telemetry Metric Pills */}
                      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-border/60 bg-muted/20">
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-mono text-xs font-bold px-2.5 py-1",
                            testModelMutation.data.success
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-destructive/40 bg-destructive/10 text-destructive"
                          )}
                        >
                          {testModelMutation.data.success ? "HTTP 200 OK" : "FAILED"}
                        </Badge>
                        <Badge variant="outline" className="font-mono text-xs border-primary/30 bg-primary/10 text-primary px-2.5 py-1">
                          ⚡ {testModelMutation.data.latencyMs} ms
                        </Badge>
                        <Badge variant="outline" className="font-mono text-xs border-border/60 text-muted-foreground px-2.5 py-1">
                          Engine: {testModelMutation.data.provider} ({testModelMutation.data.model})
                        </Badge>
                        {testModelMutation.data.tokensUsed !== undefined && (
                          <Badge variant="outline" className="font-mono text-xs border-border/60 text-muted-foreground px-2.5 py-1">
                            Tokens: {testModelMutation.data.tokensUsed}
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            handleCopyRaw(
                              testModelMutation.data?.preview ||
                                JSON.stringify(testModelMutation.data, null, 2)
                            )
                          }
                          className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                        >
                          <Copy className="h-3 w-3" />
                          {copiedRaw ? "Copied" : "Copy Output"}
                        </Button>
                      </div>

                      {testModelMutation.data.error && (
                        <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs font-mono">
                          Error: {testModelMutation.data.error}
                        </div>
                      )}

                      {testResultTab === "parsed" ? (
                        <div className="flex-1 rounded-xl border border-border/60 bg-background/60 p-4 font-mono text-xs overflow-auto max-h-[360px] space-y-3">
                          {testModelMutation.data.fields && testModelMutation.data.fields.length > 0 ? (
                            <div className="space-y-2">
                              {testModelMutation.data.fields.map((field, idx) => (
                                <div key={idx} className="flex items-start justify-between gap-4 border-b border-border/40 pb-1.5 last:border-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground font-semibold">{field.label}:</span>
                                    <span className="text-[10px] text-primary/80 font-sans px-1.5 py-0.5 bg-primary/10 rounded">
                                      {Math.round(field.confidence * 100)}%
                                    </span>
                                  </div>
                                  <span className="text-foreground text-right break-all">
                                    {field.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <pre className="whitespace-pre-wrap text-foreground/90 leading-relaxed font-mono text-xs">
                              {testModelMutation.data.preview || "No parsed fields returned."}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <div className="flex-1 rounded-xl border border-border/60 bg-background/60 p-3.5 font-mono text-[11px] overflow-auto max-h-[360px]">
                          <pre className="whitespace-pre-wrap text-foreground/80 leading-relaxed">
                            {testModelMutation.data.preview || JSON.stringify(testModelMutation.data, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground space-y-2.5">
                      <Terminal className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-body-sm font-medium text-foreground">Interactive Benchmark Idle</p>
                      <p className="text-caption text-muted-foreground max-w-sm">
                        Select an engine target on the left and click &quot;Execute Benchmark Test&quot; to see real-time latency, token usage, and extracted fields.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Inspect User Modal Dialog */}
      <Dialog open={Boolean(inspectingUser)} onOpenChange={(open) => !open && setInspectingUser(null)}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-body-lg font-bold">
              <Users className="h-5 w-5 text-primary" />
              User Account Inspector
            </DialogTitle>
            <DialogDescription>
              Detailed account credentials, activity counts, and authentication profile.
            </DialogDescription>
          </DialogHeader>

          {inspectingUser && (
            <div className="space-y-4 pt-2 text-xs">
              <div className="flex items-center gap-3.5 p-3.5 rounded-xl border border-border/60 bg-muted/20">
                <div className="h-11 w-11 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm border border-border/60 shrink-0">
                  {inspectingUser.pictureUrl ? (
                    <img src={inspectingUser.pictureUrl} alt="" className="h-full w-full object-cover rounded-full" />
                  ) : (
                    (inspectingUser.firstName?.[0] || inspectingUser.email[0] || "U").toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-body font-bold text-foreground truncate">{inspectingUser.fullName || "Anonymous"}</p>
                  <p className="text-caption text-muted-foreground font-mono truncate">{inspectingUser.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary uppercase">
                      ID #{inspectingUser.id}
                    </span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-[11px] text-muted-foreground capitalize">
                      {inspectingUser.authProvider} Provider
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl border border-border/60 bg-card">
                  <span className="text-caption font-semibold text-muted-foreground">Total Batches Run</span>
                  <p className="text-xl font-bold text-foreground mt-1">{inspectingUser.totalBatches}</p>
                </div>
                <div className="p-3 rounded-xl border border-border/60 bg-card">
                  <span className="text-caption font-semibold text-muted-foreground">Total Documents Parsed</span>
                  <p className="text-xl font-bold text-foreground mt-1">{inspectingUser.totalDocuments}</p>
                </div>
              </div>

              <dl className="divide-y divide-border/40 rounded-xl border border-border/60 bg-card px-3.5">
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-muted-foreground font-medium">Email Verification</dt>
                  <dd>
                    {inspectingUser.emailVerified ? (
                      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground text-[10px]">
                        Unverified
                      </Badge>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-muted-foreground font-medium">Role Access</dt>
                  <dd>
                    <Badge variant={inspectingUser.isAdmin ? "default" : "outline"} className="text-[10px]">
                      {inspectingUser.isAdmin ? "Platform Admin" : "Standard User"}
                    </Badge>
                  </dd>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-muted-foreground font-medium">Member Since</dt>
                  <dd className="font-mono text-foreground/80">{new Date(inspectingUser.createdAt).toLocaleString()}</dd>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-muted-foreground font-medium">Last Login</dt>
                  <dd className="font-mono text-foreground/80">
                    {inspectingUser.lastLoginAt ? new Date(inspectingUser.lastLoginAt).toLocaleString() : "Never"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
