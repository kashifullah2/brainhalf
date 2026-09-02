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

      {/* Background Ambient Glows & Video Motion Graphics */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <video 
          autoPlay 
          loop 
          muted 
          playsInline 
          className="absolute inset-0 w-full h-full object-cover opacity-15 mix-blend-screen"
        >
          <source src="/motion-hero.mp4" type="video/mp4" />
        </video>
        <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-[120px] animate-glow" />
        <div className="absolute bottom-0 right-0 h-[500px] w-[500px] translate-x-1/3 translate-y-1/3 rounded-full bg-primary/5 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{ backgroundImage: "url('data:image/svg+xml,%3Csvg width=\\'60\\' height=\\'60\\' viewBox=\\'0 0 60 60\\' xmlns=\\'http://www.w3.org/2000/svg\\'%3E%3Cg fill=\\'none\\' fill-rule=\\'evenodd\\'%3E%3Cg fill=\\'%23ffffff\\' fill-opacity=\\'1\\'%3E%3Cpath d=\\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')" }}
        />
      </div>

      <main id="main-content" className="relative z-10 flex-1">

        {/* ===== HERO SECTION ===== */}
        <section className="relative w-full px-6 pt-24 pb-32 md:px-12 md:pt-36">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col items-center text-center">

              {/* Animated Status Pill */}
              <div className="mb-10 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-medium text-primary backdrop-blur-md">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
                </span>
                Document Intelligence Engine
              </div>

              {/* Massive Hero Typography */}
              <h1 className="text-balance text-6xl font-extrabold tracking-tighter sm:text-7xl lg:text-[6rem] lg:leading-[0.95]">
                Messy paper <span className="text-muted-foreground">in.</span><br />
                Pristine data <span className="text-primary">out.</span>
              </h1>

              <p className="mt-8 max-w-2xl text-balance text-lg font-medium text-muted-foreground sm:text-xl">
                Transform raw invoices, receipts, and chaotic PDFs into perfectly structured CSV and JSON files. Zero templates. Zero manual configuration.
              </p>

              {/* High-Contrast CTA Buttons */}
              <div className="mt-12 flex flex-col items-center gap-6 sm:flex-row">
                <Button asChild size="lg" className="h-14 rounded-full bg-primary px-10 text-base font-bold text-background transition-transform hover:scale-105 hover:bg-primary/90">
                  <Link href="/app/upload">
                    Start extracting
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <div className="flex items-center gap-6 text-sm font-medium text-muted-foreground">
                  <TrustSignals items={TRUST} />
                </div>
              </div>

              {/* Document Type Pills */}
              <div className="mt-16 flex flex-wrap justify-center gap-3">
                {DOC_TYPES.map(({ icon: Icon, label }) => (
                  <div key={label} className="glass-panel flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/30">
                    <Icon className="h-4 w-4 text-primary" />
                    {label}
                  </div>
                ))}
              </div>
            </div>

            {/* Hero Preview - Floating Glass Interface with Motion */}
            <div className="mx-auto mt-20 max-w-5xl perspective-1000">
              <div className="glass-panel relative overflow-hidden rounded-[2.5rem] p-3 shadow-2xl transition-transform duration-700 hover:rotate-x-2 animate-float">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-50 animate-glow" />
                <div className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-background">
                  <HeroPreview />
                </div>
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
                  {/* Subtle hover glow */}
                  <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/20 blur-[100px] transition-transform duration-700 group-hover:scale-150" />

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

              {/* Massive Bold Callout Card with Motion Graphic */}
              <div className="col-span-1 overflow-hidden rounded-[2.5rem] bg-primary/5 border border-primary/20 p-10 md:col-span-12 md:p-16 relative">
                <div className="absolute inset-0 bg-[url('/document-transformation.png')] bg-cover bg-center opacity-30 mix-blend-lighten motion-safe:animate-pulse" />
                <div className="relative z-10 flex flex-col items-start justify-between gap-10 md:flex-row md:items-center">
                  <div className="flex items-center gap-8">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-background text-primary shadow-2xl">
                      <ShieldCheck className="h-10 w-10" />
                    </div>
                    <div>
                      <h3 className="text-3xl font-bold tracking-tight text-background sm:text-4xl">
                        Sanitized, Safe Exports
                      </h3>
                      <p className="mt-3 max-w-xl text-background/80 md:text-lg font-medium">
                        CSV, Excel, and JSON are strictly typed. We clean the data on the way out so it's ready for immediate database ingestion.
                      </p>
                    </div>
                  </div>
                  <Button asChild size="lg" variant="secondary" className="h-16 shrink-0 rounded-full px-10 text-lg font-bold transition-transform hover:scale-105">
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
              <h2 className="mb-10 text-3xl font-bold tracking-tight text-foreground">System Queries</h2>
              <FaqSection />
            </div>

            {/* Neon Command CTA */}
            <div className="relative flex flex-col justify-center overflow-hidden rounded-[2.5rem] bg-card p-10 shadow-2xl shadow-primary/5 border border-border/50 md:p-16">
              <div className="absolute inset-0 bg-gradient-to-b from-primary/10 to-transparent opacity-50" />
              <div className="absolute -top-px left-20 right-20 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />

              <div className="relative z-10">
                <div className="mb-6 flex items-center gap-2 text-sm font-mono font-bold text-primary">
                  <CheckCircle2 className="h-5 w-5" />
                  READY_FOR_UPLOAD
                </div>
                <h2 className="text-5xl font-extrabold tracking-tighter text-foreground sm:text-6xl">
                  Stop typing.<br />Start extracting.
                </h2>
                <p className="mt-6 text-lg font-medium text-muted-foreground">
                  Upload a receipt, pick a preset, and see what comes back. No card, no setup, no sales call.
                </p>

                <div className="mt-12 flex items-center gap-4 rounded-full border border-border/50 bg-foreground/5 p-2 backdrop-blur-md">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div className="flex-1 font-mono text-sm text-muted-foreground pl-2 hidden sm:block">
                    Drop document here...
                  </div>
                  <Button asChild size="lg" className="h-14 shrink-0 rounded-full bg-primary px-8 font-bold text-background hover:bg-primary/90 w-full sm:w-auto">
                    <Link href="/app/upload">
                      Execute <ArrowRight className="ml-2 h-5 w-5" />
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