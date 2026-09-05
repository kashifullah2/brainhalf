import { useState, useEffect, CSSProperties } from "react";
import type { MetaFunction } from "@remix-run/cloudflare";
import { clientApi } from "../lib/api-url";
import {
  User, Palette, Cpu, CreditCard, Building2, Check, X, Plus, Trash2,
  TestTube2, Moon, Sun, Monitor, ChevronDown, Zap, Loader2,
} from "lucide-react";

interface AIProvider {
  id: string; name: string; provider: string; baseUrl: string; isDefault: boolean;
}

export const meta: MetaFunction = () => {
  return [
    { title: "Settings | BrainHalf" }
  ];
};

const S = {
  page:    { display: "flex", width: "100%", height: "100%", overflow: "hidden", background: "var(--bg)" } as CSSProperties,
  tabs:    { width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", padding: "32px 16px", display: "flex", flexDirection: "column" as const, gap: 2 },
  content: { flex: 1, overflowY: "auto" as const, padding: "40px 48px 80px", maxWidth: 780 },
  lbl:     { fontSize: 11, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase" as const, letterSpacing: "0.07em", fontFamily: "monospace" } as CSSProperties,
  sectionTitle: { fontSize: 18, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em", marginBottom: 4 } as CSSProperties,
  sectionSub:   { fontSize: 14, color: "var(--text-2)", marginBottom: 32 } as CSSProperties,
  divider: { height: 1, background: "var(--border)", margin: "32px 0" } as CSSProperties,
  input:   { width: "100%", background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: 14, color: "var(--text)", outline: "none", fontFamily: "inherit" } as CSSProperties,
  label:   { fontSize: 13, fontWeight: 500, color: "var(--text)", display: "block", marginBottom: 6 } as CSSProperties,
  btn: (v: "primary" | "secondary" | "danger"): CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8,
    fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)",
    background: v === "primary" ? "var(--accent)" : v === "danger" ? "rgba(239,68,68,0.1)" : "var(--bg-2)",
    color: v === "primary" ? "#fff" : v === "danger" ? "var(--red)" : "var(--text)",
  }),
};

const TABS = [
  { id: "profile",    label: "Profile",       Icon: User },
  { id: "appearance", label: "Appearance",    Icon: Palette },
  { id: "ai",         label: "AI Models",     Icon: Cpu },
  { id: "credits",    label: "Credits",       Icon: Zap },
  { id: "billing",    label: "Billing",       Icon: Building2 },
];

