// Studio client component

import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
// @ts-ignore
import "@xterm/xterm/css/xterm.css";
import { TerminalSquare, Plus, Trash2 } from "lucide-react";
import { useWebContainer } from "../../hooks/useWebContainer";

export function Terminal() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef<string>("");
  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { runCommand, isBooted } = useWebContainer();

  // Stable ref to avoid effect re-runs when runCommand changes
  const runCommandRef = useRef(runCommand);
  useEffect(() => {
    runCommandRef.current = runCommand;
  }, [runCommand]);

  const [tabs, setTabs] = useState([{ id: 1, name: "bash" }]);
  const [activeTab, setActiveTab] = useState(1);

  // ── Terminal Initialization (Runs Once) ──
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#0a0a0a",
        foreground: "#ebebeb",
        cursor: "#f97316",
        selectionBackground: "rgba(249, 115, 22, 0.3)",
        black: "#000000",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#d946ef",
        cyan: "#06b6d4",
        white: "#ffffff",
      },
      fontFamily: '"Geist Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    try {
      fitAddon.fit();
    } catch (_) {
      // Ignore fit errors if terminal is not visible
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln("\x1b[38;2;249;115;22mBrainHalf Engine Terminal\x1b[0m");
    term.writeln("\x1b[90mWaiting for WebContainer to boot...\x1b[0m");

    // ── Input Buffer ──
    inputBufferRef.current = "";

    // ── Stable OnData Handler ──
    const onData = (data: string) => {
      // Check isBooted from latest ref
      if (!isBooted) {
        term.write("\r\n\x1b[31mWebContainer not ready.\x1b[0m\r\n$ ");
        return;
      }

      const code = data.charCodeAt(0);
      if (code === 13) { // Enter
        term.write("\r\n");
        const trimmed = inputBufferRef.current.trim();
        if (trimmed) {
          const args = trimmed.split(" ");
          const cmd = args.shift() || "";
          runCommandRef.current(cmd, args, (out) => {
            term.write(out.replace(/\n/g, "\r\n"));
          });
        }
        inputBufferRef.current = "";
        term.write("\r\n$ ");
      } else if (code === 127) { // Backspace
        if (inputBufferRef.current.length > 0) {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
          term.write("\b \b");
        }
      } else {
        inputBufferRef.current += data;
        term.write(data);
      }
    };

    const disposable = term.onData(onData);
    onDataDisposableRef.current = disposable;

    // ── Resize Observer (Debounced) ──
    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch (_) {
          // Ignore fit errors
        }
        resizeTimeoutRef.current = null;
      }, 150);
    });

    resizeObserver.observe(terminalRef.current);

    // ── Cleanup ──
    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
      if (onDataDisposableRef.current) {
        onDataDisposableRef.current.dispose();
        onDataDisposableRef.current = null;
      }
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // ✅ Empty array = runs once

  // ── Booted Status Message ──
  useEffect(() => {
    if (!xtermRef.current) return;
    if (isBooted) {
      xtermRef.current.writeln("\x1b[32mWebContainer Ready.\x1b[0m");
      xtermRef.current.write("$ ");
    }
  }, [isBooted]);

  // ── Force Fit on Tab Change / Window Resize ──
  useEffect(() => {
    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch (_) {
        // Ignore
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ── Handle Tab Deletion Safely ──
  const handleCloseTab = (tabId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length <= 1) return;

    const currentIndex = tabs.findIndex((t) => t.id === tabId);
    let newActiveId = activeTab;

    if (activeTab === tabId) {
      // Select the tab to the left, or right if it's the first tab
      const newIndex = Math.max(0, currentIndex - 1);
      newActiveId = tabs[newIndex].id;
      setActiveTab(newActiveId);
    }

    setTabs((prev) => prev.filter((t) => t.id !== tabId));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "var(--bg)", borderTop: "1px solid var(--border)" }}>
      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", background: "var(--bg-2)", borderBottom: "1px solid var(--border)", padding: "0 8px" }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", cursor: "pointer",
              borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              background: activeTab === tab.id ? "var(--bg)" : "transparent",
              color: activeTab === tab.id ? "var(--text)" : "var(--text-2)",
              fontSize: 12, fontFamily: "monospace",
              borderRight: "1px solid var(--border)", borderLeft: "1px solid var(--border)"
            }}
          >
            <TerminalSquare size={13} color={activeTab === tab.id ? "var(--accent)" : "var(--text-3)"} />
            {tab.name}
            {tabs.length > 1 && (
              <button
                onClick={(e) => handleCloseTab(tab.id, e)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  display: "flex", padding: 2, marginLeft: 4, color: "var(--text-3)"
                }}
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => setTabs((t) => [...t, { id: Date.now(), name: "bash" }])}
          style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: "8px", color: "var(--text-3)" }}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Terminal Container */}
      <div style={{ flex: 1, padding: "12px", overflow: "hidden", position: "relative" }}>
        <div ref={terminalRef} style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}