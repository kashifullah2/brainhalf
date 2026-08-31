import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, FileCheck } from "lucide-react";
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
      { label: "Who signed?", value: "A. Reyes, CFO", status: "Verified" },
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
      { label: "Patient Name", value: "R. Mwangi", status: "Verified" },
      { label: "Symptoms", value: "Mild fever, cough", status: "Verified" },
      { label: "Temperature", value: "99.8°F", status: "Verified" },
      { label: "Heart Rate", value: "78 bpm", status: "Verified" },
      { label: "Doctor Notes", value: "Rest & hydration", status: "Verified" },
    ],
  },
};

/**
 * The sample extraction shown beside the hero copy. The tabs are real — they
 * switch between three fixtures — and the fixtures are labelled as samples.
 *
 * It used to present itself as a "LIVE EXTRACTION PREVIEW" with three macOS
 * traffic lights, a pulsing green dot and a "Processed in 0.84s" footer. None
 * of that was true: no document is being read, and the timing was invented. A
 * preview that claims to be live is a claim the page cannot support, so it now
 * says what it is.
 */
export function HeroPreview() {
  const [activeTab, setActiveTab] = useState<SampleTab>("key_value");
  const current = SAMPLE_DATA[activeTab];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-xl shadow-primary/5">
      {/* Soft top glow for depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/40 via-primary/80 to-primary/40"
      />
      {/* Header: what this is, and which mode is on show */}
      <div className="mb-4 flex flex-col justify-between gap-3 border-b border-border/50 pb-4 sm:flex-row sm:items-center">
        <p className="flex items-center gap-2 text-caption font-semibold text-muted-foreground">
          <FileCheck className="h-4 w-4 shrink-0 text-primary" />
          Sample extraction
        </p>
        <div
          role="tablist"
          aria-label="Extraction mode"
          className="flex flex-wrap gap-1 rounded-lg bg-muted p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-2.5 py-1 text-caption font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                activeTab === tab
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-12">
        {/* The document side */}
        <div className="flex flex-col justify-between gap-4 rounded-lg border border-border/60 bg-muted/50 p-4 sm:col-span-5">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-caption font-semibold text-primary">
              <FileCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{current.title}</span>
            </p>
            {/* Stand-in for page content. Static: an animate-pulse here read as
                a load that never finished. */}
            <div aria-hidden className="space-y-2 pt-1">
              <div className="h-2.5 w-3/4 rounded-full bg-foreground/15" />
              <div className="h-2 w-full rounded-full bg-foreground/10" />
              <div className="h-2 w-5/6 rounded-full bg-foreground/10" />
              <div className="h-2 w-4/6 rounded-full bg-foreground/10" />
            </div>
            <p className="mt-3 truncate rounded-lg border border-primary/25 bg-primary/10 p-2.5 font-data text-caption font-semibold text-primary">
              Total: {current.total}
            </p>
          </div>
          <p className="flex items-center justify-between border-t border-border/50 pt-3 text-caption font-medium text-muted-foreground">
            <span>Confidence</span>
            <span className="font-semibold text-success">{current.confidence}</span>
          </p>
        </div>

        {/* The fields side */}
        <ul className="space-y-2 sm:col-span-7">
          {current.fields.map((field, i) => (
            <li
              key={`${activeTab}-${field.label}`}
              className="animate-fade-up flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background p-2.5"
              style={{ animationDelay: `${300 + i * 60}ms` }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-caption font-medium text-muted-foreground">
                  {field.label}
                </p>
                <p className="mt-0.5 truncate font-data text-body-sm font-semibold text-foreground">
                  {field.value}
                </p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-micro font-semibold text-success">
                <Check className="h-3 w-3" /> {field.status}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center">
        <p className="text-caption text-muted-foreground">
          Sample data. Your own files return the same shape.
        </p>
        <Button asChild size="sm" variant="ghost" className="text-primary">
          <Link href="/app/upload">
            Try it with your file
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
