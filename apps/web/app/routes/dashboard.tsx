import { Link, useLoaderData, useNavigate } from "@remix-run/react";
import { useState, CSSProperties } from "react";
import { Plus, ArrowRight, Eye, ExternalLink, Share2, Trash2, TrendingUp, TrendingDown, Zap, Flame, Gamepad2 } from "lucide-react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { apiPath, clientApi, cloudflareEnv, getServerApiUrl } from "../lib/api-url";

interface Project {
  id: string;
  title: string;
  gameType: string;
  status: string;
  playCount: number;
  updatedAt: string;
  thumbnailUrl?: string;
}

interface CreditsData {
  balance: number;
  history: { id: string; type: string; creditsAdded: number; createdAt: string }[];
}

export const meta: MetaFunction = () => {
  return [
    { title: "Dashboard | BrainHalf" },
  ];
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  const cookie = request.headers.get("Cookie") ?? "";
  const apiBase = getServerApiUrl(request, cloudflareEnv(context));

  try {
    const [projectsRes, creditsRes] = await Promise.all([
      fetch(apiPath(apiBase, "/api/projects"), { headers: { Cookie: cookie } }),
      fetch(apiPath(apiBase, "/api/settings/credits"), { headers: { Cookie: cookie } }),
    ]);

    const projects: Project[] = projectsRes.ok
      ? ((await projectsRes.json()) as { projects?: Project[] }).projects ?? []
      : [];

    const credits: CreditsData = creditsRes.ok
      ? (await creditsRes.json()) as CreditsData
      : { balance: 0, history: [] };

    return Response.json({ projects, credits });
  } catch {
    return Response.json({ projects: [], credits: { balance: 0, history: [] } });
  }
}

const GRADIENTS = [
  "linear-gradient(135deg,#f97316,#7c3aed)",
  "linear-gradient(135deg,#3b82f6,#06b6d4)",
  "linear-gradient(135deg,#22c55e,#0ea5e9)",
  "linear-gradient(135deg,#a855f7,#ec4899)",
  "linear-gradient(135deg,#f43f5e,#f97316)",
];

