import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  Plus,
  Loader2,
  Trash2,
  Download,
  CheckSquare,
  Square,
  X,
  ArrowRight,
  FileText,
  BarChart3,
  CheckCircle2,
  Search,
  MoreHorizontal,
  LayoutGrid,
  List,
  PenLine,
  Table2,
  ShoppingBag,
  Clock,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PRESETS } from "@/components/UploadModal";
import { useAuth } from "@/context/AuthContext";
import {
  useListBatches,
  getBatch,
  deleteBatch,
  getListBatchesQueryKey,
  isBatchStalled,
  storageUrl,
  type BatchSummary,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/lib/use-page-title";
import { humanizeFieldLabel } from "@/lib/humanize-field";
import { sanitizeForExport, cn } from "@/lib/utils";
import { recordsToCsv, recordsToXlsx, downloadBlob } from "@/lib/xlsx-writer";
import { EmptyState, ErrorState, ListSkeleton, greeting } from "@/components/app";
import { StatusBadge } from "@/components/StatusBadge";
import { errorMessage } from "@/lib/humanize-error";

/* ── Helpers ─────────────────────────────────────────────── */

const tOf = (v?: string) => (v ? new Date(v).getTime() || 0 : 0);

function timeAgo(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceToNow(d, { addSuffix: true });
}

type BusyAction = "csv" | "excel" | "delete" | null;

/* ── Page ────────────────────────────────────────────────── */
export default function AppHome() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  usePageTitle("Dashboard · BrainHalf", { noindex: true });
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Poll while anything is queued or processing
  const { data: batches, isLoading, error } = useListBatches({
    query: {
      refetchInterval: (query) =>
        query.state.data?.some(
          (b) =>
            (b.status === "processing" || b.status === "queued") && !isBatchStalled(b),
        )
          ? 4000
          : false,
    },
  });

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterEngine, setFilterEngine] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [pendingDelete, setPendingDelete] = useState<{ ids: number[]; label: string } | null>(null);

  // Keyboard shortcut: pressing '/' focuses the search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Prune dead ids
  useEffect(() => {
    if (!batches) return;
    const alive = new Set(batches.map((b: BatchSummary) => b.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [batches]);

  const filteredBatches = useMemo(() => {
    if (!batches) return [];
    let r = [...batches];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      r = r.filter(
        (b: BatchSummary) =>
          b.id.toString().includes(q) ||
          (b.firstDocumentContentType && b.firstDocumentContentType.toLowerCase().includes(q)) ||
          (b.engineType && b.engineType.toLowerCase().includes(q)),
      );
    }
    if (filterStatus !== "all") {
      if (filterStatus === "in_flight") {
        r = r.filter((b: BatchSummary) => ["processing", "queued"].includes(b.status));
      } else {
        r = r.filter((b: BatchSummary) => b.status === filterStatus);
      }
    }
    if (filterEngine !== "all") {
      r = r.filter((b: BatchSummary) => b.engineType === filterEngine);
    }
    r.sort((a: BatchSummary, b: BatchSummary) =>
      sortOrder === "newest" ? tOf(b.createdAt) - tOf(a.createdAt) : tOf(a.createdAt) - tOf(b.createdAt),
    );
    return r;
  }, [batches, searchQuery, filterStatus, filterEngine, sortOrder]);

  const allSelected =
    filteredBatches.length > 0 && filteredBatches.every((b: BatchSummary) => selectedIds.has(b.id));
  const isSelecting = selectedIds.size > 0;
  const engineLabels = useMemo(() => new Map(PRESETS.map((p) => [p.id, p.label])), []);

  const stats = useMemo(() => {
    if (!batches?.length) return null;
    const docs = batches.reduce((n: number, b: BatchSummary) => n + (b.totalDocuments ?? 0), 0);
    const done = batches.filter((b: BatchSummary) => b.status === "completed").length;
    const running = batches.filter((b: BatchSummary) => ["processing", "queued"].includes(b.status)).length;
    const failed = batches.filter((b: BatchSummary) => b.status === "failed").length;
    return { total: batches.length, docs, done, running, failed };
  }, [batches]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const handleSelectAll = () => {
    if (!filteredBatches.length) return;
    setSelectedIds(allSelected ? new Set() : new Set(filteredBatches.map((b: BatchSummary) => b.id)));
  };

  const clearFilters = () => {
    setFilterStatus("all");
    setFilterEngine("all");
    setSearchQuery("");
  };

  const performDelete = async () => {
    const ids = pendingDelete?.ids ?? [];
    if (!ids.length) return;
    setBusyAction("delete");
    try {
      for (let i = 0; i < ids.length; i += 3) {
        await Promise.all(ids.slice(i, i + 3).map((id) => deleteBatch(id)));
      }
      await queryClient.invalidateQueries({ queryKey: getListBatchesQueryKey() });
      setSelectedIds((prev) => {
        const n = new Set(prev);
        ids.forEach((id) => n.delete(id));
        return n;
      });
      toast({
        title: `${ids.length} batch${ids.length > 1 ? "es" : ""} deleted`,
        description: "Extraction results and documents were safely removed.",
      });
    } catch (e) {
      toast({ title: "Delete failed", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusyAction(null);
      setPendingDelete(null);
    }
  };

  const fetchSelected = async (ids: number[]) => {
    const byId = new Map<number, { columns: string[]; rows: Record<string, unknown>[] }>();
    for (let i = 0; i < ids.length; i += 3) {
      const chunk = ids.slice(i, i + 3);
      const res = await Promise.all(chunk.map((id) => getBatch(id)));
      chunk.forEach((id, j) => byId.set(id, res[j]));
    }
    return ids.map((id) => ({
      id,
      columns: byId.get(id)?.columns ?? [],
      rows: byId.get(id)?.rows ?? [],
    }));
  };

  const buildExport = (list: Array<{ id: number; columns: string[]; rows: Record<string, unknown>[] }>) => {
    const rawCols = new Set<string>();
    list.forEach(({ columns }) => columns.forEach((c) => rawCols.add(c)));
    const allCols = [...rawCols];

    const humanizedMap = new Map<string, string>();
    const seenLabels = new Set<string>();

    allCols.forEach((c) => {
      let label = humanizeFieldLabel(c);
      let suffix = 1;
      while (seenLabels.has(label)) {
        label = `${humanizeFieldLabel(c)} ${++suffix}`;
      }
      seenLabels.add(label);
      humanizedMap.set(c, label);
    });

    return list.flatMap(({ id, rows }) =>
      rows.map((row) => {
        const rowRecord = row as Record<string, unknown>;
        const r: Record<string, string> = {
          Batch: String(id),
          Filename: sanitizeForExport(String(rowRecord.filename ?? "")),
          Status: sanitizeForExport(String(rowRecord.status ?? "")),
        };
        allCols.forEach((c) => {
          r[humanizedMap.get(c)!] = sanitizeForExport(String(rowRecord[c] ?? ""));
        });
        return r;
      }),
    );
  };

  const doExport = async (kind: "csv" | "excel", overrideIds?: Set<number>) => {
    const targetIds = overrideIds || selectedIds;
    const ids = [...targetIds];
    if (!ids.length || busyAction) return;
    setBusyAction(kind);
    try {
      const list = await fetchSelected(ids);
      const data = buildExport(list);
      const label = ids.length === 1 ? `batch_${ids[0]}` : `batches_export`;
      if (kind === "csv") {
        downloadBlob(new Blob([recordsToCsv(data)], { type: "text/csv;charset=utf-8;" }), `${label}.csv`);
        toast({ title: "CSV exported successfully" });
      } else {
        downloadBlob(recordsToXlsx(data, "Extracted Data"), `${label}.xlsx`);
        toast({ title: "Excel spreadsheet exported successfully" });
      }
    } catch (e) {
      toast({ title: "Export failed", description: errorMessage(e), variant: "destructive" });
    } finally {
      setBusyAction(null);
    }
  };

  const exportCSV = (overrideIds?: Set<number>) => doExport("csv", overrideIds);
  const exportExcel = (overrideIds?: Set<number>) => doExport("excel", overrideIds);

  const handleBulkDelete = () => {
    if (!selectedIds.size || busyAction) return;
    const n = selectedIds.size;
    setPendingDelete({ ids: [...selectedIds], label: `${n} batch${n > 1 ? "es" : ""}` });
  };

  const firstName = user?.name?.split(" ")[0] ?? "";

  return (
    <div className={`flex flex-col gap-6 ${isSelecting ? "pb-28" : ""}`}>
      {/* ── MINIMALIST COMMAND HEADER ─────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-border/50">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 animate-pulse" />
            <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
              Executive Processing Hub
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            {greeting()}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="text-body-sm text-muted-foreground">
            AI document extraction engine &amp; schema pipeline station.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-border/60 bg-muted/20 text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-semibold text-foreground">9 AI Engines Ready</span>
            <span className="text-muted-foreground/60">•</span>
            <span className="font-mono text-muted-foreground">{stats?.docs || 0} docs</span>
          </div>

          <Button
            onClick={() => setLocation("/app/upload")}
            size="lg"
            className="gap-2 rounded-xl bg-primary text-primary-foreground font-bold shadow-md hover:bg-primary/90 px-6 h-11 border-none cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            New Extraction
          </Button>
        </div>
      </div>

      {/* ── CONNECTED EXECUTIVE TELEMETRY STRIP ──────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Tile 1: Total Docs */}
          <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-2xs flex flex-col justify-between space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                Total Documents
              </span>
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <FileText className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-mono font-bold tracking-tight text-foreground tabular-nums">
                {stats.docs}
              </p>
              <p className="text-micro text-muted-foreground mt-1 font-mono">
                Across {stats.total} batch runs
              </p>
            </div>
          </div>

          {/* Tile 2: Extraction Rate */}
          <button
            type="button"
            onClick={() => setFilterStatus(filterStatus === "completed" ? "all" : "completed")}
            className={cn(
              "rounded-2xl border p-4 text-left transition-all shadow-2xs flex flex-col justify-between space-y-3 cursor-pointer",
              filterStatus === "completed"
                ? "border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/30"
                : "border-border/70 bg-card hover:border-border"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                Success Rate
              </span>
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-mono font-bold tracking-tight text-emerald-600 dark:text-emerald-400 tabular-nums">
                {stats.total > 0 ? `${Math.round((stats.done / stats.total) * 100)}%` : "100%"}
              </p>
              <p className="text-micro text-muted-foreground mt-1 font-mono">
                {stats.done} completed runs
              </p>
            </div>
          </button>

          {/* Tile 3: In-Flight */}
          <button
            type="button"
            onClick={() => setFilterStatus(filterStatus === "in_flight" ? "all" : "in_flight")}
            className={cn(
              "rounded-2xl border p-4 text-left transition-all shadow-2xs flex flex-col justify-between space-y-3 cursor-pointer",
              filterStatus === "in_flight"
                ? "border-blue-500 bg-blue-500/5 ring-1 ring-blue-500/30"
                : "border-border/70 bg-card hover:border-border"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                Worker Queue
              </span>
              <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500">
                <BarChart3 className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-mono font-bold tracking-tight text-blue-600 dark:text-blue-400 tabular-nums">
                {stats.running}
              </p>
              <p className="text-micro text-muted-foreground mt-1 font-mono">
                Active in-flight runs
              </p>
            </div>
          </button>

          {/* Tile 4: Attention */}
          <button
            type="button"
            onClick={() => setFilterStatus(filterStatus === "failed" ? "all" : "failed")}
            className={cn(
              "rounded-2xl border p-4 text-left transition-all shadow-2xs flex flex-col justify-between space-y-3 cursor-pointer",
              filterStatus === "failed"
                ? "border-destructive bg-destructive/5 ring-1 ring-destructive/30"
                : "border-border/70 bg-card hover:border-border"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground">
                Attention Required
              </span>
              <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-mono font-bold tracking-tight text-rose-600 dark:text-rose-400 tabular-nums">
                {stats.failed}
              </p>
              <p className="text-micro text-muted-foreground mt-1 font-mono">
                {stats.failed > 0 ? "Requires re-run" : "0 pipeline errors"}
              </p>
            </div>
          </button>
        </div>
      )}

      {/* ── QUICK LAUNCH PRESETS ─────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-0.5">
          <span className="text-caption font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5 text-primary" />
            Quick Launch Presets
          </span>
          <span className="text-micro text-muted-foreground font-mono">Instant schema routing</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {[
            { id: "invoice", label: "Invoices & Billing", desc: "Vendor, totals, tax, line items", icon: FileText, color: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
            { id: "receipt", label: "Receipts & Slips", desc: "Merchant, tip, payment method", icon: ShoppingBag, color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
            { id: "keyvalue", label: "Forms & Tables", desc: "Field pairs, scan marks, grids", icon: Table2, color: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
            { id: "handwriting", label: "Handwriting & AI", desc: "Cursive script & custom VQA", icon: PenLine, color: "text-teal-500 bg-teal-500/10 border-teal-500/20" },
          ].map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setLocation(`/app/upload?mode=${p.id}`)}
                className="group relative flex items-center gap-3.5 p-3.5 rounded-2xl border border-border/70 bg-card hover:border-primary/50 hover:bg-muted/20 transition-all text-left shadow-2xs cursor-pointer overflow-hidden border-l-2 border-l-transparent hover:border-l-primary"
              >
                <div className={cn("p-2.5 rounded-xl border shrink-0 group-hover:scale-105 transition-transform", p.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
                    {p.label}
                  </p>
                  <p className="text-caption text-muted-foreground truncate mt-0.5">{p.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── TOOLBAR & FILTER CONTROLS ───────────────────────────────────── */}
      {batches && batches.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-muted/20 p-3 rounded-2xl border border-border/60">
            {/* Left: Search & Select */}
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search batches… (Press /)"
                  aria-label="Search batches by ID, engine, or filetype"
                  className="h-9 pl-9 pr-8 text-xs rounded-xl bg-background border-border/70 focus-visible:ring-1"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <button
                onClick={handleSelectAll}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-background px-3 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
              >
                {allSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
                {allSelected ? "Deselect all" : "Select all"}
              </button>

              <Select value={filterEngine} onValueChange={setFilterEngine}>
                <SelectTrigger className="h-9 w-[140px] border-border/70 text-xs rounded-xl bg-background font-semibold">
                  <SelectValue placeholder="All Engines" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all">All engines</SelectItem>
                  {PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(filterStatus !== "all" || filterEngine !== "all" || searchQuery !== "") && (
                <button
                  onClick={clearFilters}
                  className="flex h-9 items-center gap-1 rounded-xl border border-border/70 px-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors bg-background shrink-0 cursor-pointer"
                >
                  <X className="h-3 w-3" /> Clear
                </button>
              )}
            </div>

            {/* Right: Sort & View Switcher */}
            <div className="flex items-center gap-2 self-end lg:self-auto">
              <Select value={sortOrder} onValueChange={(v: "newest" | "oldest") => setSortOrder(v)}>
                <SelectTrigger className="h-9 w-[130px] border-border/70 bg-background text-xs rounded-xl font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex items-center rounded-xl border border-border/70 bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  aria-label="Table View"
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-colors cursor-pointer",
                    viewMode === "table"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  aria-label="Cards Grid View"
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg text-xs transition-colors cursor-pointer",
                    viewMode === "grid"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Underline Tab Filter Bar */}
          <div className="flex items-center gap-6 border-b border-border/60 px-1 overflow-x-auto scrollbar-none">
            {[
              { id: "all", label: "All Runs", count: batches.length },
              {
                id: "in_flight",
                label: "In Progress",
                count: batches.filter((b) => ["processing", "queued"].includes(b.status)).length,
              },
              {
                id: "completed",
                label: "Completed",
                count: batches.filter((b) => b.status === "completed").length,
              },
              {
                id: "failed",
                label: "Failed",
                count: batches.filter((b) => b.status === "failed").length,
              },
            ].map((tab) => {
              const active = filterStatus === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilterStatus(tab.id)}
                  className={cn(
                    "flex items-center gap-2 pb-2.5 text-xs font-semibold transition-all border-b-2 -mb-px shrink-0 cursor-pointer",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border/60"
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-mono",
                      active
                        ? "bg-primary/15 text-primary font-bold"
                        : "bg-muted text-muted-foreground font-medium"
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT DATA VIEWS ──────────────────────────────────────── */}
      {isLoading ? (
        <ListSkeleton />
      ) : error ? (
        <ErrorState
          title="Could not load your batches"
          body="Nothing was lost — please try again in a moment."
          onRetry={() => queryClient.refetchQueries({ queryKey: getListBatchesQueryKey() })}
        />
      ) : !batches?.length ? (
        <div className="rounded-2xl border border-dashed border-border/80 bg-card p-10 text-center shadow-2xs">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4 border border-primary/20">
            <FileText className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-bold text-foreground">No extractions yet</h3>
          <p className="mt-1.5 text-body-sm text-muted-foreground max-w-md mx-auto">
            Drop in PDF files, invoices, receipts, or photos of handwriting to automatically extract clean, structured data.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl mx-auto my-8 text-left">
            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 flex flex-col gap-1">
              <span className="text-xs font-bold text-primary">Step 1</span>
              <span className="text-body-sm font-semibold text-foreground">Upload Files</span>
              <span className="text-[11px] text-muted-foreground">PDF, PNG, JPG, or WebP up to 25MB</span>
            </div>
            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 flex flex-col gap-1">
              <span className="text-xs font-bold text-primary">Step 2</span>
              <span className="text-body-sm font-semibold text-foreground">AI Extracts</span>
              <span className="text-[11px] text-muted-foreground">Invoices, handwriting, tables, 200+ languages</span>
            </div>
            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 flex flex-col gap-1">
              <span className="text-xs font-bold text-primary">Step 3</span>
              <span className="text-body-sm font-semibold text-foreground">1-Click Export</span>
              <span className="text-[11px] text-muted-foreground">Directly to Excel (.xlsx), CSV, or JSON</span>
            </div>
          </div>

          <Button
            size="lg"
            onClick={() => setLocation("/app/upload")}
            className="rounded-xl px-6 font-bold shadow-md bg-primary text-primary-foreground hover:bg-primary/90 border-none cursor-pointer"
          >
            <Plus className="mr-2 h-4 w-4" />
            Start Your First Extraction
          </Button>
        </div>
      ) : filteredBatches.length === 0 ? (
        <EmptyState
          inset
          icon={Search}
          title="No batches match your search"
          body="Widen your search term, or clear the filters to see all runs."
          action={
            <Button variant="outline" onClick={clearFilters} className="rounded-xl">
              Clear filters
            </Button>
          }
        />
      ) : viewMode === "table" ? (
        /* ── TABLE VIEW ─────────────────────────────────────────────────── */
        <div className="rounded-2xl border border-border/70 bg-card overflow-hidden shadow-2xs">
          <div className="divide-y divide-border/50">
            {filteredBatches.map((batch: BatchSummary) => {
              const isSelected = selectedIds.has(batch.id);
              const progress =
                batch.totalDocuments > 0 ? (batch.completedDocuments / batch.totalDocuments) * 100 : 0;
              const isImage = batch.firstDocumentContentType?.startsWith("image/");
              const engineLabel = engineLabels.get(batch.engineType ?? "") ?? batch.engineType ?? "Standard";

              return (
                <div
                  key={batch.id}
                  className={cn(
                    "group relative flex flex-col cursor-pointer transition-all duration-150 border-l-2",
                    isSelected
                      ? "border-l-primary bg-primary/5 dark:bg-primary/10"
                      : "border-l-transparent hover:border-l-primary/80 hover:bg-muted/30"
                  )}
                  onClick={(e) => {
                    const t = e.target as HTMLElement;
                    if (t.tagName === "INPUT" || t.closest("button")) return;
                    if (isSelecting) {
                      toggleSelect(batch.id);
                      return;
                    }
                    setLocation(`/app/batches/${batch.id}`);
                  }}
                >
                  <div className="flex items-center gap-3.5 px-4 py-3.5">
                    {/* Row Checkbox */}
                    <input
                      type="checkbox"
                      aria-label={`Select batch #${batch.id}`}
                      className="h-4 w-4 rounded border-border/70 shrink-0 cursor-pointer accent-primary"
                      checked={isSelected}
                      onChange={() => toggleSelect(batch.id)}
                      onClick={(e) => e.stopPropagation()}
                    />

                    {/* Document Thumbnail Preview */}
                    <div className="relative h-11 w-11 shrink-0 rounded-xl bg-muted border border-border/60 overflow-hidden flex items-center justify-center group-hover:border-primary/40 transition-colors">
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted z-0">
                        <FileText className="h-4 w-4 text-muted-foreground/60 mb-0.5" />
                        <span className="text-[9px] font-bold uppercase text-muted-foreground">
                          {batch.firstDocumentContentType?.split("/").pop()?.slice(0, 4) ?? "DOC"}
                        </span>
                      </div>
                      {batch.firstDocumentObjectPath && isImage ? (
                        <img
                          src={storageUrl(batch.firstDocumentObjectPath)}
                          className="absolute inset-0 h-full w-full object-cover z-10"
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </div>

                    {/* Main Batch Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-body-sm font-bold text-foreground group-hover:text-primary transition-colors">
                          Batch #{batch.id}
                        </span>
                        <span className="rounded-md border border-border/60 bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                          {engineLabel}
                        </span>
                        <StatusBadge status={batch.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {timeAgo(batch.createdAt) || "just now"}
                        <span className="text-muted-foreground/40">•</span>
                        <span>
                          {batch.totalDocuments} document{batch.totalDocuments === 1 ? "" : "s"}
                        </span>
                      </p>
                    </div>

                    {/* Progress Indicator */}
                    <div className="hidden sm:flex w-32 shrink-0 flex-col gap-1.5 text-right">
                      <span
                        className={cn(
                          "text-xs tabular-nums font-semibold",
                          batch.status === "failed"
                            ? "text-destructive"
                            : progress === 100
                              ? "text-muted-foreground"
                              : "text-foreground"
                        )}
                      >
                        {batch.completedDocuments}/{batch.totalDocuments} docs
                      </span>
                      {progress < 100 && (
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              batch.status === "failed" ? "bg-destructive" : "bg-primary animate-pulse"
                            )}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="shrink-0 flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="hidden md:inline-flex h-8 px-2.5 text-xs rounded-lg text-muted-foreground hover:text-foreground font-semibold"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLocation(`/app/batches/${batch.id}`);
                        }}
                      >
                        View
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            aria-label={`Actions for batch #${batch.id}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 transition-all hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-48 rounded-xl"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem onClick={() => setLocation(`/app/batches/${batch.id}`)}>
                            <ExternalLink className="mr-2 h-4 w-4 text-muted-foreground" />
                            Open Batch Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => exportCSV(new Set([batch.id]))}>
                            <Download className="mr-2 h-4 w-4 text-muted-foreground" />
                            Export CSV
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => exportExcel(new Set([batch.id]))}>
                            <Download className="mr-2 h-4 w-4 text-muted-foreground" />
                            Export Excel (.xlsx)
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive focus:bg-destructive/10 font-semibold"
                            onClick={() => setPendingDelete({ ids: [batch.id], label: `Batch #${batch.id}` })}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Batch
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors ml-0.5" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* ── CARDS GRID VIEW ─────────────────────────────────────────────── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBatches.map((batch: BatchSummary) => {
            const isSelected = selectedIds.has(batch.id);
            const progress =
              batch.totalDocuments > 0 ? (batch.completedDocuments / batch.totalDocuments) * 100 : 0;
            const isImage = batch.firstDocumentContentType?.startsWith("image/");
            const engineLabel = engineLabels.get(batch.engineType ?? "") ?? batch.engineType ?? "Standard";

            return (
              <div
                key={batch.id}
                onClick={(e) => {
                  const t = e.target as HTMLElement;
                  if (t.tagName === "INPUT" || t.closest("button")) return;
                  if (isSelecting) {
                    toggleSelect(batch.id);
                    return;
                  }
                  setLocation(`/app/batches/${batch.id}`);
                }}
                className={cn(
                  "group relative flex flex-col justify-between rounded-2xl border p-4.5 cursor-pointer transition-all duration-150 shadow-2xs hover:shadow-md border-l-2",
                  isSelected
                    ? "border-l-primary border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-l-transparent border-border/70 bg-card hover:border-l-primary hover:border-primary/50"
                )}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select batch #${batch.id}`}
                        className="h-4 w-4 rounded border-border/70 cursor-pointer accent-primary"
                        checked={isSelected}
                        onChange={() => toggleSelect(batch.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="text-body-sm font-bold text-foreground group-hover:text-primary transition-colors">
                        Batch #{batch.id}
                      </span>
                    </div>
                    <StatusBadge status={batch.status} />
                  </div>

                  <div className="flex items-start gap-3 my-2">
                    <div className="relative h-14 w-14 shrink-0 rounded-xl bg-muted border border-border/60 overflow-hidden flex items-center justify-center group-hover:border-primary/40 transition-colors">
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted z-0">
                        <FileText className="h-4 w-4 text-muted-foreground/60 mb-0.5" />
                        <span className="text-[9px] font-bold uppercase text-muted-foreground">
                          {batch.firstDocumentContentType?.split("/").pop()?.slice(0, 4) ?? "DOC"}
                        </span>
                      </div>
                      {batch.firstDocumentObjectPath && isImage ? (
                        <img
                          src={storageUrl(batch.firstDocumentObjectPath)}
                          className="absolute inset-0 h-full w-full object-cover z-10"
                          alt=""
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <Badge variant="outline" className="text-[11px] font-semibold border-border/70 bg-muted/50">
                        {engineLabel}
                      </Badge>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {timeAgo(batch.createdAt) || "just now"}
                      </p>
                      <p className="text-xs font-semibold text-foreground">
                        {batch.completedDocuments} of {batch.totalDocuments} doc{batch.totalDocuments === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  {progress < 100 && (
                    <div className="my-2.5">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            batch.status === "failed" ? "bg-destructive" : "bg-primary animate-pulse"
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground font-mono">
                    ID: {batch.id}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs rounded-lg font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        exportCSV(new Set([batch.id]));
                      }}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      CSV
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs rounded-lg text-primary font-semibold"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocation(`/app/batches/${batch.id}`);
                      }}
                    >
                      Open
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── BULK ACTION FLOATING DOCK ────────────────────────────────────── */}
      {isSelecting && (
        <div className="fixed inset-x-4 bottom-5 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2.5 rounded-2xl border border-border/80 bg-card/95 px-4 py-2.5 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 pr-1 border-r border-border/60">
            <span className="text-body-sm font-bold text-foreground">
              {selectedIds.size} batch{selectedIds.size === 1 ? "" : "es"} selected
            </span>
          </div>

          <Button
            onClick={() => exportCSV()}
            disabled={!!busyAction}
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold"
          >
            {busyAction === "csv" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 text-primary" />
            )}
            Export CSV
          </Button>

          <Button
            onClick={() => exportExcel()}
            disabled={!!busyAction}
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold"
          >
            {busyAction === "excel" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 text-emerald-500" />
            )}
            Export Excel
          </Button>

          <Button
            onClick={handleBulkDelete}
            disabled={!!busyAction}
            variant="destructive"
            size="sm"
            className="h-8 gap-1.5 rounded-xl px-3 text-xs font-semibold"
          >
            {busyAction === "delete" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Delete Selected
          </Button>

          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-muted-foreground hover:text-foreground px-1.5 font-medium cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── PERMANENT DELETE CONFIRMATION DIALOG ──────────────────────────── */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !busyAction) setPendingDelete(null);
        }}
      >
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-body-lg font-bold">
              Permanently delete {pendingDelete?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-body-sm text-muted-foreground">
              This will permanently delete the batch, all uploaded document files from storage, and all extracted data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === "delete"} className="rounded-xl">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={performDelete}
              disabled={busyAction === "delete"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl font-bold border-none"
            >
              {busyAction === "delete" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...
                </>
              ) : (
                "Delete permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
