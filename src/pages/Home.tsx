import { Link } from "wouter";
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
  { value: "14/25 MB", label: "Max PDF / image size" },
  { value: "4", label: "Export formats" },
];

const STEPS = [
  {
    icon: Upload,
    step: "Step 1",
    title: "Upload your documents",
    body: "Drag and drop JPG, PNG, WEBP or PDF files — PDFs up to 14 MB, images up to 25 MB. Process a single scan or a whole stack in one batch.",
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
    tone: "success" as const,
    title: "Verify with a double-click",
    body: "Every value sits beside the page it came from, with a confidence score attached. Double-click any cell to correct it inline — your edit is kept separately, so the original reading stays auditable.",
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
    <div className="flex min-h-[calc(100dvh-var(--header-h))] flex-col bg-background text-foreground">
      <main id="main-content" className="flex-1">
        {/* Hero */}
        <section className="relative w-full overflow-hidden py-16 md:py-24 lg:py-28">
          {/* Soft ambient glow behind the hero — visible in both themes. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(1200px 600px at 70% 10%, hsl(var(--primary) / 0.12), transparent 60%), " +
                "radial-gradient(900px 500px at 20% 80%, hsl(var(--accent) / 0.35), transparent 55%)",
            }}
          />
          <div className="container mx-auto max-w-7xl px-6 md:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
              <div className="flex flex-col space-y-8 text-left lg:col-span-6">
                <div
                  className="animate-fade-up inline-flex items-center gap-2 self-start rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-caption font-semibold text-primary"
                  style={{ animationDelay: "0ms" }}
                >
                  <Sparkles className="h-3.5 w-3.5" /> AI-Powered Document
                  Intelligence
                </div>

                {/* One colour on the emphasis, not a three-stop gradient
                    clipped to the text: the gradient washed the middle of the
                    phrase out to near-invisible on the light canvas, and it was
                    the only gradient text in the product. */}
                <h1
                  className="animate-fade-up text-4xl font-semibold leading-[1.08] tracking-tight text-foreground sm:text-5xl lg:text-[3.5rem]"
                  style={{ animationDelay: "80ms" }}
                >
                  Turn stacks of invoices into{" "}
                  <span className="text-primary">structured data</span> in
                  seconds.
                </h1>

                <p
                  className="animate-fade-up max-w-xl text-body-lg leading-relaxed text-muted-foreground sm:text-body-xl"
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
                  <Button asChild size="lg" className="text-body font-semibold">
                    <Link href="/app/upload">
                      <Upload className="h-4 w-4" /> Start extracting — free
                    </Link>
                  </Button>

                  <Button
                    asChild
                    variant="secondary"
                    size="lg"
                    className="font-semibold"
                  >
                    <Link href="/sign-in">
                      I already have an account <ArrowRight className="h-4 w-4" />
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
              eyebrow="01 / how it works"
              title="From scan to spreadsheet in three steps"
              subtitle="No templates, no training data, no integration project."
            />

            <div className="grid gap-6 md:grid-cols-3">
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
              eyebrow="02 / what you get"
              title="Built for speed, clarity, and human review"
              subtitle="Everything you need to turn raw images and PDFs into pristine structured records."
            />

            <div className="grid gap-6 md:grid-cols-3">
              {FEATURES.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>

            <FaqSection />

            {/* A bordered panel on the page's own surface. This was a
                gradient slab with a 400px blurred orange disc floating over it
                — decoration that cost a compositing layer and said nothing. */}
            <div className="relative mt-16 overflow-hidden rounded-2xl border border-border bg-card p-8 text-center shadow-lg shadow-primary/5 sm:p-12">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/40 via-primary/80 to-primary/40"
              />
              <div className="relative z-10 space-y-5">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                  Ready to stop typing invoice data?
                </h2>
                <p className="mx-auto max-w-xl text-body text-muted-foreground">
                  Upload a receipt, pick a preset, and see what comes back. No card,
                  no setup, no sales call.
                </p>
                <Button asChild size="lg" className="text-body font-semibold">
                  <Link href="/app/upload">
                    Upload your first document
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
