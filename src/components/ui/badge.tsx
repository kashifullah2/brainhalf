import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Badges in this product are informational — a batch number, a status, a
 * confidence score, an "Owner" role. None of them are clickable, so the base
 * class deliberately carries no `hover-elevate`: a pill that lights up under
 * the cursor but does nothing when clicked is a false affordance.
 *
 * The four tinted variants exist so pages stop hand-rolling
 * `bg-amber-500/10 text-amber-600 dark:text-amber-500` per call site.
 */
const badgeVariants = cva(
  'whitespace-nowrap inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-label font-semibold transition-colors' +
    ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow-xs',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground shadow-xs',
        outline: 'text-foreground border [border-color:var(--badge-outline)]',
        success: 'border-success/25 bg-success/12 text-success',
        warning: 'border-warning/30 bg-warning/12 text-warning',
        danger: 'border-destructive/30 bg-destructive/12 text-destructive',
        neutral: 'border-border bg-muted text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