const lbl: CSSProperties = {
  fontSize: 11, fontWeight: 600, color: "var(--text-3)",
  textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "monospace",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    ready:      { bg: "rgba(34,197,94,0.12)",  color: "#22c55e", label: "Ready" },
    generating: { bg: "rgba(249,115,22,0.12)", color: "#f97316", label: "Building…" },
    failed:     { bg: "rgba(239,68,68,0.12)",  color: "#ef4444", label: "Failed" },
    idle:       { bg: "rgba(136,136,136,0.1)", color: "#888",    label: "Idle" },
  };
  const s = map[status] ?? map.idle;
  return (
    <span style={{ padding: "2px 8px", borderRadius: 20, background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, fontFamily: "monospace", whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

function ProjectRow({ p, index }: { p: Project; index: number }) {
  const [hov, setHov] = useState(false);
  const navigate = useNavigate();

  const handleDelete = async () => {
    if (!confirm(`Delete "${p.title}"?`)) return;
    await fetch(clientApi(`/api/projects/${p.id}`), { method: "DELETE", credentials: "include" });
    navigate(".", { replace: true });
  };

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: "grid", gridTemplateColumns: "1fr 120px 80px 120px 116px", alignItems: "center", padding: "8px 16px", background: hov ? "var(--bg-2)" : "transparent", transition: "background 150ms" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
        <div style={{ width: 40, height: 30, borderRadius: 6, background: p.thumbnailUrl || GRADIENTS[index % GRADIENTS.length], flexShrink: 0, border: "1px solid var(--border)" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace", marginTop: 2 }}>{p.gameType?.toUpperCase()}</div>
        </div>
      </div>
      <div><StatusBadge status={p.status} /></div>
      <div style={{ fontSize: 13, color: "var(--text-2)", fontFamily: "monospace" }}>
        {p.playCount > 0 ? p.playCount.toLocaleString() : "—"}
      </div>
      <div style={{ fontSize: 13, color: "var(--text-2)" }}>
        {new Date(p.updatedAt).toLocaleDateString()}
      </div>
      <div style={{ display: "flex", gap: 4, opacity: hov ? 1 : 0, transition: "opacity 150ms", pointerEvents: hov ? "auto" : "none", justifyContent: "flex-end" }}>
        <Link to={`/studio?projectId=${p.id}`} title="Open" style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-3)", color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <ExternalLink size={13} />
        </Link>
        <button title="Share" style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-3)", color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Share2 size={13} />
        </button>
        <button title="Delete" onClick={handleDelete} style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-3)", color: "var(--red)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export default function DashboardPage() {
  const { projects, credits } = useLoaderData<typeof loader>() as any;
  const loading = false; // Data is loaded via Remix

  const stats = [
    { label: "Games Created", value: projects.length.toString(),                          trend: "",     up: true,  Icon: Gamepad2 },
    { label: "Total Plays",   value: projects.reduce((s, p) => s + p.playCount, 0).toLocaleString(), trend: "", up: true, Icon: Eye },
    { label: "Credits Left",  value: credits ? credits.balance.toString() : "—",          trend: "",     up: credits ? credits.balance > 50 : true, Icon: Zap },
    { label: "Day Streak",    value: "—",                                                  trend: "",     up: true,  Icon: Flame },
  ];

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden", background: "var(--bg)" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "40px 48px 80px" }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Good {getGreeting()}
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-2)" }}>Here's what's happening with your games today.</p>
        </div>

        {/* Stat Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 40 }}>
          {stats.map(({ label, value, trend, up, Icon }) => (
            <div key={label} style={{ padding: "20px 24px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-2)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={lbl}>{label}</span>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: "var(--bg-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={14} color="var(--text-2)" />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                <span style={{ fontSize: 32, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.03em", fontFamily: "monospace" }}>
                  {loading ? "…" : value}
                </span>
                {trend && (
                  <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 600, fontFamily: "monospace", color: up ? "var(--green)" : "var(--red)", paddingBottom: 4 }}>
                    {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{trend}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40, flexWrap: "wrap" }}>
          <Link to="/studio" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 8, background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 14, textDecoration: "none", boxShadow: "0 0 20px rgba(249,115,22,0.2)" }}>
            <Plus size={17} /> New Game
          </Link>
          <Link to="/arcade" style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 8, color: "var(--text-2)", fontWeight: 500, fontSize: 14, textDecoration: "none" }}>
            Browse Arcade <ArrowRight size={14} />
          </Link>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "0 0 32px" }} />

        {/* Recent Projects */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={lbl}>Recent Projects</span>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontFamily: "monospace", fontSize: 13 }}>Loading projects…</div>
        ) : projects.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontFamily: "monospace", fontSize: 13 }}>
            No projects yet. <Link to="/studio" style={{ color: "var(--accent)", textDecoration: "none" }}>Create your first game →</Link>
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--bg)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 80px 120px 116px", padding: "8px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}>
              {["Project", "Status", "Plays", "Last Edited", ""].map(h => (
                <span key={h} style={{ ...lbl, fontSize: 10 }}>{h}</span>
              ))}
            </div>
            {projects.map((p, i) => (
              <div key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <ProjectRow p={p} index={i} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Credits Sidebar */}
      <aside style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--border)", overflowY: "auto", padding: "40px 20px" }}>
        <span style={{ ...lbl, display: "block", marginBottom: 20 }}>Credits</span>
        <div style={{ padding: 16, borderRadius: 10, background: "var(--accent-muted)", border: "1px solid rgba(249,115,22,0.2)", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Zap size={14} color="var(--accent)" />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
              {loading ? "…" : `${credits?.balance ?? 0} credits left`}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, margin: "0 0 12px" }}>
            {credits && credits.balance < 50 ? "Running low. Top up to keep building." : "You're good to go."}
          </p>
          <Link to="/settings" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            Manage Credits <ArrowRight size={12} />
          </Link>
        </div>

        {credits && credits.history.length > 0 && (
          <>
            <span style={{ ...lbl, display: "block", marginBottom: 12 }}>Recent Transactions</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {credits.history.slice(0, 5).map(item => (
                <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                  <span style={{ color: "var(--text-2)" }}>{item.type.replace("_", " ")}</span>
                  <span style={{ color: "var(--green)", fontFamily: "monospace", fontWeight: 600 }}>+{item.creditsAdded}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
