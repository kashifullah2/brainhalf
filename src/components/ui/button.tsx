import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Hover and press states come from `.hover-elevate` / `.active-elevate-2`,
 * defined as custom utilities at the bottom of src/index.css — a translucent
 * state layer in the button's own text colour rather than a hover colour per
 * variant, so one rule covers filled, outline and ghost on the page, a card or
 * the sidebar, in either theme.
 *
 * The base radius is `rounded-lg`, which matches `--radius`. It was
 * `rounded-md`, and 105 call sites across the product passed `rounded-lg` to
 * override it — the default was simply the wrong one.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-body font-medium transition-colors' +
    ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background' +
    // 60, not 50: on the light canvas a disabled outline button at half
    // opacity was near-invisible rather than legibly unavailable.
    ' disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60' +
    ' [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0' +
    ' hover-elevate active-elevate-2',
  {
    variants: {
      variant: {
        default: 'border border-primary-border bg-primary text-primary-foreground',
        // `border-destructive-border` set a colour with no width class beside
        // it, so destructive buttons drew no border at all.
        destructive:
          'border border-destructive-border bg-destructive text-destructive-foreground shadow-sm',
        // Uses the theme border so the outline stays visible in both light and
        // dark modes. The previous fixed rgba() was nearly invisible on the
        // light canvas.
        outline: 'border border-border shadow-xs active:shadow-none',
        secondary: 'border border-secondary-border bg-secondary text-secondary-foreground',
        // Transparent border keeps ghost buttons on the same optical size as
        // their bordered siblings, so a toolbar does not jog by 2px.
        ghost: 'border border-transparent',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-9 px-4 py-2',
        sm: 'min-h-8 px-3 text-label',
        lg: 'min-h-10 px-6',
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
