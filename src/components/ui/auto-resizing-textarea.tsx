import React, { useEffect, useRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";

interface AutoResizingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
  maxRows?: number;
}

export const AutoResizingTextarea = React.forwardRef<HTMLTextAreaElement, AutoResizingTextareaProps>(
  ({ className, value, minRows = 1, maxRows = 12, onChange, ...props }, ref) => {
    const internalRef = useRef<HTMLTextAreaElement | null>(null);

    useImperativeHandle(ref, () => internalRef.current!, []);

    const adjustHeight = () => {
      const textarea = internalRef.current;
      if (!textarea) return;

      textarea.style.height = "auto";

      let lineHeight = 20;
      let paddingTop = 8;
      let paddingBottom = 8;

      try {
        const computed = window.getComputedStyle(textarea);
        const parsedLH = parseFloat(computed.lineHeight);
        if (!Number.isNaN(parsedLH) && parsedLH > 5) {
          lineHeight = parsedLH;
        } else {
          const parsedFS = parseFloat(computed.fontSize);
          if (!Number.isNaN(parsedFS) && parsedFS > 5) {
            lineHeight = parsedFS * 1.4;
          }
        }

        const parsedPT = parseFloat(computed.paddingTop);
        if (!Number.isNaN(parsedPT)) paddingTop = parsedPT;

        const parsedPB = parseFloat(computed.paddingBottom);
        if (!Number.isNaN(parsedPB)) paddingBottom = parsedPB;
      } catch {
        // Fallback to defaults
      }

      const minHeight = minRows * lineHeight + paddingTop + paddingBottom;
      const maxHeight = maxRows * lineHeight + paddingTop + paddingBottom;

      const scrollHeight = textarea.scrollHeight || minHeight;
      const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));

      textarea.style.height = `${Math.ceil(newHeight)}px`;
    };

    useEffect(() => {
      adjustHeight();
    }, [value]);

    return (
      <textarea
        ref={internalRef}
        value={value ?? ""}
        onChange={(e) => {
          onChange?.(e);
          adjustHeight();
        }}
        className={cn(
          "w-full rounded-md border border-primary bg-background px-3 py-2 font-mono text-sm font-semibold shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none overflow-y-auto transition-all",
          className
        )}
        {...props}
      />
    );
  }
);
AutoResizingTextarea.displayName = "AutoResizingTextarea";
