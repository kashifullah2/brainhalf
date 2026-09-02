import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/lib/use-page-title";
import { FaqSection, HeroPreview, SiteFooter, TrustSignals } from "@/components/marketing";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileText,
  Gauge,
  Layers,
  Lock,
  Receipt,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  Upload,
  Zap,
} from "lucide-react";

const STATS = [
  { value: "0", label: "Templates" },
  { value: "100%", label: "Verifiable" },
  { value: "25MB", label: "Max File" },
  { value: "JSON", label: "Ready" },
];

const WORKFLOW_STEPS = [
  {
    icon: Upload,
    title: "Drop Documents",
    body: "Upload a single PDF or a massive batch of messy JPEGs. The engine accepts it all instantly.",
  },
  {
    icon: SlidersHorizontal,
    title: "AI Analysis",
    body: "No templates needed. Neural models identify fields, extract values, and assign confidence scores.",
  },
  {
    icon: Download,
    title: "Export Clean Data",
    body: "Double-check flagged fields in seconds, then export to pristine, injection-safe CSV or JSON.",
  },
];

const BENTO_FEATURES = [
  {
    icon: Zap,
    title: "Zero-Config Extraction",
    body: "Forget bounding boxes and regex. Just drop a file and watch the data structure itself.",
    span: "md:col-span-8",
  },
  {
    icon: Gauge,
    title: "Confidence Scored",
    body: "Every value is graded. Blurry text surfaces for human review automatically.",
    span: "md:col-span-4",
  },
  {
    icon: Lock,
    title: "Auditable Edits",
    body: "Corrections are stored securely. The original AI reading is never overwritten.",
    span: "md:col-span-4",
  },
  {
    icon: Layers,
    title: "Batch-First Workflow",
    body: "Run dozens of documents through a preset and clear the entire queue in one pass.",
    span: "md:col-span-8",
  },
];

const DOC_TYPES = [
  { icon: Receipt, label: "Receipts" },
  { icon: FileText, label: "Invoices" },
  { icon: Table2, label: "Tables" },
];

const TRUST = ["No Credit Card", "Instant Export"];

