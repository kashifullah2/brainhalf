import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getWebContainer,
  teardownWebContainer,
  webContainerSupported,
  mountFiles,
  syncDelta,
  installDependencies,
  startDevServer,
  spawnShell,
  type DevServerHandle,
} from './webcontainer';
import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { Terminal } from '@xterm/xterm';

export type ContainerStatus =
  | 'unsupported'
  | 'booting'
  | 'mounting'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error';

export interface WebContainerState {
  supported: boolean;
  status: ContainerStatus;
  previewUrl: string | null;
  error: string | null;
  terminalWrite: (data: string) => void;
  attachTerminal: (terminal: Terminal) => void;
  restart: () => void;
}

export function useWebContainer(
  projectId: string,
  files: Record<string, string>,
): WebContainerState {
  const supported = webContainerSupported();
  const [status, setStatus] = useState<ContainerStatus>(supported ? 'booting' : 'unsupported');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<WebContainer | null>(null);
  const devServerRef = useRef<DevServerHandle | null>(null);
  const shellRef = useRef<WebContainerProcess | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const mountedRef = useRef(false);
  const prevFilesRef = useRef<Record<string, string>>({});
  const bootedRef = useRef(false);
  const restartNonce = useRef(0);

  const writeToTerminal = useCallback((data: string) => {
    terminalRef.current?.write(data);
  }, []);

  const attachTerminal = useCallback((terminal: Terminal) => {
    terminalRef.current = terminal;
    const shell = shellRef.current;
    if (shell) {
      const writable = shell.input.getWriter();
      terminal.onData(data => { writable.write(data).catch(() => {}); });
    }
  }, []);

  const boot = useCallback(async (nonce: number) => {
    if (!supported) return;
    try {
      setStatus('booting');
      setError(null);
      setPreviewUrl(null);

      writeToTerminal('\x1b[2J\x1b[H');
      writeToTerminal('\x1b[1;36m⚡ Booting WebContainer...\x1b[0m\r\n');

      const container = await getWebContainer();
      if (nonce !== restartNonce.current) return;
      containerRef.current = container;

      setStatus('mounting');
      writeToTerminal('\x1b[1;33m📁 Mounting project files...\x1b[0m\r\n');
      await mountFiles(container, files);
      if (nonce !== restartNonce.current) return;
      mountedRef.current = true;
      prevFilesRef.current = { ...files };

      setStatus('installing');
      writeToTerminal('\x1b[1;33m📦 Installing dependencies...\x1b[0m\r\n');
      const exitCode = await installDependencies(container, writeToTerminal);
      if (nonce !== restartNonce.current) return;

      if (exitCode !== 0) {
        const msg = `npm install failed with exit code ${exitCode}`;
        writeToTerminal(`\x1b[1;31m❌ ${msg}\x1b[0m\r\n`);
        setError(msg);
        setStatus('error');
        return;
      }
      writeToTerminal('\x1b[1;32m✅ Dependencies installed\x1b[0m\r\n');

      setStatus('starting');
      writeToTerminal('\x1b[1;33m🚀 Starting dev server...\x1b[0m\r\n');
      const server = await startDevServer(container, writeToTerminal);
      if (nonce !== restartNonce.current) return;
      devServerRef.current = server;

      writeToTerminal(`\x1b[1;32m✅ Dev server ready at ${server.url}\x1b[0m\r\n\r\n`);
      setPreviewUrl(server.url);
      setStatus('ready');

      const shell = await spawnShell(container);
      shellRef.current = shell;
      shell.output.pipeTo(new WritableStream({
        write(data) { writeToTerminal(data); },
      })).catch(() => {});

      if (terminalRef.current) {
        const writable = shell.input.getWriter();
        terminalRef.current.onData(data => { writable.write(data).catch(() => {}); });
      }

      bootedRef.current = true;
    } catch (err) {
      if (nonce !== restartNonce.current) return;
      const msg = err instanceof Error ? err.message : 'WebContainer boot failed';
      writeToTerminal(`\x1b[1;31m❌ ${msg}\x1b[0m\r\n`);
      setError(msg);
      setStatus('error');
    }
  }, [supported, files, writeToTerminal]);

  useEffect(() => {
    if (!supported) return;
    const nonce = ++restartNonce.current;
    boot(nonce);
    return () => { restartNonce.current++; };
  }, [projectId]);

  useEffect(() => {
    if (!mountedRef.current || !containerRef.current) return;
    const prev = prevFilesRef.current;
    const changed: Record<string, string> = {};
    const removed: string[] = [];
    for (const [path, content] of Object.entries(files)) {
      if (prev[path] !== content) changed[path] = content;
    }
    for (const path of Object.keys(prev)) {
      if (!(path in files)) removed.push(path);
    }
    if (Object.keys(changed).length === 0 && removed.length === 0) return;
    prevFilesRef.current = { ...files };
    syncDelta(containerRef.current, changed, removed).catch(() => {});
  }, [files]);

  const restart = useCallback(() => {
    devServerRef.current?.process.kill();
    devServerRef.current = null;
    shellRef.current?.kill();
    shellRef.current = null;
    mountedRef.current = false;
    teardownWebContainer();
    containerRef.current = null;
    const nonce = ++restartNonce.current;
    boot(nonce);
  }, [boot]);

  useEffect(() => {
    return () => {
      devServerRef.current?.process.kill();
      shellRef.current?.kill();
    };
  }, []);

  return {
    supported,
    status,
    previewUrl,
    error,
    terminalWrite: writeToTerminal,
    attachTerminal,
    restart,
  };
}
