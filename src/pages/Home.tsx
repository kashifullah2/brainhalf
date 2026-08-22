import { useState } from "react";
import { Link } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/use-page-title";
import {
  FileText,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Smile,
  Upload,
  Download,
  FileCheck,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

const FAQ_ITEMS = [
  {
    q: "Which file types does BrainHalf support?",
    a: "JPG, PNG, WEBP and PDF, up to 25 MB per file. Photos, scans and exported PDFs all work.",
  },
  {
    q: "Do I need to build a template for every document layout?",
    a: "No. Pick a preset such as Invoice, Receipt, Table or Handwriting, or write a custom prompt. The extraction engine reads each page directly, so new vendors and layouts work without any setup.",
  },
  {
    q: "What happens when a field is extracted incorrectly?",
    a: "Every field carries a confidence score. Double-click any cell to correct it inline, and documents below your confidence threshold are collected in a review queue so nothing slips through.",
  },
  {
    q: "Which export formats are available?",
    a: "CSV, Excel (.xlsx) and JSON. Export a single batch or bulk-export several runs at once.",
  },
  {
    q: "Is my data kept private?",
    a: "Documents and extracted data are tied to your account only, and you can delete them at any time from Settings → Data & Privacy. Details are in our privacy policy.",
  },
];

export default function Home() {
  usePageTitle(
    "BrainHalf — AI Document Extraction for invoices, receipts & documents",
    { canonicalPath: "/", noindex: false }
  );
  const [activeTab, setActiveTab] = useState<
    "invoice" | "receipt" | "academic"
  >("invoice");

  const sampleData = {
    invoice: {
      title: "ACME Corp Invoice #INV-8902",
      vendor: "Acme Cloud Services",
      date: "Oct 24, 2026",
      total: "$1,450.00",
      confidence: "99.4%",
      fields: [
        { label: "Invoice Number", value: "INV-8902", status: "Verified" },
        {
          label: "Vendor Name",
          value: "Acme Cloud Services",
          status: "Verified",
        },
        { label: "Subtotal Amount", value: "$1,250.00", status: "Verified" },
        { label: "Tax (16%)", value: "$200.00", status: "Verified" },
        { label: "Total Due", value: "$1,450.00", status: "Verified" },
      ],
    },
    receipt: {
      title: "Blue Bottle Coffee Receipt",
      vendor: "Blue Bottle Roasters",
      date: "Nov 02, 2026",
      total: "$18.50",
      confidence: "98.8%",
      fields: [
        {
          label: "Merchant",
          value: "Blue Bottle Roasters",
          status: "Verified",
        },
        {
          label: "Payment Method",
          value: "Visa •••• 4242",
          status: "Verified",
        },
        {
          label: "Items",
          value: "2x Oat Latte + Croissant",
          status: "Verified",
        },
        { label: "Tip", value: "$3.00", status: "Verified" },
        { label: "Total Paid", value: "$18.50", status: "Verified" },
      ],
    },
    academic: {
      title: "Semester Transcript Marksheet",
      vendor: "Stanford University",
      date: "Jul 15, 2026",
      total: "GPA 3.92",
      confidence: "97.9%",
      fields: [
        { label: "Student Name", value: "Alex M. Johnson", status: "Verified" },
        { label: "Roll Number", value: "CS-2026-881", status: "Verified" },
        {
          label: "Subject Code",
          value: "CS340 Deep Learning",
          status: "Verified",
        },
        { label: "Marks Obtained", value: "96 / 100", status: "Verified" },
        { label: "Grade Result", value: "A+ (Pass)", status: "Verified" },
      ],
    },
  };

  const current = sampleData[activeTab];

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground overflow-hidden">
      <Navbar />

      <main className="flex-1">
        {/* Background ambient lighting */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] pointer-events-none -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsla(20,90%,60%,0.15),transparent_70%)]" />

        {/* Hero Section */}
        <section className="w-full py-16 md:py-24 lg:py-28 relative">
          <div className="container max-w-7xl mx-auto px-6 md:px-8">
            <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
              {/* Left Column: Headlines & Call to Actions */}
              <div className="lg:col-span-6 flex flex-col space-y-8 text-left">
                <div className="inline-flex items-center gap-2 self-start rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary shadow-sm">
                  <Sparkles className="h-3.5 w-3.5 animate-pulse" /> AI-Powered
                  Document Intelligence
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground leading-[1.1]">
                  Turn stacks of invoices into{" "}
                  <span className="text-primary underline decoration-primary/30 underline-offset-8">
                    structured data
                  </span>{" "}
                  in seconds.
                </h1>

                <p className="text-muted-foreground text-base sm:text-lg leading-relaxed max-w-xl font-medium">
                  Brainhalf automatically extracts fields, line items, and
                  totals from invoices, receipts, and transcripts. No templates
                  or manual box-drawing required.
                </p>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
                  <Button
                    asChild
                    size="lg"
                    className="h-13 px-8 rounded-2xl text-base font-bold shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 transition-all"
                  >
                    <Link href="/app/upload">
                      <Upload className="mr-2 h-5 w-5" /> Start Processing Free
                    </Link>
                  </Button>

                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-13 px-8 rounded-2xl text-base font-bold bg-card border-border/80 hover:bg-muted transition-all"
                  >
                    <Link href="/app">
                      Explore Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                {/* Trust Signals */}
                <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-4 text-xs font-semibold text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>No Credit Card Needed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Instant CSV / Excel Export</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Interactive Live Extraction Graphic */}
              <div className="lg:col-span-6">
                <div className="relative rounded-3xl border border-border/60 bg-card p-6 shadow-xl backdrop-blur-xl">
                  {/* Visual Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-4 border-b border-border/40">
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <div className="h-3 w-3 rounded-full bg-red-400/80" />
                      <div className="h-3 w-3 rounded-full bg-warning/80" />
                      <div className="h-3 w-3 rounded-full bg-emerald-400/80" />
                      <span className="ml-2 text-xs font-bold text-muted-foreground tracking-wide uppercase">
                        Live Extraction Preview
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 bg-muted p-1 rounded-xl text-xs font-semibold self-start sm:self-auto">
                      {(["invoice", "receipt", "academic"] as const).map(
                        (tab) => (
                          <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-3 py-1 rounded-lg capitalize transition-all ${
                              activeTab === tab
                                ? "bg-background text-foreground shadow-sm font-bold"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {tab}
                          </button>
                        ),
                      )}
                    </div>
                  </div>

                  {/* Document & Field Grid */}
                  <div className="grid sm:grid-cols-12 gap-4">
                    {/* Simulated Document Preview */}
                    <div className="sm:col-span-5 bg-muted/60 rounded-2xl p-4 border border-border/40 flex flex-col justify-between relative overflow-hidden group">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-primary">
                          <FileCheck className="h-4 w-4" />
                          <span className="truncate">{current.title}</span>
                        </div>
                        <div className="space-y-2 pt-2">
                          <div className="h-2.5 w-3/4 bg-foreground/20 rounded-full animate-pulse" />
                          <div className="h-2 w-full bg-foreground/10 rounded-full" />
                          <div className="h-2 w-5/6 bg-foreground/10 rounded-full" />
                          <div className="h-2 w-4/6 bg-foreground/10 rounded-full" />
                        </div>
                        <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/30 text-xs font-mono font-bold text-primary mt-4">
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
                          key={i}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-background border border-border/50 hover:border-primary/40 transition-colors shadow-xs gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider truncate">
                              {field.label}
                            </p>
                            <p className="text-xs font-semibold text-foreground font-mono mt-0.5 truncate">
                              {field.value}
                            </p>
                          </div>
                          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
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
                      <strong className="text-foreground">0.84s</strong> via
                      BH Model 1
                    </span>
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs font-bold text-primary hover:text-primary/80"
                    >
                      <Link href="/app/upload">
                        Try with your file{" "}
                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="w-full py-16 md:py-20">
          <div className="container max-w-7xl mx-auto px-6 md:px-8">
            <div className="text-center max-w-2xl mx-auto space-y-4 mb-12">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                From scan to spreadsheet in three steps
              </h2>
              <p className="text-muted-foreground text-base font-medium">
                No templates, no training data, no integration project.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  icon: Upload,
                  step: "Step 1",
                  title: "Upload your documents",
                  body: "Drag and drop JPG, PNG, WEBP or PDF files — up to 25 MB each. Process a single scan or a whole stack in one batch.",
                },
                {
                  icon: SlidersHorizontal,
                  step: "Step 2",
                  title: "Pick an extraction preset",
                  body: "Invoice, receipt, table, handwriting, full text or your own custom prompt. The engine returns structured fields with a confidence score for every value.",
                },
                {
                  icon: Download,
                  step: "Step 3",
                  title: "Review and export",
                  body: "Correct any field with a double-click, work through low-confidence documents in the review queue, then export clean CSV, Excel or JSON.",
                },
              ].map(({ icon: Icon, step, title, body }) => (
                <div
                  key={step}
                  className="rounded-3xl border border-border/60 bg-card p-8 shadow-sm space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      {step}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-foreground">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed font-medium">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature Bento Grid Section */}
        <section className="w-full py-20 bg-muted/30 border-t border-border/40">
          <div className="container max-w-7xl mx-auto px-6 md:px-8">
            <div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                Designed for speed, clarity, and human review.
              </h2>
              <p className="text-muted-foreground text-base font-medium">
                Everything you need to turn raw images and PDFs into pristine
                structured records.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="rounded-3xl border border-border/60 bg-card p-8 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                    <Smile className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">
                    Friendly by design
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed font-medium">
                    No complex regex or engineering setup required. Just drag,
                    drop, and let AI extract key fields automatically without
                    drawing manual bounding boxes.
                  </p>
                </div>
                <div className="pt-4 border-t border-border/40 flex items-center text-xs font-bold text-primary">
                  <span>Zero config needed</span>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="rounded-3xl border border-border/60 bg-card p-8 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">
                    Verify with a double-click
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed font-medium">
                    We highlight exactly where data was found on your document.
                    Double-click any field cell to edit or correct values
                    instantly right inside the browser.
                  </p>
                </div>
                <div className="pt-4 border-t border-border/40 flex items-center text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <span>Instant inline editor</span>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="rounded-3xl border border-border/60 bg-card p-8 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <div className="h-12 w-12 rounded-2xl bg-warning/10 text-warning flex items-center justify-center font-bold">
                    <Download className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground">
                    Export to CSV, Excel & JSON
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed font-medium">
                    Export single batches or bulk-export multiple document runs
                    to clean CSV, formatted Excel spreadsheets, or structured
                    JSON in one click.
                  </p>
                </div>
                <div className="pt-4 border-t border-border/40 flex items-center text-xs font-bold text-warning">
                  <span>Sanitized & injection-safe</span>
                </div>
              </div>
            </div>

            {/* FAQ */}
            <div className="mt-16">
              <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground text-center mb-10">
                Frequently asked questions
              </h3>
              <div className="grid md:grid-cols-2 gap-x-10 gap-y-8 max-w-4xl mx-auto">
                {FAQ_ITEMS.map((item) => (
                  <div key={item.q} className="space-y-2">
                    <h4 className="text-base font-bold text-foreground">
                      {item.q}
                    </h4>
                    <p className="text-sm text-muted-foreground leading-relaxed font-medium">
                      {item.a}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom CTA Card */}
            <div className="mt-16 rounded-3xl bg-gradient-to-r from-primary/10 via-warning/10 to-primary/5 border border-primary/20 p-8 sm:p-12 text-center space-y-6">
              <h3 className="text-2xl sm:text-3xl font-extrabold text-foreground">
                Ready to stop manually typing invoice data?
              </h3>
              <p className="text-muted-foreground max-w-xl mx-auto text-sm sm:text-base font-medium">
                Try Brainhalf right now in your browser. Upload sample receipts,
                test extraction schemas, and export clean data instantly.
              </p>
              <Button
                asChild
                size="lg"
                className="h-auto py-3.5 px-6 sm:px-8 rounded-2xl font-bold text-base shadow-lg shadow-primary/20 whitespace-normal text-center min-h-[52px]"
              >
                <Link href="/app/upload" className="flex items-center justify-center gap-2">
                  <span>Start Uploading Documents</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 bg-background py-12">
        <div className="container max-w-7xl mx-auto px-6 md:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="col-span-1 sm:col-span-2 space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
                  <FileText className="h-4 w-4" />
                </div>
                <span className="font-semibold text-xl tracking-tight">
                  brain<span className="text-primary font-bold">half</span>
                </span>
              </div>
              <p className="text-sm text-muted-foreground font-medium max-w-xs leading-relaxed">
                Automate your data entry workflows. Turn messy stacks of vendor
                receipts and invoices into clean, structured data instantly.
              </p>
            </div>
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-foreground tracking-wide uppercase">
                Product
              </h4>
              <ul className="space-y-3 text-sm font-medium text-muted-foreground">
                <li>
                  <Link
                    href="/app"
                    className="hover:text-primary transition-colors"
                  >
                    Dashboard
                  </Link>
                </li>
                <li>
                  <Link
                    href="/app/upload"
                    className="hover:text-primary transition-colors"
                  >
                    Extraction Engine
                  </Link>
                </li>
              </ul>
            </div>
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-foreground tracking-wide uppercase">
                Company
              </h4>
              <ul className="space-y-3 text-sm font-medium text-muted-foreground">
                <li>
                  <Link
                    href="/privacy"
                    className="hover:text-primary transition-colors"
                  >
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link
                    href="/terms"
                    className="hover:text-primary transition-colors"
                  >
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link
                    href="/contact"
                    className="hover:text-primary transition-colors"
                  >
                    Contact Us
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-border/40 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground font-medium">
            <span>© 2026 brainhalf. All rights reserved.</span>
            <span>AI document extraction for invoices, receipts & documents.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