// ── Profile Tab ───────────────────────────────────────────
function ProfileTab() {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(clientApi("/api/users/me"), { credentials: "include" })
      .then(res => res.ok ? res.json() : null)
      .then((data: any) => {
        if (data) {
          setName(data.displayName || "");
          setUsername(data.username || "");
          setBio(data.bio || "");
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true); setError("");
    try {
      const res = await fetch(clientApi("/api/users/me"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name, username, bio }),
      });
      if (!res.ok) throw new Error("Failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 style={S.sectionTitle}>Profile</h2>
      <p style={S.sectionSub}>How you appear across BrainHalf.</p>
      <div style={{ display: "flex", gap: 32, alignItems: "flex-start", marginBottom: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg,#f97316,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700, color: "#fff" }}>
            {name ? name[0].toUpperCase() : "U"}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
          <div><label style={S.label}>Display Name</label><input value={name} onChange={e => setName(e.target.value)} style={S.input} /></div>
          <div><label style={S.label}>Username</label><input value={username} onChange={e => setUsername(e.target.value)} style={S.input} /></div>
          <div><label style={S.label}>Bio</label><textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} style={{ ...S.input, resize: "vertical", height: 80 }} /></div>
          {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
          <button onClick={save} disabled={saving} style={{ ...S.btn("primary"), opacity: saving ? 0.7 : 1 }}>
            {saving ? <><Loader2 size={14} /> Saving…</> : saved ? <><Check size={14} /> Saved!</> : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Appearance Tab ────────────────────────────────────────
function AppearanceTab() {
  const [theme, setTheme] = useState("dark");
  const [motion, setMotion] = useState(true);

  return (
    <div>
      <h2 style={S.sectionTitle}>Appearance</h2>
      <p style={S.sectionSub}>Customize how BrainHalf looks and feels.</p>
      <div style={{ marginBottom: 32 }}>
        <span style={{ ...S.lbl, display: "block", marginBottom: 16 }}>Theme</span>
        <div style={{ display: "flex", gap: 12 }}>
          {[{ id: "dark", label: "Dark", Icon: Moon }, { id: "light", label: "Light", Icon: Sun }, { id: "system", label: "System", Icon: Monitor }].map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setTheme(id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "16px 24px", borderRadius: 10, border: `2px solid ${theme === id ? "var(--accent)" : "var(--border)"}`, background: theme === id ? "var(--accent-muted)" : "var(--bg-2)", cursor: "pointer", minWidth: 100 }}>
              <Icon size={20} color={theme === id ? "var(--accent)" : "var(--text-2)"} />
              <span style={{ fontSize: 13, fontWeight: 600, color: theme === id ? "var(--accent)" : "var(--text-2)" }}>{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={S.divider} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-2)" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Reduce Motion</div>
          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>Minimize animations and transitions</div>
        </div>
        <button onClick={() => setMotion(p => !p)} style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: motion ? "var(--accent)" : "var(--bg-3)", transition: "background 200ms", position: "relative", padding: 0 }}>
          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: motion ? 23 : 3, transition: "left 200ms", boxShadow: "0 1px 4px rgba(0,0,0,0.3)" }} />
        </button>
      </div>
    </div>
  );
}

// ── AI Models Tab ─────────────────────────────────────────
function AIModelsTab() {
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", provider: "Cerebras", model: "", baseUrl: "", apiKey: "" });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | boolean>(null);
  const [saving, setSaving] = useState(false);
  const PROVIDERS = ["Groq", "Gemini", "FreeModel", "Cerebras", "AgentRouter", "OpenProvider", "Custom"];

  const applyProviderDefaults = (provider: string) => {
    if (provider === "FreeModel") {
      setForm((f) => ({
        ...f,
        provider,
        baseUrl: f.baseUrl || "https://cc.freemodel.dev/v1",
        model: f.model || "claude-sonnet-4-6",
        name: f.name || "FreeModel",
      }));
      return;
    }
    if (provider === "Groq") {
      setForm((f) => ({
        ...f,
        provider,
        baseUrl: f.baseUrl || "https://api.groq.com/openai/v1",
        model: f.model || "openai/gpt-oss-120b",
        name: f.name || "Groq",
      }));
      return;
    }
    if (provider === "Gemini") {
      setForm((f) => ({
        ...f,
        provider,
        baseUrl: f.baseUrl || "https://generativelanguage.googleapis.com/v1beta/openai",
        model: f.model || "gemini-2.0-flash",
        name: f.name || "Gemini",
      }));
      return;
    }
    setForm((f) => ({ ...f, provider }));
  };

  useEffect(() => {
    fetch(clientApi("/api/settings/ai-providers"), { credentials: "include" })
      .then(r => r.ok ? r.json() : { providers: [] })
      .then((d: any) => {
        if (d.providers && d.providers.length > 0) {
          setProviders(d.providers);
        } else {
          const local = localStorage.getItem("ai_providers_local");
          if (local) setProviders(JSON.parse(local));
        }
      })
      .catch(() => {
        const local = localStorage.getItem("ai_providers_local");
        if (local) setProviders(JSON.parse(local));
      })
      .finally(() => setLoading(false));
  }, []);

  const testConnection = async () => {
    setTesting(true); setTestResult(null);
    if (form.provider === 'Custom' && (!form.baseUrl || !form.name)) {
      setTestResult(false);
      setTesting(false);
      return;
    }

    try {
      // POST a temp provider to test — use a dummy id
      const res = await fetch(clientApi("/api/settings/ai-providers/test"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: form.provider, apiKey: form.apiKey, baseUrl: form.baseUrl }),
      });
      setTestResult(res.ok);
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  };

  const addProvider = async () => {
    if (!testResult) return;
    if (form.provider === 'Custom' && (!form.name || !form.baseUrl)) return;
    setSaving(true);
    try {
      const res = await fetch(clientApi("/api/settings/ai-providers"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, provider: form.provider, model: form.model, baseUrl: form.baseUrl, apiKey: form.apiKey }),
      });
      if (res.ok) {
        const created = await res.json() as AIProvider;
        setProviders(p => [...p, created]);
      } else {
        const created = { id: `local-${Date.now()}`, name: form.name, provider: form.provider, model: form.model, baseUrl: form.baseUrl, apiKey: form.apiKey, isDefault: false };
        setProviders(p => {
          const next = [...p, created];
          localStorage.setItem("ai_providers_local", JSON.stringify(next));
          return next;
        });
      }
      setShowAdd(false);
      setForm({ name: "", provider: "Anthropic", model: "", baseUrl: "", apiKey: "" });
      setTestResult(null);
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async (id: string) => {
    const res = await fetch(clientApi(`/api/settings/ai-providers/${id}`), { method: "DELETE", credentials: "include" });
    setProviders(p => {
      const next = p.filter(x => x.id !== id);
      if (!res.ok) localStorage.setItem("ai_providers_local", JSON.stringify(next));
      return next;
    });
  };

  const setDefault = async (id: string) => {
    setProviders(p => {
      const next = p.map(x => ({ ...x, isDefault: x.id === id }));
      localStorage.setItem("ai_providers_local", JSON.stringify(next));
      return next;
    });
  };

  return (
    <div>
      <h2 style={S.sectionTitle}>AI Models</h2>
      <p style={S.sectionSub}>Configure providers. Use your own API keys or self-hosted models.</p>

      {loading ? (
        <div style={{ color: "var(--text-3)", fontFamily: "monospace", fontSize: 13 }}>Loading providers…</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          {providers.map(p => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-2)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{p.name}</span>
                  {p.isDefault && <span style={{ padding: "1px 7px", borderRadius: 20, background: "var(--accent-muted)", color: "var(--accent)", fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>DEFAULT</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4, fontFamily: "monospace" }}>{p.provider}{p.baseUrl ? ` · ${p.baseUrl}` : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {!p.isDefault && <button onClick={() => setDefault(p.id)} style={S.btn("secondary")}><Check size={13} /> Set Default</button>}
                <button onClick={() => removeProvider(p.id)} style={S.btn("danger")}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
          {providers.length === 0 && <p style={{ color: "var(--text-3)", fontSize: 13 }}>No providers configured yet.</p>}
        </div>
      )}

      {!showAdd ? (
        <button onClick={() => setShowAdd(true)} style={S.btn("secondary")}><Plus size={14} /> Add Provider</button>
      ) : (
        <div style={{ padding: 24, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-2)", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Add AI Provider</span>
            <button onClick={() => { setShowAdd(false); setTestResult(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-2)" }}><X size={18} /></button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {form.provider === 'Custom' ? (
              <div><label style={S.label}>Display Name <span style={{ color: "var(--red)" }}>*</span></label><input placeholder="My Custom Node" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={S.input} /></div>
            ) : (
              <div><label style={S.label}>Display Name <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label><input placeholder="My API Key" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={S.input} /></div>
            )}
            <div>
              <label style={S.label}>Provider</label>
              <div style={{ position: "relative" }}>
                <select value={form.provider} onChange={e => applyProviderDefaults(e.target.value)} style={{ ...S.input, appearance: "none", paddingRight: 36 }}>
                  {PROVIDERS.map(p => <option key={p}>{p}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-2)", pointerEvents: "none" }} />
              </div>
            </div>
            <div><label style={S.label}>API Key</label><input type="password" placeholder="sk-…" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} style={S.input} /></div>
            <div><label style={S.label}>Model</label><input placeholder="claude-3-5-sonnet-20241022" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} style={S.input} /></div>
            {form.provider === 'Custom' ? (
              <div style={{ gridColumn: "1/-1" }}><label style={S.label}>Base URL <span style={{ color: "var(--red)" }}>*</span></label><input placeholder="http://localhost:11434/v1" value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} style={S.input} /></div>
            ) : (
              <div style={{ gridColumn: "1/-1" }}><label style={S.label}>Base URL <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label><input placeholder="https://api.custom.com/v1" value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} style={S.input} /></div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={testConnection} disabled={testing || (form.provider !== 'Custom' && !form.apiKey)} style={{ ...S.btn("secondary"), opacity: testing || (form.provider !== 'Custom' && !form.apiKey) ? 0.5 : 1 }}>
              {testing ? <><Loader2 size={14} /> Testing…</> : <><TestTube2 size={14} /> Test Connection</>}
            </button>
            {testResult === true && <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--green)", fontWeight: 600 }}><Check size={14} /> Connected!</span>}
            {testResult === false && <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--red)", fontWeight: 600 }}><X size={14} /> Failed — check key</span>}
            <button onClick={addProvider} disabled={!testResult || saving} style={{ ...S.btn("primary"), marginLeft: "auto", opacity: testResult && !saving ? 1 : 0.4 }}>
              {saving ? "Saving…" : "Add Provider"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Credits Tab ───────────────────────────────────────────
function CreditsTab() {
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => {
    fetch(clientApi("/api/settings/credits"), { credentials: "include" })
      .then(r => r.ok ? r.json() : { balance: 0, history: [] })
      .then((d: any) => { setBalance(d.balance); setHistory(d.history || []); })
      .catch(() => { setBalance(0); setHistory([]); })
      .finally(() => setLoading(false));
  }, []);

  const creditPacks = [
    { id: "c1", credits: 500,  price: 5,  label: "Starter",  popular: false },
    { id: "c2", credits: 1200, price: 10, label: "Creator",  popular: true  },
    { id: "c3", credits: 3500, price: 25, label: "Studio",   popular: false },
  ];

  return (
    <div>
      <h2 style={S.sectionTitle}>Credits</h2>
      <p style={S.sectionSub}>Purchase credits to generate games. 1 credit ≈ 1 generation step.</p>

      <div style={{ padding: 28, borderRadius: 12, border: "1px solid var(--accent)", background: "var(--accent-muted)", marginBottom: 32, display: "flex", alignItems: "center", gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "monospace", marginBottom: 4 }}>Current Balance</div>
          <div style={{ fontSize: 56, fontWeight: 800, color: "var(--accent)", fontFamily: "monospace", letterSpacing: "-0.04em", lineHeight: 1 }}>
            {loading ? "…" : balance ?? 0}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4 }}>credits remaining</div>
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <span style={{ ...S.lbl, display: "block", marginBottom: 16 }}>Top Up Credits</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
          {creditPacks.map(pack => (
            <div key={pack.id} style={{ padding: 20, borderRadius: 12, border: `2px solid ${pack.popular ? "var(--accent)" : "var(--border)"}`, background: pack.popular ? "var(--accent-muted)" : "var(--bg-2)", display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
              {pack.popular && <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", padding: "2px 12px", borderRadius: 20, background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 700, fontFamily: "monospace", whiteSpace: "nowrap" }}>MOST POPULAR</div>}
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "monospace" }}>{pack.label}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", fontFamily: "monospace" }}>{pack.credits.toLocaleString()}<span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-2)", marginLeft: 4 }}>credits</span></div>
              <div style={{ fontSize: 22, fontWeight: 700, color: pack.popular ? "var(--accent)" : "var(--text)" }}>${pack.price}</div>
              <button
                onClick={() => setBuying(pack.id)}
                style={{ ...S.btn(pack.popular ? "primary" : "secondary"), justifyContent: "center" }}
              >
                {buying === pack.id ? "Processing…" : `Buy for $${pack.price}`}
              </button>
            </div>
          ))}
        </div>
      </div>

      {history.length > 0 && (
        <>
          <span style={{ ...S.lbl, display: "block", marginBottom: 12 }}>Usage History</span>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 100px", padding: "8px 16px", background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
              {["Date", "Type", "Credits"].map(h => <span key={h} style={{ ...S.lbl, fontSize: 10 }}>{h}</span>)}
            </div>
            {history.map((row, i) => (
              <div key={row.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr 100px", padding: "12px 16px", borderBottom: i < history.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "monospace" }}>{new Date(row.createdAt).toLocaleDateString()}</span>
                <span style={{ fontSize: 13, color: "var(--text)" }}>{row.type.replace("_", " ")}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--green)", fontFamily: "monospace", textAlign: "right" }}>+{row.creditsAdded}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Billing Tab ───────────────────────────────────────────
function BillingTab() {
  return (
    <div>
      <h2 style={S.sectionTitle}>Billing</h2>
      <p style={S.sectionSub}>Manage your subscription and payment methods.</p>
      <div style={{ padding: 24, borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-2)", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>Free Plan</span>
              <span style={{ padding: "2px 8px", borderRadius: 20, background: "var(--accent-muted)", color: "var(--accent)", fontSize: 10, fontWeight: 700, fontFamily: "monospace" }}>CURRENT</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)" }}>100 free credits on signup</div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {["100 credits/month", "Up to 5 projects", "2D & 3D games", "Public arcade"].map(f => (
            <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)" }}>
              <Check size={14} color="var(--green)" />{f}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button style={S.btn("primary")}>Upgrade to Pro — $12/mo</button>
        <button style={S.btn("secondary")}>Upgrade to Studio — $29/mo</button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("profile");

  const tabContent: Record<string, React.ReactNode> = {
    profile:    <ProfileTab />,
    appearance: <AppearanceTab />,
    ai:         <AIModelsTab />,
    credits:    <CreditsTab />,
    billing:    <BillingTab />,
  };

  return (
    <div style={S.page}>
      <div style={S.tabs}>
        <span style={{ ...S.lbl, display: "block", marginBottom: 16, paddingLeft: 12 }}>Settings</span>
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: activeTab === id ? "var(--bg-2)" : "transparent", color: activeTab === id ? "var(--text)" : "var(--text-2)", fontWeight: activeTab === id ? 600 : 400, fontSize: 14, width: "100%", textAlign: "left", transition: "background 150ms, color 150ms", borderLeft: activeTab === id ? "2px solid var(--accent)" : "2px solid transparent" }}>
            <Icon size={16} />{label}
          </button>
        ))}
      </div>
      <div style={S.content}>{tabContent[activeTab]}</div>
    </div>
  );
}
