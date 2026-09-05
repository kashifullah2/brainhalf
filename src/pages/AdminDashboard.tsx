// ---------------------------------------------------------------------------
// Admin console.
//
// Every number on this page used to be a literal written into the component: a
// hardcoded 1,428 documents processed, "99.2%" accuracy, "1.1s" average latency,
// 12 active batches, and a four-row "Recent Platform Activity Stream" listing
// document ids that had never existed. It reported a healthy platform whatever
// the platform was doing, and an "Export Audit Report" button that only raised a
// toast saying a report had been saved.
//
// It also printed a "Credentials & Secrets" panel with the first characters of
// the AWS access key and secret — a real disclosure to anyone who could reach the
// page, which before server/admin.ts was anyone who signed up with the right
// first name.
//
// Everything here now comes from GET /api/admin/metrics, counted in the database
// at request time. Provider configuration is shown as configured / not
// configured: no values, no fragments, no lengths.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileText,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState, ListSkeleton, PageHeader, StatCard } from "@/components/app";
import { usePageTitle } from "@/lib/use-page-title";
import { useAdminMetrics, type AdminMetrics } from "@/lib/api-client";
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
        ? "Used for both tiers in preference to Textract."
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
      <Badge variant="outline" className="max-w-[16rem] truncate font-mono text-xs">
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

  // 30s: these are aggregate counts, not a live feed, and every refresh is a
  // handful of COUNT(*) queries against the whole documents table.
  const { data, isLoading, isError, error, refetch, isFetching } = useAdminMetrics({
    query: { refetchInterval: 30_000 },
  });

  const rows = useMemo(() => (data ? configRows(data) : []), [data]);

  const handleExport = () => {
    if (!data) return;
    // Exports what the page is showing, which is what "export" should mean. The
    // button this replaces only raised a toast claiming a report had been saved.
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `brainhalf-metrics-${data.generatedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`,
    );
    toast({
      title: "Metrics exported",
      description: "The figures shown on this page were saved as JSON.",
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
              onClick={() => void refetch()}
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
          onRetry={() => void refetch()}
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
