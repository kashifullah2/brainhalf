import { Check } from "lucide-react";

interface FeatureCardProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** Which accent the icon tile and footer line carry. */
  tone?: "primary" | "success" | "warning";
  footer: string;
}

/**
 * `emerald` used to be one of these tones, spelled as raw
 * `bg-emerald-500/10 text-emerald-600 dark:text-emerald-400` — a cool green in
 * a warm palette, and the only place in the product that named a Tailwind
 * colour instead of a token. It is the `success` token now, which is the same
 * green the status badges and confidence meters already use.
 */
const TONES = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
} as const;

/** A feature: what it does, in a sentence, with the claim it supports. */
export function FeatureCard({
  icon: Icon,
  title,
  body,
  tone = "primary",
  footer,
}: FeatureCardProps) {
  return (
    <div className="group flex h-full flex-col justify-between gap-6 rounded-2xl border border-border bg-card p-7 shadow-sm transition-shadow duration-300 hover:shadow-md">
      <div className="space-y-5">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/5 ${TONES[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="text-body-xl font-semibold text-foreground">{title}</h3>
        <p className="text-body-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
      <p className="flex items-center gap-1.5 border-t border-border/50 pt-4 text-caption font-semibold text-muted-foreground">
        <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        {footer}
      </p>
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

/**
 * One step of the explainer.
 *
 * The lift-on-hover and the icon that scaled to 110% are gone: three cards that
 * are not clickable should not behave like buttons, and the movement was the
 * loudest thing on a page whose job is to explain a sequence. The step label
 * was `uppercase tracking-widest`, which the rest of the product stopped doing.
 */
export function StepCard({
  icon: Icon,
  step,
  title,
  body,
  index = 0,
}: StepCardProps) {
  return (
    <div
      className="group animate-fade-up relative space-y-5 overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-sm transition-shadow duration-300 hover:shadow-md"
      style={{ animationDelay: `${index * 100}ms`, animationFillMode: "both" }}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/40" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/10">
          <Icon className="h-5 w-5" />
        </div>
        <span className="font-data text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {step}
        </span>
      </div>
      <h3 className="text-body-xl font-semibold text-foreground">{title}</h3>
      <p className="text-body-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

export function TrustSignals({ items }: { items: string[] }) {
  return (
    <ul
      className="animate-fade-up flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-caption font-semibold text-muted-foreground"
      style={{ animationDelay: "320ms" }}
    >
      {items.map((text) => (
        <li key={text} className="flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
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
    <dl className="relative grid grid-cols-2 divide-border/40 overflow-hidden rounded-2xl border border-border bg-card shadow-lg shadow-primary/5 sm:grid-cols-4 sm:divide-x">
      {/* Subtle warm top highlight for depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"
      />
      {stats.map((stat, i) => (
        /* flex-col is what makes the `order` below mean anything. Without it
           these were block children, `order` was inert, and every cell rendered
           its label above its number — the reverse of the intent. */
        <div
          key={stat.label}
          className="animate-fade-up relative flex flex-col px-4 py-6 text-center"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <dd className="order-1 font-data text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {stat.value}
          </dd>
          <dt className="order-2 mt-1.5 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {stat.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}
