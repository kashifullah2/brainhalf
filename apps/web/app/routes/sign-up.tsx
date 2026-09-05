import { Link, useNavigate } from "@remix-run/react";
import { ThemeToggle } from "../../components/theme-toggle";
import type { MetaFunction } from "@remix-run/cloudflare";
import { useState } from "react";
import { signUpWithEmail } from "../lib/auth-api";

export const meta: MetaFunction = () => {
  return [
    { title: "Sign Up | BrainHalf" }
  ];
};

export default function SignUpPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    const name = String(form.get("name") || "");

    const result = await signUpWithEmail(email, password, name);
    setLoading(false);

    if (!result.ok) {
      setError(result.error || "Sign up failed");
      return;
    }

    navigate("/dashboard");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(ellipse 70% 50% at 80% -10%, rgba(249,115,22,0.10), transparent), var(--bg)",
        color: "var(--text)",
      }}
    >
      <header style={{ padding: "20px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)" }} />
          <span style={{ fontFamily: "monospace", fontWeight: 600, letterSpacing: "-0.05em", fontSize: 15, color: "var(--text)" }}>BRAINHALF</span>
        </Link>
        <ThemeToggle />
      </header>

      <main style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
        <form
          onSubmit={handleRegister}
          style={{
            width: "100%",
            maxWidth: 430,
            background: "color-mix(in srgb, var(--bg-2) 94%, transparent)",
            padding: 34,
            borderRadius: 18,
            border: "1px solid var(--border)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>AUTH // CREATE ACCOUNT</p>
            <h1 style={{ fontSize: 30, fontWeight: 650, margin: "8px 0 8px", letterSpacing: "-0.02em" }}>Join BrainHalf</h1>
            <p style={{ fontSize: 14, color: "var(--text-2)", margin: 0 }}>Set up your account and start building playable games in minutes.</p>
          </div>

          {error && (
            <div style={{ fontSize: 13, color: "var(--red, #ef4444)", marginBottom: 16, padding: "10px 12px", borderRadius: 10, border: "1px solid color-mix(in srgb, var(--red) 45%, transparent)", background: "color-mix(in srgb, var(--red) 10%, transparent)" }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8, color: "var(--text)" }}>Display name</label>
            <input name="name" type="text" placeholder="Player One" style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", outline: "none", fontSize: 14 }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8, color: "var(--text)" }}>Email</label>
            <input name="email" type="email" placeholder="you@example.com" required style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", outline: "none", fontSize: 14 }} />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 8, color: "var(--text)" }}>Password</label>
            <input name="password" type="password" placeholder="At least 8 characters" required minLength={8} style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", outline: "none", fontSize: 14 }} />
          </div>

          <button type="submit" disabled={loading} style={{ width: "100%", padding: "13px", borderRadius: 10, background: "linear-gradient(135deg, var(--accent), var(--accent-2))", color: "#fff", fontWeight: 650, border: "none", cursor: loading ? "wait" : "pointer", fontSize: 14, marginBottom: 16, opacity: loading ? 0.7 : 1 }}>
            {loading ? "Creating account…" : "Sign Up"}
          </button>

          <p style={{ textAlign: "center", fontSize: 13, color: "var(--text-2)", margin: 0 }}>
            Already have an account? <Link to="/sign-in" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>Sign in</Link>
          </p>
        </form>
      </main>
    </div>
  );
}
