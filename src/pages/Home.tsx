import { Link } from "wouter";
import { Navbar } from "@/components/layout/Navbar";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/use-page-title";
import {
  FaqSection,
  FeatureCard,
  HeroPreview,
  SectionHeading,
  SiteFooter,
  StatsBand,
  StepCard,
  TrustSignals,
} from "@/components/marketing";
import {
  ArrowRight,
  Download,
  ShieldCheck,
  Smile,
  Sparkles,
  SlidersHorizontal,
  Upload,
} from "lucide-react";

// Everything static lives at module scope: the page then renders without
// rebuilding a single array, and nothing here can go stale between renders.
const STATS = [
  { value: "Zero", label: "Templates needed" },
  { value: "100%", label: "Human verifiable" },
  { value: "25 MB", label: "Max file size" },
  { value: "3", label: "Export formats" },
];

const STEPS = [
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
];

const FEATURES = [
  {
    icon: Smile,
    tone: "primary" as const,
    title: "Friendly by design",
    body: "No complex regex or engineering setup required. Just drag, drop, and let AI extract key fields automatically without drawing manual bounding boxes.",
    footer: "Zero config needed",
  },
  {
    icon: ShieldCheck,
    tone: "emerald" as const,
    title: "Verify with a double-click",
    body: "We highlight exactly where data was found on your document. Double-click any field cell to edit or correct values instantly right inside the browser.",
    footer: "Instant inline editor",
  },
  {
    icon: Download,
    tone: "warning" as const,
    title: "Export to CSV, Excel & JSON",
    body: "Export single batches or bulk-export multiple document runs to clean CSV, formatted Excel spreadsheets, or structured JSON in one click.",
    footer: "Sanitized & injection-safe",
  },
];

const TRUST = ["No Credit Card Needed", "Instant CSV / Excel Export"];

export default function Home() {
  usePageTitle(
    "BrainHalf — AI Document Extraction for invoices, receipts & documents",
    { canonicalPath: "/", noindex: false }
  );

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <Navbar />

      <main className="flex-1">
        {/* Background ambient lighting */}
        <div className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[600px] w-full max-w-7xl -translate-x-1/2 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,hsla(20,90%,60%,0.15),transparent_70%)]" />

        {/* Hero */}
        <section className="relative w-full py-16 md:py-24 lg:py-28">
          <div className="container mx-auto max-w-7xl px-6 md:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
              <div className="flex flex-col space-y-8 text-left lg:col-span-6">
                <div
                  className="animate-fade-up inline-flex items-center gap-2 self-start rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-bold text-primary shadow-sm"
                  style={{ animationDelay: "0ms" }}
                >
                  <Sparkles className="h-3.5 w-3.5" /> AI-Powered Document
                  Intelligence
                </div>

                <h1
                  className="animate-fade-up text-4xl font-extrabold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[3.6rem]"
                  style={{ animationDelay: "80ms" }}
                >
                  Turn stacks of invoices into{" "}
                  <span className="bg-gradient-to-r from-primary via-warning to-primary bg-clip-text text-transparent">
                    structured data
                  </span>{" "}
                  in seconds.
                </h1>

                <p
                  className="animate-fade-up max-w-xl text-base font-medium leading-relaxed text-muted-foreground sm:text-lg"
                  style={{ animationDelay: "160ms" }}
                >
                  Brainhalf automatically extracts fields, line items, and
                  totals from invoices, receipts, and transcripts. No templates
                  or manual box-drawing required.
                </p>

                <div
                  className="animate-fade-up flex flex-col items-stretch gap-4 pt-2 sm:flex-row sm:items-center"
                  style={{ animationDelay: "240ms" }}
                >
                  <Button
                    asChild
                    size="lg"
                    className="h-13 rounded-2xl px-8 text-base font-bold shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/35"
                  >
                    <Link href="/app/upload">
                      <Upload className="mr-2 h-5 w-5" /> Start Processing Free
                    </Link>
                  </Button>

                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-13 rounded-2xl border-border/80 bg-card px-8 text-base font-bold transition-all hover:bg-muted"
                  >
                    <Link href="/app">
                      Explore Dashboard <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>

                <TrustSignals items={TRUST} />
              </div>

              <div
                className="animate-fade-up lg:col-span-6"
                style={{ animationDelay: "200ms" }}
              >
                <HeroPreview />
              </div>
            </div>

            <div className="mt-16">
              <StatsBand stats={STATS} />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="w-full scroll-mt-24 py-16 md:py-20">
          <div className="container mx-auto max-w-7xl px-6 md:px-8">
            <SectionHeading
              title="From scan to spreadsheet in three steps"
              subtitle="No templates, no training data, no integration project."
            />

            <div className="relative grid gap-8 md:grid-cols-3">
              {/* Connector behind the icon row — visible only in the gaps
                  between the (opaque) cards, so the steps read as a sequence. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-8 top-[4.25rem] -z-10 hidden h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent md:block"
              />
              {STEPS.map((step, i) => (
                <StepCard key={step.step} index={i} {...step} />
              ))}
            </div>
          </div>
        </section>

        {/* Features, FAQ, closing CTA */}
        <section className="w-full border-t border-border/40 bg-muted/30 py-20">
          <div className="container mx-auto max-w-7xl px-6 md:px-8">
            <SectionHeading
              title="Designed for speed, clarity, and human review."
              subtitle="Everything you need to turn raw images and PDFs into pristine structured records."
            />

            <div className="grid gap-8 md:grid-cols-3">
              {FEATURES.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>

            <FaqSection />

            <div className="relative mt-16 space-y-6 overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 via-warning/10 to-primary/5 p-8 text-center sm:p-12">
              <div className="pointer-events-none absolute -top-24 left-1/2 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-primary/15 blur-[100px]" />
              <h3 className="relative text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                Ready to stop manually typing invoice data?
              </h3>
              <p className="relative mx-auto max-w-xl text-sm font-medium text-muted-foreground sm:text-base">
                Try Brainhalf right now in your browser. Upload sample receipts,
                test extraction schemas, and export clean data instantly.
              </p>
              <Button
                asChild
                size="lg"
                className="relative h-auto min-h-[52px] whitespace-normal rounded-2xl px-6 py-3.5 text-center text-base font-bold shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/35 sm:px-8"
              >
                <Link
                  href="/app/upload"
                  className="flex items-center justify-center gap-2"
                >
                  <span>Start Uploading Documents</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
