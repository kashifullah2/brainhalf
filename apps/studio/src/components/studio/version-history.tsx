import { useCallback, useEffect, useRef, useState } from "react";
import { History, RotateCcw, Loader2 } from "lucide-react";
import { useStudioStore } from "@stores/studio-store";
import { listCheckpoints, restoreCheckpoint, CheckpointMeta } from "@lib/persistence";

function timeAgo(ts: number | string): string {
  const then = typeof ts === "number" ? (ts < 1e12 ? ts * 1000 : ts) : new Date(ts).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function VersionHistory() {
  const projectId = useStudioStore((s) => s.projectId);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [items, setItems] = useState<CheckpointMeta[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listCheckpoints());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleRestore = useCallback(async (id: string) => {
    setRestoringId(id);
    try {
      const ok = await restoreCheckpoint(id);
      if (ok) setOpen(false);
    } finally {
      setRestoringId(null);
    }
  }, []);

  if (!projectId) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="studio-btn"
        onClick={() => setOpen((o) => !o)}
        title="Version history"
      >
        <History size={14} /> Versions
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 320,
            maxHeight: 360,
            overflowY: "auto",
            background: "var(--bg-2, #15161a)",
            border: "1px solid var(--panel-border, #2a2b31)",
            borderRadius: 8,
            boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
            zIndex: 50,
            padding: 6,
          }}
        >
          <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-3, #8a8b92)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            checkpoints
          </div>

          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px", color: "var(--text-2,#aaa)", fontSize: 12 }}>
              <Loader2 size={14} className="studio-tool-spin" /> loading…
            </div>
          )}

          {!loading && items.length === 0 && (
            <div style={{ padding: "10px", color: "var(--text-3,#888)", fontSize: 12 }}>
              No checkpoints yet. One is saved automatically before each generation.
            </div>
          )}

          {!loading &&
            items.map((cp) => (
              <div
                key={cp.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--text, #eaeaea)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-center, #1d1e24)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cp.label}</div>
                  <div style={{ color: "var(--text-3,#888)", fontSize: 11 }}>
                    {cp.fileCount} file{cp.fileCount === 1 ? "" : "s"} · {timeAgo(cp.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  className="studio-icon-btn"
                  title="Restore this version"
                  disabled={restoringId !== null}
                  onClick={() => handleRestore(cp.id)}
                >
                  {restoringId === cp.id ? <Loader2 size={13} className="studio-tool-spin" /> : <RotateCcw size={13} />}
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
