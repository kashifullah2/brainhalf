interface SectionHeadingProps {
  title: string;
  subtitle?: string;
}

/** Centered section intro shared by every marketing band. */
export function SectionHeading({ title, subtitle }: SectionHeadingProps) {
  return (
    <div className="mx-auto mb-12 max-w-2xl space-y-4 text-center">
      <h2 className="animate-fade-up text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {subtitle ? (
        <p
          className="animate-fade-up font-medium text-muted-foreground"
          style={{ animationDelay: "80ms" }}
        >
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
