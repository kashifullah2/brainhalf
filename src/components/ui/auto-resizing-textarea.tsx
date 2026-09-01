import React, { useCallback, useEffect, useRef, useImperativeHandle } from "react";
import { cn } from "@/lib/utils";

interface AutoResizingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minRows?: number;
  maxRows?: number;
}

export const AutoResizingTextarea = React.forwardRef<HTMLTextAreaElement, AutoResizingTextareaProps>(
  ({ className, value, minRows = 1, maxRows = 12, onChange, ...props }, ref) => {
    const internalRef = useRef<HTMLTextAreaElement | null>(null);
    const lastWidth = useRef<number | null>(null);

    useImperativeHandle(ref, () => internalRef.current as HTMLTextAreaElement, []);

    const adjustHeight = useCallback(() => {
      const textarea = internalRef.current;
      if (!textarea) return;

      textarea.style.height = "auto";

      let lineHeight = 20;
      let paddingTop = 8;
      let paddingBottom = 8;

      try {
        const cs = window.getComputedStyle(textarea);
        const lh = parseFloat(cs.lineHeight);
        if (!Number.isNaN(lh) && lh > 5) {
          lineHeight = lh;
        } else {
          const fs = parseFloat(cs.fontSize);
          if (!Number.isNaN(fs) && fs > 5) lineHeight = fs * 1.4;
        }
        const pt = parseFloat(cs.paddingTop);
        if (!Number.isNaN(pt)) paddingTop = pt;
        const pb = parseFloat(cs.paddingBottom);
        if (!Number.isNaN(pb)) paddingBottom = pb;
      } catch {
        // keep defaults
      }

      const minHeight = minRows * lineHeight + paddingTop + paddingBottom;
      const maxHeight = maxRows * lineHeight + paddingTop + paddingBottom;
      const scrollHeight = textarea.scrollHeight || minHeight;
      const next = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
      textarea.style.height = `${Math.ceil(next)}px`;
    }, [minRows, maxRows]);

    useEffect(() => {
      adjustHeight();
    }, [value, adjustHeight]);

    // FIX: previously height only reacted to `value`. Textareas mounted while
    // hidden ( dialogs, tabs, accordions ) measured at 0 and stayed stuck at
    // min-height forever. Re-measure on WIDTH change; ignore height-only
    // triggers (they're our own writes → no observer feedback loop).
    useEffect(() => {
      const el = internalRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? 0;
        if (lastWidth.current === null) {
          lastWidth.current = width;
          return;
        }
        if (width !== lastWidth.current) {
          lastWidth.current = width;
          adjustHeight();
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [adjustHeight]);

    return (
      <textarea
        ref={internalRef}
        rows={minRows}
        value={value ?? ""}
        onChange={(e) => {
          onChange?.(e);
          adjustHeight();
        }}
        className={cn(
          // Resting state matches every other field in the product. It used
          // to carry `border-primary` and `shadow-md` at rest, so an untouched
          // textarea was drawn with the brand border and a lifted shadow — it
          // read as focused, or as an error, on a form nobody had typed in yet.
          //
          // transition-colors, not transition-all: the height changes on every
          // keystroke, and tweening the inline height made typing feel laggy.
          "w-full resize-none overflow-y-auto rounded-lg border border-input bg-transparent px-3 py-2 font-sans text-base shadow-sm transition-colors md:text-body",
          "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:shadow-none",
          className,
        )}
        {...props}
      />
    );
  }
);
AutoResizingTextarea.displayName = "AutoResizingTextarea";
