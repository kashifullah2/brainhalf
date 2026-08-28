import type { ComponentType, ReactNode } from "react";
import { Plus } from "lucide-react";

interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: ReactNode;
  action?: ReactNode;
  inset?: boolean;
}

export function EmptyState({ icon: Icon, title, body, action, inset = false }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${inset ? "py-16" : "py-24"}`}>
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground shadow-sm">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mb-2 text-[15px] font-semibold text-foreground">{title}</h3>
      <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
