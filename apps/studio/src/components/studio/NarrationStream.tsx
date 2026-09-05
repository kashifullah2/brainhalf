import { useState, useEffect, useRef, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface NarrationItem {
  id: string;
  text: string;
  isClosed: boolean;
  timerScheduled: boolean; // Track if cleanup timer is already set
}

export interface NarrationStreamProps {
  content: string;
}

export function NarrationStream({ content }: NarrationStreamProps) {
  const [narrations, setNarrations] = useState<NarrationItem[]>([]);
  const prevContentRef = useRef<string>("");

  // ── Parse narrations from content ──
  useEffect(() => {
    if (!content) return;

    // Only update if content actually changed (prevents re-parsing on every render)
    if (content === prevContentRef.current) return;
    prevContentRef.current = content;

    const regex = /<narrate>([\s\S]*?)(?:<\/narrate>|$)/g;
    const matches = Array.from(content.matchAll(regex));

    setNarrations((prev) => {
      const next: NarrationItem[] = [...prev];
      let changed = false;

      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        // Use content hash + index to create stable IDs across streaming
        const id = `narrate-${i}-${match.index}`;
        const text = match[1].trim();
        const isClosed = match[0].endsWith("</narrate>");

        const existingIndex = next.findIndex(n => n.id === id);
        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          if (existing.text !== text || existing.isClosed !== isClosed) {
            // Preserve timerScheduled flag when updating
            next[existingIndex] = {
              id,
              text,
              isClosed,
              timerScheduled: existing.timerScheduled
            };
            changed = true;
          }
        } else {
          next.push({ id, text, isClosed, timerScheduled: false });
          changed = true;
        }
      }

      // Optional: Remove narrations that no longer exist in content (cleanup)
      // But for streaming we keep them until closed or timed out.

      return changed ? next : prev;
    });
  }, [content]);

  // ── Auto-remove closed narrations after 3 seconds ──
  useEffect(() => {
    if (narrations.length === 0) return;

    // Find closed narrations that haven't had a timer scheduled yet
    const closedWithoutTimer = narrations.filter(
      n => n.isClosed && !n.timerScheduled
    );

    if (closedWithoutTimer.length === 0) return;

    const timers: ReturnType<typeof setTimeout>[] = [];

    closedWithoutTimer.forEach((narration) => {
      // Mark this narration as having a timer scheduled
      setNarrations((prev) =>
        prev.map(n =>
          n.id === narration.id
            ? { ...n, timerScheduled: true }
            : n
        )
      );

      const timer = setTimeout(() => {
        setNarrations((prev) => prev.filter(n => n.id !== narration.id));
      }, 3000);
      timers.push(timer);
    });

    return () => {
      timers.forEach(t => clearTimeout(t));
    };
  }, [narrations]);

  // ── Only show the last 2 visible narrations ──
  const visibleNarrations = narrations.slice(-2);

  if (visibleNarrations.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 w-full mb-3 px-2">
      <AnimatePresence mode="popLayout">
        {visibleNarrations.map((narration) => (
          <motion.div
            key={narration.id}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.4 }}
            className="text-[var(--text-3)] font-mono italic text-[12px] leading-relaxed"
          >
            <TypewriterText text={narration.text} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Memoized Typewriter to prevent re-renders ──
const TypewriterText = memo(function TypewriterText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCompleteRef = useRef(false);

  // Reset when text changes
  useEffect(() => {
    setDisplayed("");
    isCompleteRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [text]);

  // Typewriter effect
  useEffect(() => {
    if (isCompleteRef.current) return;
    if (displayed.length >= text.length) {
      isCompleteRef.current = true;
      return;
    }

    timeoutRef.current = setTimeout(() => {
      setDisplayed(text.slice(0, displayed.length + 1));
    }, 15);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [text, displayed]);

  return <span>{displayed}</span>;
});