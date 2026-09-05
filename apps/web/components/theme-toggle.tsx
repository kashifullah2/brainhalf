

import { useTheme } from "./theme-provider";
import { Sun, Moon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="relative flex items-center justify-center w-8 h-8 rounded-md text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--bg-2)] transition-colors focus:outline-none focus-visible:outline focus-visible:outline-[var(--accent)]"
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        {theme === "dark" ? (
          <motion.div
            key="moon"
            initial={{ rotate: -90, scale: 0, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute"
          >
            <Moon size={16} strokeWidth={2} />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ rotate: -90, scale: 0, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={{ rotate: 90, scale: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute"
          >
            <Sun size={16} strokeWidth={2} />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}
