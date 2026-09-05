import { Link } from "@remix-run/react";
import { Check } from "lucide-react";
import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => {
  return [
    { title: "Pricing | BrainHalf" }
  ];
};

export default function PricingPage() {
  const plans = [
    {
      name: "Free",
      price: "$0",
      credits: "100 credits/month",
      features: ["Up to 5 projects", "2D & 3D games", "Public arcade"],
      popular: false,
    },
    {
      name: "Pro",
      price: "$12",
      credits: "1200 credits/month",
      features: ["Unlimited projects", "Priority generation", "Private games", "No watermarks"],
      popular: true,
    },
    {
      name: "Studio",
      price: "$29",
      credits: "3500 credits/month",
      features: ["All Pro features", "Custom AI models", "Export to ZIP", "API Access"],
      popular: false,
    },
  ];

  return (
    <div style={{ padding: "80px 24px", maxWidth: 1000, margin: "0 auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 48, fontWeight: 700, marginBottom: 16, letterSpacing: "-0.03em" }}>Pricing</h1>
      <p style={{ fontSize: 18, color: "var(--text-2)", marginBottom: 60 }}>Simple, transparent pricing for everyone.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, textAlign: "left" }}>
        {plans.map(p => (
          <div key={p.name} style={{ border: `2px solid ${p.popular ? "var(--accent)" : "var(--border)"}`, borderRadius: 16, padding: 32, position: "relative", background: p.popular ? "var(--bg-2)" : "var(--bg)" }}>
            {p.popular && <span style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent)", color: "#fff", padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>MOST POPULAR</span>}
            <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>{p.name}</h2>
            <div style={{ fontSize: 40, fontWeight: 700, marginBottom: 24 }}>{p.price}<span style={{ fontSize: 16, color: "var(--text-2)", fontWeight: 500 }}>/mo</span></div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 24, padding: "8px 12px", background: "var(--bg-3)", borderRadius: 8 }}>{p.credits}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 32px", display: "flex", flexDirection: "column", gap: 12 }}>
              {p.features.map(f => (
                <li key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--text-2)" }}>
                  <Check size={16} color="var(--green)" /> {f}
                </li>
              ))}
            </ul>
            <Link to="/dashboard" style={{ display: "block", width: "100%", textAlign: "center", padding: "12px 0", borderRadius: 8, background: p.popular ? "var(--accent)" : "var(--bg-3)", color: p.popular ? "#fff" : "var(--text)", fontWeight: 600, textDecoration: "none" }}>
              Get Started
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
