import type { WebContainer } from '@webcontainer/api';

export const WC_STATE_KEY = '__brainhalf_wc_state__';

export type StudioInitPhase =
  | 'idle'
  | 'booting'
  | 'starting-preview'
  | 'installing'
  | 'ready';

export interface WebContainerGlobalState {
  container: WebContainer | null;
  bootPromise: Promise<WebContainer> | null;
  projectMounted: boolean;
  devServerUrl: string | null;
  /** @deprecated use viteServerStartRequested */
  devServerStartRequested: boolean;
  staticServerStartRequested: boolean;
  viteServerStartRequested: boolean;
  viteReady: boolean;
  studioInitPromise: Promise<void> | null;
  initPhase: StudioInitPhase;
  npmInstallInProgress: boolean;
  serverReadyListeners: Set<(url: string) => void>;
  initPhaseListeners: Set<(phase: StudioInitPhase) => void>;
  /** Recent runtime errors reported by the preview (uncaught/rejection/console.error). */
  runtimeErrors: string[];
  /** Recent build/Vite/transform error blocks captured from the dev-server stdio. */
  buildErrors: string[];
  /** Rolling raw tail of dev-server output, used to detect multi-line error blocks. */
  devServerTail: string;
  /** Whether the preview-message listener has been attached to the container. */
  previewListenerAttached: boolean;
}

export function getWebContainerGlobalState(): WebContainerGlobalState {
  const win = window as Window & {
    [WC_STATE_KEY]?: WebContainerGlobalState;
  };
  if (!win[WC_STATE_KEY]) {
    win[WC_STATE_KEY] = {
      container: null,
      bootPromise: null,
      projectMounted: false,
      devServerUrl: null,
      devServerStartRequested: false,
      staticServerStartRequested: false,
      viteServerStartRequested: false,
      viteReady: false,
      studioInitPromise: null,
      initPhase: 'idle',
      npmInstallInProgress: false,
      serverReadyListeners: new Set(),
      initPhaseListeners: new Set(),
      runtimeErrors: [],
      buildErrors: [],
      devServerTail: '',
      previewListenerAttached: false,
    };
  }
  return win[WC_STATE_KEY]!;
}

export function isSingleInstanceBootError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('Only a single WebContainer instance can be booted');
}
