import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type ThinkingState = "idle" | "reading" | "planning" | "writing" | "installing" | "fixing";

interface ThinkingIndicatorProps {
  state: ThinkingState;
  target?: string;
  message?: string;
  onReady?: () => void;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
  state,
  target,
  message = "",
  onReady
}) => {
  const [visibleState, setVisibleState] = useState<ThinkingState>("idle");
  const [planningIndex, setPlanningIndex] = useState(0);
  const [installProgress, setInstallProgress] = useState(0);

  // Refs for cleanup & preventing stale callbacks
  const isMountedRef = useRef(true);
  const planningIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const installTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const planningLabels = [
    "thinking about the architecture...",
    "working out the game loop...",
    "figuring out the physics approach...",
    "planning the file structure..."
  ];

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Natural timing delay on initial mount or when starting to think
  useEffect(() => {
    if (state !== "idle" && visibleState === "idle") {
      let delay = 400; // default
      const msg = message.toLowerCase();

      if (msg.length > 50 || msg.includes("code") || msg.includes("generate")) {
        delay = 700;
      }
      if (msg.length > 150 || msg.includes("3d") || msg.includes("three") || msg.includes("complex")) {
        delay = 900;
      }

      const totalDelay = delay + Math.random() * 200;

      // Clear any existing delay timer
      if (delayTimeoutRef.current) {
        clearTimeout(delayTimeoutRef.current);
      }

      delayTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setVisibleState(state);
          onReady?.();
        }
      }, totalDelay);

      return () => {
        if (delayTimeoutRef.current) {
          clearTimeout(delayTimeoutRef.current);
          delayTimeoutRef.current = null;
        }
      };
    } else {
      setVisibleState(state);
    }
  }, [state, message, visibleState, onReady]);

  // Planning label rotation
  useEffect(() => {
    if (visibleState === "planning") {
      if (planningIntervalRef.current) {
        clearInterval(planningIntervalRef.current);
      }
      planningIntervalRef.current = setInterval(() => {
        setPlanningIndex((prev) => (prev + 1) % planningLabels.length);
      }, 1500);

      return () => {
        if (planningIntervalRef.current) {
          clearInterval(planningIntervalRef.current);
          planningIntervalRef.current = null;
        }
      };
    }
  }, [visibleState, planningLabels.length]);

  // Installing progress uneven jumps
  useEffect(() => {
    if (visibleState === "installing") {
      setInstallProgress(0);
      const jumps = [30, 70, 85, 100];
      let currentJump = 0;

      // Clear any existing install timers
      if (installTimeoutRef.current) {
        clearTimeout(installTimeoutRef.current);
        installTimeoutRef.current = null;
      }

      const jumpProgress = () => {
        if (!isMountedRef.current) return;

        if (currentJump < jumps.length) {
          setInstallProgress(jumps[currentJump]);
          currentJump++;
          // Pause differently for each jump
          const nextDelay = currentJump === 1 ? 800 : currentJump === 2 ? 1500 : 600;

          installTimeoutRef.current = setTimeout(jumpProgress, nextDelay + Math.random() * 300);
        } else {
          installTimeoutRef.current = null;
        }
      };

      installTimeoutRef.current = setTimeout(jumpProgress, 400);

      return () => {
        if (installTimeoutRef.current) {
          clearTimeout(installTimeoutRef.current);
          installTimeoutRef.current = null;
        }
      };
    }
  }, [visibleState]);

  if (visibleState === "idle") return null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 bg-[var(--bg-2)] border border-[var(--border)] rounded-xl w-fit text-[var(--text-2)] font-mono text-xs shadow-sm"
      role="status"
      aria-live="polite"
    >
      {/* State 1: Reading */}
      {visibleState === "reading" && (
        <>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full"
                animate={{ x: [0, 8, 0] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  delay: i * 0.15,
                  ease: "easeInOut"
                }}
              />
            ))}
          </div>
          <span>reading your code...</span>
        </>
      )}

      {/* State 2: Planning */}
      {visibleState === "planning" && (
        <>
          <motion.div
            className="w-1.5 h-3.5 bg-[var(--accent)]"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          />
          <AnimatePresence mode="wait">
            <motion.span
              key={planningIndex}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {planningLabels[planningIndex]}
            </motion.span>
          </AnimatePresence>
        </>
      )}

      {/* State 3: Writing */}
      {visibleState === "writing" && (
        <>
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 bg-[var(--accent)] rounded-sm"
                animate={{
                  y: [0, -4, 0],
                  opacity: [0.3, 1, 0.3],
                  scale: [1, 1.1, 1]
                }}
                transition={{
                  duration: 0.35,
                  repeat: Infinity,
                  repeatType: "reverse",
                  delay: i === 0 ? 0 : i === 1 ? 0.15 : 0.4
                }}
              />
            ))}
          </div>
          <span>writing {target || "game.js"}...</span>
        </>
      )}

      {/* State 4: Installing */}
      {visibleState === "installing" && (
        <div className="flex flex-col gap-2 w-56">
          <div className="flex justify-between w-full">
            <span>installing {target || "dependencies"}...</span>
            <span className="text-[10px] text-[var(--text-3)]">{installProgress}%</span>
          </div>
          <div className="w-full h-1 bg-[var(--bg-3)] rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-[var(--accent)]"
              initial={{ width: 0 }}
              animate={{ width: `${installProgress}%` }}
              transition={{ type: "spring", stiffness: 45, damping: 15 }}
            />
          </div>
        </div>
      )}

      {/* State 5: Fixing */}
      {visibleState === "fixing" && (
        <>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="w-1.5 h-1.5 rounded-full"
                animate={{
                  backgroundColor: ["var(--text-3)", "var(--red)", "var(--text-3)"],
                  scale: [1, 1.3, 1]
                }}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  delay: i * 0.2,
                  ease: "easeInOut"
                }}
              />
            ))}
          </div>
          <span>hmm, adjusting the {target || "logic"}...</span>
        </>
      )}
    </div>
  );
};