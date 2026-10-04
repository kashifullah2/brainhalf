import { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './Terminal.css';

interface TerminalProps {
  onReady?: (terminal: XTerm) => void;
}

const THEME = {
  background: '#0c0e14',
  foreground: '#e4e8eb',
  cursor: '#e4e8eb',
  cursorAccent: '#0c0e14',
  selectionBackground: 'rgba(54, 89, 217, 0.35)',
  black: '#1a1e2e',
  red: '#ff6b6b',
  green: '#69db7c',
  yellow: '#ffd43b',
  blue: '#74c0fc',
  magenta: '#da77f2',
  cyan: '#66d9e8',
  white: '#e4e8eb',
  brightBlack: '#495057',
  brightRed: '#ff8787',
  brightGreen: '#8ce99a',
  brightYellow: '#ffe066',
  brightBlue: '#a5d8ff',
  brightMagenta: '#e599f7',
  brightCyan: '#99e9f2',
  brightWhite: '#f8f9fa',
};

export default function Terminal({ onReady }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const handleResize = useCallback(() => {
    try { fitAddonRef.current?.fit(); } catch {}
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new XTerm({
      theme: THEME,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', Menlo, monospace",
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    onReadyRef.current?.(terminal);

    return () => {
      observer.disconnect();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [handleResize]);

  return <div ref={containerRef} className="wc-terminal-container" />;
}

export type { XTerm };
