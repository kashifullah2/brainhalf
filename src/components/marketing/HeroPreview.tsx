import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

type SampleTab = "key_value" | "vqa" | "custom";

const TABS: SampleTab[] = ["key_value", "vqa", "custom"];

const TAB_LABELS: Record<SampleTab, string> = {
  key_value: "Key-Value",
  vqa: "Visual Q&A",
  custom: "Custom Prompt",
};

interface SampleField {
  label: string;
  value: string;
  status: string;
}

interface SampleDoc {
  title: string;
  vendor: string;
  date: string;
  total: string;
  confidence: string;
  fields: SampleField[];
}

// Static fixture data — kept at module scope so switching tabs never rebuilds it.
const SAMPLE_DATA: Record<SampleTab, SampleDoc> = {
  key_value: {
    title: "ACME Corp Invoice #INV-8902",
    vendor: "Acme Cloud Services",
    date: "Oct 24, 2026",
    total: "$1,450.00",
    confidence: "High",
    fields: [
      { label: "Invoice Number", value: "INV-8902", status: "Verified" },
      { label: "Vendor Name", value: "Acme Cloud Services", status: "Verified" },
      { label: "Subtotal Amount", value: "$1,250.00", status: "Verified" },
      { label: "Tax (16%)", value: "$200.00", status: "Verified" },
      { label: "Total Due", value: "$1,450.00", status: "Verified" },
    ],
  },
  vqa: {
    title: "Quarterly Report Q3",
    vendor: "Internal",
    date: "Sep 30, 2026",
    total: "Q3 Summary",
    confidence: "High",
    fields: [
      { label: "Total Revenue?", value: "$4.2M", status: "Verified" },
      { label: "Who signed?", value: "Jane Doe, CEO", status: "Verified" },
      { label: "Key risk?", value: "Supply chain delays", status: "Verified" },
      { label: "Targets met?", value: "Yes, exceeded by 12%", status: "Verified" },
      { label: "Next review?", value: "Jan 15, 2027", status: "Verified" },
    ],
  },
  custom: {
    title: "Handwritten Patient Intake",
    vendor: "City Clinic",
    date: "Aug 12, 2026",
    total: "Intake Form",
    confidence: "Medium",
    fields: [
      { label: "Patient Name", value: "Alex M. Johnson", status: "Verified" },
      { label: "Symptoms", value: "Mild fever, cough", status: "Verified" },
      { label: "Temperature", value: "99.8°F", status: "Verified" },
      { label: "Heart Rate", value: "78 bpm", status: "Verified" },
      { label: "Doctor Notes", value: "Rest & hydration", status: "Verified" },
    ],
  },
};

/**
 * Interactive product preview shown in the hero: a simulated document with
 * parsed, verified fields. Tab state is fully local to this widget.
 */
export function HeroPreview() {
  const [activeTab, setActiveTab] = useState<SampleTab>("key_value");
  const current = SAMPLE_DATA[activeTab];

  return (
    <div className="group relative rounded-3xl border border-border/60 bg-card p-6 shadow-xl backdrop-blur-xl transition-shadow duration-500 hover:shadow-glow">
      {/* Gradient hairline along the card's top edge — a quiet signal that
          this panel is the product, not chrome. */}
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      {/* Visual Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-4 border-b border-border/40">
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="h-3 w-3 rounded-full bg-red-400/80" />
          <div className="h-3 w-3 rounded-full bg-warning/80" />
          <div className="relative flex h-3 w-3 rounded-full bg-emerald-400/80">
            {/* The "recording" dot: a slow pulse on the live dot only, so the
                preview reads as running. */}
            <span className="absolute inset-0 rounded-full bg-emerald-400/60 animate-ping" />
          </div>
          <span className="ml-2 text-xs font-bold text-muted-foreground tracking-wide uppercase">
            Live Extraction Preview
          </span>
        </div>
        <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-xl text-xs font-semibold self-start sm:self-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 rounded-lg transition-all ${
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      {/* Document & Field Grid */}
      <div className="grid sm:grid-cols-12 gap-4">
        {/* Simulated Document Preview */}
        <div className="sm:col-span-5 bg-muted/60 rounded-2xl p-4 border border-border/40 flex flex-col justify-between relative overflow-hidden group">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <FileCheck className="h-4 w-4 shrink-0" />
              <span className="truncate">{current.title}</span>
            </div>
            <div className="space-y-2 pt-2">
              <div className="h-2.5 w-3/4 bg-foreground/20 rounded-full animate-pulse" />
              <div className="h-2 w-full bg-foreground/10 rounded-full" />
              <div className="h-2 w-5/6 bg-foreground/10 rounded-full" />
              <div className="h-2 w-4/6 bg-foreground/10 rounded-full" />
            </div>
            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/30 text-xs font-mono font-bold text-primary mt-4 truncate">
              Extracted Total: {current.total}
            </div>
          </div>
          <div className="pt-4 flex items-center justify-between text-[11px] font-semibold text-muted-foreground border-t border-border/40 mt-4">
            <span>Confidence</span>
            <span className="text-emerald-600 font-bold">
              {current.confidence}
            </span>
          </div>
        </div>

        {/* Parsed Fields Table */}
        <div className="sm:col-span-7 space-y-2">
          {current.fields.map((field, i) => (
            <div
              key={`${activeTab}-${field.label}`}
              className="animate-fade-up flex items-center justify-between p-2.5 rounded-xl bg-background border border-border/50 hover:border-primary/40 transition-all duration-300 shadow-xs gap-2 group/field"
              style={{ animationDelay: `${300 + i * 60}ms` }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider truncate">
                  {field.label}
                </p>
                <p className="text-xs font-semibold text-foreground font-mono mt-0.5 truncate">
                  {field.value}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full transition-transform duration-300 group-hover/field:scale-105">
                <CheckCircle2 className="h-3 w-3" /> {field.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Extraction Action Footer */}
      <div className="mt-5 pt-4 border-t border-border/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <span className="text-xs font-medium text-muted-foreground">
          Processed in{" "}
          <strong className="text-foreground font-mono">0.84s</strong> via BH
          Model 1
        </span>
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-8 text-xs font-bold text-primary hover:text-primary group/btn"
        >
          <Link href="/app/upload" className="flex items-center">
            Try with your file
            <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform duration-300 group-hover/btn:translate-x-0.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
