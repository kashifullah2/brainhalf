import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // text-base on mobile is deliberate: anything under 16px makes iOS Safari
          // zoom the viewport on focus. Narrows to the body step from md up.
          'flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors md:text-body' +
            ' file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground' +
            ' placeholder:text-muted-foreground' +
            ' focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background' +
            // A disabled field must look locked, not merely faint. Fading the
            // whole control is what made Settings > Organization look broken:
            // a real email address at 60% opacity is indistinguishable from
            // placeholder text, so the field read as empty. The lock is carried
            // by the border and the filled background instead, and the value
            // stays at full strength so it is legible as a value.
            ' disabled:cursor-not-allowed disabled:border-border disabled:bg-muted' +
            ' disabled:text-foreground disabled:shadow-none',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
