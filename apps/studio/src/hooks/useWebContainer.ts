import { useState, useEffect, useCallback, useRef } from 'react';
import { webContainerManager } from '../lib/webcontainer';
import { syncStoreFilesToWebContainer } from '../lib/sync-store';
import type { StudioInitPhase } from '../lib/webcontainer/global-state';

/** Shared init — safe for Strict Mode, multiple hooks, and Vite HMR */
let hookBootPromise: Promise<void> | null = null;

function ensureHookBoot(): Promise<void> {
  if (!hookBootPromise) {
    hookBootPromise = webContainerManager.boot().then(async () => {
      await syncStoreFilesToWebContainer();
      try {
        await webContainerManager.ensureStudioReady();
      } catch (err) {
        console.warn('[useWebContainer] Background studio init:', err);
      }
    }).catch((err) => {
      hookBootPromise = null;
      throw err;
    });
  }
  return hookBootPromise;
}

function readManagerState() {
  const previewUrl = webContainerManager.getPreviewUrl();
  const booted = webContainerManager.isBooted();
  const initPhase = webContainerManager.getInitPhase();
  const isNpmInstalling = webContainerManager.isNpmInstallInProgress();
  return { previewUrl, booted, initPhase, isNpmInstalling };
}

export function useWebContainer() {
  const initial = readManagerState();
  const [isBooted, setIsBooted] = useState(initial.booted);
  const [initPhase, setInitPhase] = useState<StudioInitPhase>(initial.initPhase);
  const [isNpmInstalling, setIsNpmInstalling] = useState(initial.isNpmInstalling);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(initial.previewUrl);

  const isMountedRef = useRef(true);

  const applyManagerState = useCallback(() => {
    const { previewUrl: url, booted, initPhase: phase, isNpmInstalling: installing } =
      readManagerState();
    if (!isMountedRef.current) return;
    setIsBooted(booted);
    setPreviewUrl(url);
    setInitPhase(phase);
    setIsNpmInstalling(installing);
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    const unsubscribeServer = webContainerManager.onServerReady((url) => {
      if (isMountedRef.current) {
        setPreviewUrl(url);
        setIsBooted(true);
      }
    });

    const unsubscribePhase = webContainerManager.onInitPhaseChange((phase) => {
      if (!isMountedRef.current) return;
      setInitPhase(phase);
      setIsNpmInstalling(webContainerManager.isNpmInstallInProgress());
    });

    if (typeof window !== 'undefined' && !window.crossOriginIsolated) {
      setError(
        'WebContainer needs cross-origin isolation (COOP/COEP headers). Hard-refresh the page or check Cloudflare _headers on studio.brainhalf.com.'
      );
      return () => {
        isMountedRef.current = false;
        unsubscribeServer();
        unsubscribePhase();
      };
    }

    applyManagerState();

    ensureHookBoot()
      .then(() => {
        if (!isMountedRef.current) return;
        applyManagerState();
      })
      .catch((err) => {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to boot WebContainer';
        console.error('[useWebContainer] Error:', errorMessage);
        if (isMountedRef.current) {
          setError(errorMessage);
        }
      });

    // Poll npm install flag while init is in flight (no listener for that field alone).
    const poll = window.setInterval(() => {
      if (!isMountedRef.current) return;
      setIsNpmInstalling(webContainerManager.isNpmInstallInProgress());
    }, 500);

    return () => {
      isMountedRef.current = false;
      unsubscribeServer();
      unsubscribePhase();
      window.clearInterval(poll);
    };
  }, [applyManagerState]);

  const writeFiles = useCallback(async (files: Record<string, string>) => {
    try {
      await webContainerManager.writeFiles(files);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to write files';
      console.error('[useWebContainer] writeFiles error:', errorMessage);
      if (isMountedRef.current) {
        setError(errorMessage);
      }
    }
  }, []);

  const installPackage = useCallback(async (pkg: string, onOutput?: (data: string) => void) => {
    try {
      return await webContainerManager.installPackage(pkg, onOutput);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to install package';
      console.error('[useWebContainer] installPackage error:', errorMessage);
      if (isMountedRef.current) {
        setError(errorMessage);
      }
    }
  }, []);

  const runCommand = useCallback(
    async (cmd: string, args: string[], onOutput?: (data: string) => void) => {
      try {
        return await webContainerManager.runCommand(cmd, args, onOutput);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to run command';
        console.error('[useWebContainer] runCommand error:', errorMessage);
        if (isMountedRef.current) {
          setError(errorMessage);
        }
        return 1;
      }
    },
    []
  );

  /** @deprecated use initPhase / isNpmInstalling — kept for callers that check isInstalling */
  const isInstalling =
    isBooted && !previewUrl && initPhase !== 'ready' && initPhase !== 'idle';

  return {
    isBooted,
    isInstalling,
    isNpmInstalling,
    initPhase,
    error,
    previewUrl,
    writeFiles,
    installPackage,
    runCommand,
  };
}
