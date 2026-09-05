import { useEffect, useRef, useState, useCallback } from "react";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { webContainerManager } from "@lib/webcontainer";

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ term: Terminal; fitAddon: FitAddon } | null>(null);
  const shellRef = useRef<{ write: (d: string) => void; resize: (c: number, r: number) => void; kill: () => void } | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);

  const fitAndResizeShell = useCallback(() => {
    const ref = termRef.current;
    const shell = shellRef.current;
    if (!ref) return;
    try {
      ref.fitAddon.fit();
      if (shell && ref.term.cols > 0 && ref.term.rows > 0) {
        shell.resize(ref.term.cols, ref.term.rows);
      }
    } catch {
      /* panel may be hidden */
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let onDataDisposable: { dispose: () => void } | null = null;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const init = async () => {
      try {
        const { Terminal } = await import("@xterm/xterm");
        const { FitAddon } = await import("@xterm/addon-fit");
        await import("@xterm/xterm/css/xterm.css");

        if (!containerRef.current || !isMounted) return;

        term = new Terminal({
          theme: {
            background: "#111111",
            foreground: "#ebebeb",
            cursor: "#f97316",
            selectionBackground: "rgba(249,115,22,0.25)",
          },
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 13,
          cursorBlink: true,
          scrollback: 1000,
          convertEol: true,
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();
        termRef.current = { term, fitAddon };

        term.writeln("\x1b[90m# brainhalf — WebContainer shell (jsh)\x1b[0m");
        term.writeln("\x1b[90mBooting project filesystem…\x1b[0m");

        if (typeof window !== "undefined" && !window.crossOriginIsolated) {
          throw new Error(
            "WebContainer needs cross-origin isolation (COOP/COEP). Hard-refresh the page.",
          );
        }

        const shell = await webContainerManager.attachInteractiveShell({
          cols: term.cols,
          rows: term.rows,
          onOutput: (data) => {
            if (isMounted && term) {
              term.write(data);
            }
          },
        });

        if (!isMounted) {
          shell.kill();
          return;
        }

        shellRef.current = shell;
        setIsConnecting(false);

        onDataDisposable = term.onData((data) => {
          shell.write(data);
        });

        const ro = new ResizeObserver(() => {
          if (resizeTimeout) clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(() => {
            fitAndResizeShell();
            resizeTimeout = null;
          }, 100);
        });
        ro.observe(containerRef.current);
        roRef.current = ro;
      } catch (error) {
        console.error("Terminal init failed:", error);
        if (isMounted) {
          setIsConnecting(false);
          setInitError(
            error instanceof Error ? error.message : "Failed to connect terminal to WebContainer.",
          );
        }
      }
    };

    void init();

    return () => {
      isMounted = false;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      roRef.current?.disconnect();
      onDataDisposable?.dispose();
      shellRef.current?.kill();
      shellRef.current = null;
      term?.dispose();
      termRef.current = null;
    };
  }, [fitAndResizeShell]);

  useEffect(() => {
    window.addEventListener("resize", fitAndResizeShell);
    return () => window.removeEventListener("resize", fitAndResizeShell);
  }, [fitAndResizeShell]);

  const handleClear = () => {
    termRef.current?.term.clear();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "var(--panel-center)" }}>
      <div className="studio-panel-header">
        <span className="studio-panel-label">terminal</span>
        <div style={{ display: "flex", gap: 8, color: "var(--text-3)" }}>
          <button type="button" className="studio-btn" style={{ padding: 4, border: "none" }} title="New tab (coming soon)" disabled>
            <Plus size={13} />
          </button>
          <button type="button" className="studio-btn" style={{ padding: 4, border: "none" }} title="Clear" onClick={handleClear}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, padding: 8, overflow: "hidden", position: "relative" }}>
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

        {isConnecting && !initError && (
          <div style={{
            position: "absolute", inset: 8, pointerEvents: "none",
            display: "flex", alignItems: "flex-end", justifyContent: "flex-start",
            fontSize: 11, color: "var(--text-3)", fontFamily: "monospace",
          }}>
            connecting…
          </div>
        )}

        {initError && (
          <div style={{
            position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 12, color: "var(--red)", zIndex: 10, padding: 20, textAlign: "center",
          }}>
            <AlertCircle size={32} />
            <div style={{ fontSize: 14, fontFamily: "monospace" }}>{initError}</div>
          </div>
        )}
      </div>
    </div>
  );
}
