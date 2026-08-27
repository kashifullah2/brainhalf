import { CheckCircle2 } from "lucide-react";

interface FeatureCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** Tailwind color token driving icon tile + footer accent, e.g. "primary". */
  tone?: "primary" | "emerald" | "warning";
  footer: string;
}

const TONES = {
  primary: {
    tile: "bg-primary/10 text-primary",
    footer: "text-primary",
  },
  emerald: {
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    footer: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    tile: "bg-warning/10 text-warning",
    footer: "text-warning",
  },
} as const;

/** Bento feature card with an icon tile and a hairline-separated footer strip. */
export function FeatureCard({
  icon: Icon,
  title,
  body,
  tone = "primary",
  footer,
}: FeatureCardProps) {
  const t = TONES[tone];
  return (
    <div className="flex h-full flex-col justify-between space-y-6 rounded-3xl border border-border/60 bg-card p-8 shadow-sm transition-all hover:shadow-md">
      <div className="space-y-4">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl font-bold ${t.tile}`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="text-xl font-bold text-foreground">{title}</h3>
        <p className="font-medium text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
      <div className="flex items-center border-t border-border/40 pt-4 text-xs font-bold">
        <span className={t.footer}>{footer}</span>
      </div>
    </div>
  );
}

interface StepCardProps {
  icon: React.ComponentType<{ className?: string }>;
  step: string;
  title: string;
  body: string;
  /** Position in the row, used only to stagger the entrance animation. */
  index?: number;
}

/** How-it-works step card: numbered step label, lift-on-hover, icon zoom. */
export function StepCard({
  icon: Icon,
  step,
  title,
  body,
  index = 0,
}: StepCardProps) {
  return (
    <div
      className="group animate-fade-up space-y-4 rounded-3xl border border-border/60 bg-card p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-md"
      style={{
        animationDelay: `${index * 100}ms`,
        animationFillMode: "both",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
          <Icon className="h-6 w-6" />
        </div>
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {step}
        </span>
      </div>
      <h3 className="text-xl font-bold text-foreground">{title}</h3>
      <p className="text-sm font-medium leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

export function TrustSignals({ items }: { items: string[] }) {
  return (
    <ul
      className="animate-fade-up flex flex-wrap items-center gap-4 pt-4 text-xs font-semibold text-muted-foreground sm:gap-6"
      style={{ animationDelay: "320ms" }}
    >
      {items.map((text) => (
        <li key={text} className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

interface Stat {
  value: string;
  label: string;
}

/** Compact metric strip used between the hero and the explainer sections. */
export function StatsBand({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 divide-border/50 rounded-3xl border border-border/60 bg-card/60 p-2 shadow-sm backdrop-blur sm:grid-cols-4 sm:divide-x">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className="animate-fade-up px-4 py-5 text-center"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <dt className="order-2 mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {stat.label}
          </dt>
          <dd className="order-1 font-mono text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