export default function Home() {
  usePageTitle("BrainHalf — AI Document Extraction", { canonicalPath: "/", noindex: false });

  return (
    <div className="flex min-h-[calc(100dvh-var(--header-h))] flex-col bg-background overflow-hidden">

      {/* Dynamic Glow Backgrounds */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] h-[70%] w-[50%] rounded-full bg-primary/10 blur-[120px] opacity-70 animate-pulse" />
        <div className="absolute top-[10%] -right-[10%] h-[60%] w-[40%] rounded-full bg-blue-500/10 blur-[120px] opacity-50" />
      </div>

      <main id="main-content" className="relative z-10 flex-1">

        {/* ===== HERO SECTION ===== */}
        <section className="relative w-full px-6 pt-24 pb-20 md:px-12 md:pt-32 lg:pt-40 lg:pb-32">
          <div className="mx-auto max-w-7xl">
            <div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:gap-8 items-center">
              
              {/* Left Column: Copy & CTA */}
              <div className="flex flex-col items-start text-left">
                {/* Animated Status Pill */}
                <div className="group mb-8 inline-flex items-center gap-3 rounded-full border border-primary/30 bg-background/50 px-5 py-2 text-sm font-semibold text-primary shadow-sm backdrop-blur-md transition-all hover:bg-primary/10 hover:border-primary/50">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary"></span>
                  </span>
                  <span>Next-Gen Extraction Engine</span>
                </div>

                {/* Massive Hero Typography */}
                <h1 className="text-balance text-5xl font-extrabold tracking-tight sm:text-6xl lg:text-7xl lg:leading-[1.1]">
                  Turn chaotic documents into
                  <span className="block mt-2 bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent drop-shadow-sm">
                    structured data.
                  </span>
                </h1>

                <p className="mt-8 max-w-xl text-balance text-lg font-medium text-muted-foreground leading-relaxed sm:text-xl">
                  Instantly transform raw invoices, receipts, and messy PDFs into verifiable CSV and JSON. Powered by vision-language models — zero templates required.
                </p>

                {/* CTA Buttons */}
                <div className="mt-10 flex flex-col sm:flex-row items-start sm:items-center gap-5 w-full sm:w-auto">
                  <Button asChild size="lg" className="group h-14 rounded-xl bg-primary px-8 text-base font-bold text-background shadow-lg shadow-primary/25 transition-all hover:translate-y-[-2px] hover:bg-primary/90 w-full sm:w-auto">
                    <Link href="/app/upload">
                      Start extracting free
                      <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="h-14 rounded-xl px-8 text-base font-semibold border-border/80 bg-background/50 backdrop-blur-md hover:bg-muted w-full sm:w-auto">
                    <Link href="#features">
                      See how it works
                    </Link>
                  </Button>
                </div>

                {/* Trust Signals & Document Types */}
                <div className="mt-10 flex flex-col gap-5 border-t border-border/50 pt-8 w-full max-w-md">
                  <div className="flex items-center gap-6 text-sm font-medium text-muted-foreground">
                    <TrustSignals items={TRUST} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {DOC_TYPES.map(({ icon: Icon, label }) => (
                      <div key={label} className="flex items-center gap-1.5 rounded-md bg-muted/50 px-3 py-1.5 text-xs font-semibold text-foreground/80 border border-border/40">
                        <Icon className="h-3.5 w-3.5 text-primary/80" />
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right Column: Hero Preview Dashboard */}
              <div className="relative w-full lg:w-[120%] lg:-mr-[20%] xl:w-[130%] xl:-mr-[30%]">
                <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl shadow-primary/10 transition-transform duration-700 hover:scale-[1.02]">
                  {/* Decorative window controls */}
                  <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-4 py-3 backdrop-blur-md">
                    <div className="h-3 w-3 rounded-full bg-red-400/80" />
                    <div className="h-3 w-3 rounded-full bg-yellow-400/80" />
                    <div className="h-3 w-3 rounded-full bg-green-400/80" />
                  </div>
                  <HeroPreview />
                </div>
                
                {/* Decorative Elements around Preview */}
                <div className="absolute -bottom-6 -left-6 h-32 w-32 rounded-full bg-primary/20 blur-3xl -z-10" />
                <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-blue-500/20 blur-3xl -z-10" />
              </div>
            </div>

            {/* Inline Floating Stats */}
            <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label} className="glass-panel flex flex-col items-center justify-center rounded-3xl p-6 text-center transition-colors hover:border-primary/30">
                  <span className="text-3xl font-black text-foreground">{stat.value}</span>
                  <span className="mt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== WORKFLOW SECTION ===== */}
        <section className="relative w-full px-6 py-24 md:px-12 md:py-32">
          <div className="mx-auto max-w-7xl">
            <div className="mb-20 text-center">
              <h2 className="text-4xl font-extrabold tracking-tighter text-foreground sm:text-5xl">
                The Processing Pipeline.
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">Three steps from raw pixels to structured logic.</p>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              {WORKFLOW_STEPS.map(({ icon: Icon, title, body }, idx) => (
                <div key={title} className="glass-panel relative flex flex-col rounded-[2.5rem] p-10 transition-transform duration-500 hover:-translate-y-2 hover:border-primary/50">
                  <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary">
                    <Icon className="h-10 w-10" />
                  </div>
                  <div className="absolute right-10 top-10 text-6xl font-black text-foreground/[0.08]">
                    0{idx + 1}
                  </div>
                  <h3 className="mb-4 text-2xl font-bold text-foreground">{title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ===== BENTO FEATURE GRID ===== */}
        <section className="relative w-full px-6 py-24 md:px-12">
          <div className="mx-auto max-w-7xl">
            <div className="mb-16">
              <h2 className="text-4xl font-extrabold tracking-tighter text-foreground sm:text-5xl">
                Engineered for speed.
              </h2>
              <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
                We eliminated configuration so you can focus entirely on data verification and export.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
              {BENTO_FEATURES.map(({ icon: Icon, title, body, span }) => (
                <div key={title} className={`glass-panel group relative overflow-hidden rounded-[2.5rem] p-10 transition-all duration-500 hover:border-primary/50 ${span} min-h-[320px]`}>
                  <div className="relative z-10 flex h-full flex-col">
                    <div className="mb-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-foreground/[0.02] border border-border/50 text-primary shadow-inner">
                      <Icon className="h-8 w-8" />
                    </div>
                    <div className="mt-8">
                      <h3 className="mb-3 text-3xl font-bold tracking-tight text-foreground">{title}</h3>
                      <p className="max-w-md text-muted-foreground leading-relaxed md:text-lg">{body}</p>
                    </div>
                  </div>
                </div>
              ))}

              {/* Massive Bold Callout Card */}
              <div className="col-span-1 overflow-hidden rounded-[2.5rem] bg-primary/5 border border-primary/20 p-10 md:col-span-12 md:p-16 relative">
                <div className="relative z-10 flex flex-col items-start justify-between gap-10 md:flex-row md:items-center">
                  <div className="flex items-center gap-8">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-2xl">
                      <ShieldCheck className="h-10 w-10" />
                    </div>
                    <div>
                      <h3 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                        Sanitized, Safe Exports
                      </h3>
                      <p className="mt-3 max-w-xl text-muted-foreground md:text-lg font-medium">
                        CSV, Excel, and JSON are strictly typed. We clean the data on the way out so it's ready for immediate database ingestion.
                      </p>
                    </div>
                  </div>
                  <Button asChild size="lg" className="h-16 shrink-0 rounded-full bg-foreground text-background px-10 text-lg font-bold transition-transform hover:scale-105">
                    <Link href="/app/upload">
                      Try an export <ArrowUpRight className="ml-2 h-6 w-6" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== FAQ & FINAL CTA ===== */}
        <section className="relative w-full px-6 py-24 md:px-12 md:py-32">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:gap-16">

            {/* Minimal FAQ */}
            <div className="glass-panel rounded-[2.5rem] p-8 md:p-12">
              <FaqSection />
            </div>

            {/* Minimalist Command CTA */}
            <div className="relative flex flex-col justify-center overflow-hidden rounded-[2.5rem] bg-card p-10 shadow-xl border border-border/50 md:p-16">
              <div className="relative z-10 text-center">
                <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-mono font-bold text-primary backdrop-blur-md">
                  <CheckCircle2 className="h-4 w-4" />
                  READY_FOR_UPLOAD
                </div>
                <h2 className="text-balance text-5xl font-extrabold tracking-tighter text-foreground sm:text-6xl">
                  Stop typing.<br />Start extracting.
                </h2>
                <p className="mx-auto mt-6 max-w-xl text-lg font-medium text-muted-foreground">
                  Upload a receipt, pick a preset, and see what comes back. No credit card required. No complex setup.
                </p>

                <div className="mx-auto mt-12 flex max-w-md items-center gap-4 rounded-2xl border border-border/50 bg-background/50 p-2 shadow-lg backdrop-blur-xl">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 text-left font-mono text-sm text-muted-foreground pl-2 hidden sm:block">
                    Drop document here...
                  </div>
                  <Button asChild size="lg" className="h-12 shrink-0 rounded-xl bg-primary px-8 font-bold text-primary-foreground transition-all hover:bg-primary/90 hover:scale-105 hover:shadow-[0_0_20px_rgba(79,70,229,0.4)] w-full sm:w-auto">
                    <Link href="/app/upload">
                      Execute <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

          </div>
        </section>
      </main>

      <div className="border-t border-border/60 bg-background/80 backdrop-blur-3xl">
        <SiteFooter />
      </div>
    </div>
  );
}