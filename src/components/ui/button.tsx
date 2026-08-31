import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Premium "Pro" Button System:
 * - Micro-elevations on hover with inset top light-refraction highlights
 * - Vibrant gradient accents for high-impact visual depth
 * - Active press scale feedback
 * - Modern pill geometry with crisp typography
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-body-sm font-semibold transition-all duration-200 ease-out' +
    ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background' +
    ' disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50' +
    ' [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0' +
    ' active:scale-[0.98] active:translate-y-0',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-primary via-primary/95 to-indigo-600 dark:from-primary dark:via-primary dark:to-indigo-500 text-primary-foreground border border-primary-border/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_2px_8px_-1px_rgba(37,99,235,0.35)] hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),0_6px_20px_-3px_rgba(37,99,235,0.45)] hover:-translate-y-0.5',
        destructive:
          'bg-gradient-to-r from-destructive to-rose-600 text-destructive-foreground border border-destructive-border/40 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_2px_8px_-1px_rgba(225,29,72,0.35)] hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),0_6px_20px_-3px_rgba(225,29,72,0.45)] hover:-translate-y-0.5',
        outline:
          'border border-border/80 bg-background/90 text-foreground shadow-xs hover:bg-accent/80 hover:text-accent-foreground hover:border-primary/40 hover:shadow-sm hover:-translate-y-0.5',
        secondary:
          'border border-secondary-border/70 bg-secondary/80 text-secondary-foreground shadow-xs hover:bg-secondary hover:text-foreground hover:border-secondary-border hover:shadow-sm hover:-translate-y-0.5',
        ghost:
          'border border-transparent text-foreground/80 hover:bg-accent/70 hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline font-semibold',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-8 px-3.5 text-label',
        lg: 'h-12 px-7 text-body font-bold',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
