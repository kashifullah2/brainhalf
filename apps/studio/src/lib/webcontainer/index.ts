import { WebContainer, PreviewMessageType } from '@webcontainer/api';
import type { PreviewMessage } from '@webcontainer/api';
import {
  getWebContainerGlobalState,
  isSingleInstanceBootError,
  type StudioInitPhase,
} from './global-state';
import {
  isListedInPackageJson,
  packageFingerprint,
  parsePackageSpec,
} from './npm-install';
import previewServerSource from './preview-server.mjs?raw';
import { DEFAULT_INDEX_HTML, DEFAULT_GAME_JS, DEFAULT_PACKAGE_JSON } from '../default-project';
import { stripAnsi } from '../error-normalizer';

const BOOT_TIMEOUT_MS = 60_000;
const NPM_INSTALL_TIMEOUT_MS = 120_000;
const VITE_PREVIEW_PORT = 5173;
/** Keep at most this many recent runtime errors from the preview. */
const MAX_RUNTIME_ERRORS = 25;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

const DEFAULT_PROJECT_FILES = {
  'package.json': {
    file: {
      contents: DEFAULT_PACKAGE_JSON,
    },
  },
  'index.html': {
    file: {
      contents: DEFAULT_INDEX_HTML,
    },
  },
  'src': {
    directory: {
      'game.js': {
        file: {
          contents: DEFAULT_GAME_JS,
        },
      },
    },
  },
  'preview-server.mjs': {
    file: {
      contents: previewServerSource,
    },
  },
};

export class WebContainerManager {
  private static instance: WebContainerManager;
  private installedDepsFingerprint: string | null = null;
  private fullInstallPromise: Promise<number> | null = null;

  private constructor() {}

  public static getInstance(): WebContainerManager {
    if (!WebContainerManager.instance) {
      WebContainerManager.instance = new WebContainerManager();
    }
    return WebContainerManager.instance;
  }

  private get state() {
    return getWebContainerGlobalState();
  }

  public onServerReady(callback: (url: string) => void): () => void {
    this.state.serverReadyListeners.add(callback);
    if (this.state.devServerUrl) {
      callback(this.state.devServerUrl);
    }
    return () => {
      this.state.serverReadyListeners.delete(callback);
    };
  }

  private notifyServerReady(url: string) {
    this.state.devServerUrl = url;
    for (const listener of this.state.serverReadyListeners) {
      listener(url);
    }
  }

  private setInitPhase(phase: StudioInitPhase) {
    if (this.state.initPhase === phase) return;
    this.state.initPhase = phase;
    for (const listener of this.state.initPhaseListeners) {
      listener(phase);
    }
  }

  private handleServerReady(port: number, url: string) {
    const isVite = port === VITE_PREVIEW_PORT || url.includes(`:${VITE_PREVIEW_PORT}`);
    if (isVite) {
      this.state.viteReady = true;
      console.log('[WebContainer] Vite dev server ready at:', url);
      this.setInitPhase('ready');
      this.notifyServerReady(url);
      return;
    }

    // Instant static preview until Vite is up (or for HTML/CSS-only projects).
    if (!this.state.viteReady) {
      console.log('[WebContainer] Static preview ready at:', url);
      if (this.state.initPhase !== 'installing') {
        this.setInitPhase('ready');
      }
      this.notifyServerReady(url);
    }
  }

  public onInitPhaseChange(callback: (phase: StudioInitPhase) => void): () => void {
    this.state.initPhaseListeners.add(callback);
    callback(this.state.initPhase);
    return () => {
      this.state.initPhaseListeners.delete(callback);
    };
  }

  public getInitPhase(): StudioInitPhase {
    return this.state.initPhase;
  }

  public isNpmInstallInProgress(): boolean {
    return this.state.npmInstallInProgress;
  }

  private attachServerListener(wc: WebContainer) {
    wc.on('server-ready', (port, url) => {
      this.handleServerReady(port, url);
    });
    this.attachPreviewErrorListener(wc);
  }

  /** Captures runtime errors surfaced by the preview so the agent can auto-fix them. */
  private attachPreviewErrorListener(wc: WebContainer) {
    const state = this.state;
    if (state.previewListenerAttached) return;
    state.previewListenerAttached = true;

    wc.on('preview-message', (message: PreviewMessage) => {
      let formatted: string | null = null;
      if (message.type === PreviewMessageType.UncaughtException) {
        formatted = `Uncaught exception: ${message.message}${message.stack ? `\n${message.stack}` : ''}`;
      } else if (message.type === PreviewMessageType.UnhandledRejection) {
        formatted = `Unhandled promise rejection: ${message.message}${message.stack ? `\n${message.stack}` : ''}`;
      } else if (message.type === PreviewMessageType.ConsoleError) {
        const text = (message.args ?? [])
          .map((a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
          .join(' ');
        // Ignore noisy/benign console.error spam without a real message.
        if (text.trim()) formatted = `console.error: ${text}`;
      }

      if (!formatted) return;
      const path = message.pathname || '';
      const entry = path ? `[${path}] ${formatted}` : formatted;

      // De-dupe consecutive identical errors (preview can spam the same one).
      const last = state.runtimeErrors[state.runtimeErrors.length - 1];
      if (last === entry) return;

      state.runtimeErrors.push(entry);
      if (state.runtimeErrors.length > MAX_RUNTIME_ERRORS) {
        state.runtimeErrors.splice(0, state.runtimeErrors.length - MAX_RUNTIME_ERRORS);
      }
    });
  }

  /** Returns and clears the buffered runtime errors from the preview. */
  public consumePreviewErrors(): string[] {
    const errors = this.state.runtimeErrors.slice();
    this.state.runtimeErrors.length = 0;
    return errors;
  }

  /** Clears buffered preview errors without returning them. */
  public clearPreviewErrors(): void {
    this.state.runtimeErrors.length = 0;
  }

  /**
   * Scans dev-server (Vite) stdio for error blocks and buffers them so the
   * self-healing loop can pick up build/import/transform failures that never
   * reach the preview iframe (e.g. "Failed to resolve import").
   */
  private recordDevServerOutput(chunk: string): void {
    const state = this.state;
    const clean = stripAnsi(chunk);
    // Keep a rolling tail so multi-line blocks split across chunks still parse.
    state.devServerTail = (state.devServerTail + clean).slice(-8000);

    const ERROR_MARKERS = [
      'failed to resolve import',
      '[vite] internal server error',
      'pre-transform error',
      'transform failed',
      'build failed',
      'could not resolve',
      'is not defined',
      'unexpected token',
      'error ts',
      'enoent',
    ];

    const lines = clean.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (!ERROR_MARKERS.some((m) => lower.includes(m))) continue;
      // Capture the marker line plus indented/context lines that follow.
      const block: string[] = [lines[i].trim()];
      for (let j = i + 1; j < lines.length && block.length < 6; j++) {
        const next = lines[j];
        if (!next.trim()) break;
        if (/^\s|file:|plugin:|^\s*at\s|:\d+:\d+/i.test(next)) {
          block.push(next.trim());
        } else {
          break;
        }
      }
      const entry = block.join('\n');
      const last = state.buildErrors[state.buildErrors.length - 1];
      if (last !== entry) {
        state.buildErrors.push(entry);
        if (state.buildErrors.length > MAX_RUNTIME_ERRORS) {
          state.buildErrors.splice(0, state.buildErrors.length - MAX_RUNTIME_ERRORS);
        }
      }
    }
  }

  /** Returns and clears buffered build/Vite errors captured from dev-server stdio. */
  public consumeBuildErrors(): string[] {
    const errors = this.state.buildErrors.slice();
    this.state.buildErrors.length = 0;
    return errors;
  }

  /** Clears buffered build errors and the dev-server tail. */
  public clearBuildErrors(): void {
    this.state.buildErrors.length = 0;
    this.state.devServerTail = '';
  }

  /**
   * Actively verifies the project builds. Runs `vite build` and returns the
   * exit code plus combined output so the caller can normalize any failures.
   * Used by the self-healing loop to surface build/TS errors the passive
   * dev-server capture may miss.
   */
  public async verifyBuild(
    onOutput?: (data: string) => void,
  ): Promise<{ code: number; output: string }> {
    let output = '';
    const collect = (d: string) => {
      output += d;
      onOutput?.(d);
    };
    try {
      const code = await withTimeout(
        this.spawnAndWait('npx', ['vite', 'build', '--logLevel', 'warn'], collect),
        NPM_INSTALL_TIMEOUT_MS,
        'vite build',
      );
      return { code, output: stripAnsi(output) };
    } catch (err) {
      // Timeout or spawn failure — treat as inconclusive, not a hard error.
      const msg = err instanceof Error ? err.message : String(err);
      return { code: 0, output: `(build check skipped: ${msg})` };
    }
  }

  public async boot(): Promise<WebContainer> {
    const state = this.state;

    if (state.container) {
      return state.container;
    }

    if (state.bootPromise) {
      return state.bootPromise;
    }

    state.bootPromise = (async () => {
      try {
        const wc = await withTimeout(WebContainer.boot(), BOOT_TIMEOUT_MS, 'WebContainer boot');
        state.container = wc;
        this.attachServerListener(wc);

        if (!state.projectMounted) {
          await wc.mount(DEFAULT_PROJECT_FILES);
          state.projectMounted = true;
        }

        return wc;
      } catch (error) {
        if (isSingleInstanceBootError(error) && state.container) {
          console.warn('[WebContainer] Reusing existing instance after boot guard');
          return state.container;
        }
        state.bootPromise = null;
        throw error;
      }
    })();

    return state.bootPromise;
  }

  /** Boot + static preview + background npm/vite — runs once per browser tab (survives HMR) */
  public async ensureStudioReady(): Promise<void> {
    const state = this.state;
    // If we have a promise but no dev server URL and it's not installing, we might be stuck.
    // However, the promise might still be resolving. Let's just return it if it's there.
    if (state.studioInitPromise) {
      // If we are marked as ready but have no URL, something broke. Clear and retry.
      if (state.initPhase === 'ready' && !state.devServerUrl) {
        console.warn('[WebContainer] State is ready but no devServerUrl. Retrying init.');
        state.studioInitPromise = null;
        state.staticServerStartRequested = false;
        state.viteServerStartRequested = false;
      } else {
        return state.studioInitPromise;
      }
    }

    state.studioInitPromise = (async () => {
      if (!state.container) {
        this.setInitPhase('booting');
        await this.boot();
      }

      // Phase 1: instant static preview (Node built-ins only — no npm install).
      if (!state.staticServerStartRequested) {
        state.staticServerStartRequested = true;
        this.setInitPhase('starting-preview');
        void this.runCommand('node', ['preview-server.mjs']).catch((err) => {
          console.warn('[WebContainer] Static preview server warning:', err);
        });
      }

      const needsNpm = await this.projectHasNpmDependencies();
      if (needsNpm) {
        this.setInitPhase('installing');
        state.npmInstallInProgress = true;
        try {
          await this.ensureDependenciesInstalled();
        } catch (err) {
          console.warn('[WebContainer] Dependency install failed (static preview still works):', err);
        } finally {
          state.npmInstallInProgress = false;
          if (!state.viteReady && state.devServerUrl) {
            this.setInitPhase('ready');
          }
        }
      }

      // Phase 2: Vite dev server for HMR + npm module resolution (background upgrade).
      if (!state.viteServerStartRequested && (await this.hasViteDevScript())) {
        state.viteServerStartRequested = true;
        state.devServerStartRequested = true;
        if (needsNpm && !state.viteReady) {
          this.setInitPhase('starting-preview');
        }
        void this.runCommand('npm', ['run', 'start'], (chunk) =>
          this.recordDevServerOutput(chunk),
        ).catch((err) => {
          console.warn('[WebContainer] Dev server start warning:', err);
        });
      } else if (!state.devServerUrl) {
        this.setInitPhase('starting-preview');
      }
    })().catch((err) => {
      state.studioInitPromise = null;
      throw err;
    });

    return state.studioInitPromise;
  }

  private async projectHasNpmDependencies(): Promise<boolean> {
    const pkg = await this.readPackageJson();
    if (!pkg) return false;
    const deps = Object.keys(pkg.dependencies ?? {}).length;
    const devDeps = Object.keys(pkg.devDependencies ?? {}).length;
    return deps + devDeps > 0;
  }

  private async hasViteDevScript(): Promise<boolean> {
    const pkg = await this.readPackageJson();
    return Boolean(pkg?.scripts?.start || pkg?.scripts?.dev);
  }

  private async ensureDir(path: string) {
    const instance = await this.boot();
    const parts = path.split('/').slice(0, -1);
    let current = '';
    for (const part of parts) {
      if (!part) continue;
      current += (current ? '/' : '') + part;
      try {
        await instance.fs.mkdir(current);
      } catch {
        // exists
      }
    }
  }

  public async writeFiles(files: Record<string, string>): Promise<void> {
    const instance = await this.boot();

    for (const [path, content] of Object.entries(files)) {
      const cleanPath = path.startsWith('/') ? path.substring(1) : path;
      await this.ensureDir(cleanPath);
      await instance.fs.writeFile(cleanPath, content);
      if (cleanPath === 'package.json' || cleanPath.endsWith('/package.json')) {
        this.invalidateDepsCache();
      }
    }
  }

  /** Writes raw binary data (e.g. a generated PNG/WAV asset) into the project. */
  public async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    const instance = await this.boot();
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    await this.ensureDir(cleanPath);
    await instance.fs.writeFile(cleanPath, data);
  }

  public invalidateDepsCache(): void {
    this.installedDepsFingerprint = null;
  }

  private async readPackageJson(): Promise<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  } | null> {
    try {
      const raw = await this.readFile('package.json');
      return JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
    } catch {
      return null;
    }
  }

  private async nodeModulesPresent(): Promise<boolean> {
    const instance = await this.boot();
    try {
      const entries = await instance.fs.readdir('node_modules');
      return Array.isArray(entries) && entries.length > 0;
    } catch {
      return false;
    }
  }

  private async isPackagePresentInNodeModules(packageName: string): Promise<boolean> {
    const instance = await this.boot();
    const { name } = parsePackageSpec(packageName);
    try {
      await instance.fs.readdir(`node_modules/${name}`);
      return true;
    } catch {
      return false;
    }
  }

  public async ensureDependenciesInstalled(onOutput?: (data: string) => void): Promise<number> {
    const pkg = await this.readPackageJson();
    if (!pkg) return 0;

    const fp = packageFingerprint(pkg);
    if ((await this.nodeModulesPresent()) && this.installedDepsFingerprint === fp) {
      return 0;
    }

    if (this.fullInstallPromise) {
      return this.fullInstallPromise;
    }

    this.fullInstallPromise = (async () => {
      console.log('[WebContainer] npm install (deps changed or missing node_modules)');
      this.state.npmInstallInProgress = true;
      try {
        const code = await withTimeout(
          this.spawnAndWait('npm', ['install'], onOutput),
          NPM_INSTALL_TIMEOUT_MS,
          'npm install'
        );
        if (code === 0) {
          this.installedDepsFingerprint = fp;
        }
        return code;
      } finally {
        this.state.npmInstallInProgress = false;
      }
    })().finally(() => {
      this.fullInstallPromise = null;
    });

    return this.fullInstallPromise;
  }

  public async installPackage(
    packageName: string,
    onOutput?: (data: string) => void
  ): Promise<{ code: number; skipped: boolean }> {
    const { name, version } = parsePackageSpec(packageName);
    if (!name) return { code: 1, skipped: false };

    let pkg = await this.readPackageJson();
    if (!pkg) return { code: 1, skipped: false };

    const fp = packageFingerprint(pkg);
    const listed = isListedInPackageJson(pkg, name);
    const present = await this.isPackagePresentInNodeModules(name);

    if (listed && present && this.installedDepsFingerprint === fp) {
      console.log(`[WebContainer] skip install — ${name} already installed`);
      return { code: 0, skipped: true };
    }

    if (!listed) {
      pkg = {
        ...pkg,
        dependencies: {
          ...(pkg.dependencies ?? {}),
          [name]: version || 'latest',
        },
      };
      await this.writeFiles({
        'package.json': JSON.stringify(pkg, null, 2),
      });
    }

    const code = await this.ensureDependenciesInstalled(onOutput);
    return { code, skipped: false };
  }

  public async runCommand(
    command: string,
    args: string[],
    onOutput?: (data: string) => void
  ): Promise<number> {
    if (command === 'npm' && args[0] === 'install' && args.length === 1) {
      return this.ensureDependenciesInstalled(onOutput);
    }

    return this.spawnAndWait(command, args, onOutput);
  }

  /** Spawns a process and waits for exit — does not redirect npm install. */
  private async spawnAndWait(
    command: string,
    args: string[],
    onOutput?: (data: string) => void
  ): Promise<number> {
    const instance = await this.boot();
    const process = await instance.spawn(command, args);

    if (onOutput) {
      process.output.pipeTo(
        new WritableStream({
          write(data) {
            onOutput(data);
          },
        })
      );
    }

    return process.exit;
  }

  public async readFile(path: string): Promise<string> {
    const instance = await this.boot();
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    return instance.fs.readFile(cleanPath, 'utf-8');
  }

  public async mkdir(path: string): Promise<void> {
    const instance = await this.boot();
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    await instance.fs.mkdir(cleanPath, { recursive: true });
  }

  public async removePath(path: string): Promise<void> {
    const instance = await this.boot();
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    try {
      await instance.fs.rm(cleanPath, { recursive: true, force: true });
    } catch {
      /* may not exist yet */
    }
  }

  public async renamePath(oldPath: string, newPath: string): Promise<void> {
    const instance = await this.boot();
    const cleanOld = oldPath.startsWith('/') ? oldPath.substring(1) : oldPath;
    const cleanNew = newPath.startsWith('/') ? newPath.substring(1) : newPath;
    await instance.fs.rename(cleanOld, cleanNew);
  }

  public getPreviewUrl(): string | null {
    return this.state.devServerUrl;
  }

  /** True when WebContainer has finished booting (singleton may already exist). */
  public isBooted(): boolean {
    return this.state.container !== null;
  }

  /** True while npm install / dev-server startup is still in flight. */
  public isStudioInitPending(): boolean {
    return (
      this.state.studioInitPromise !== null &&
      this.state.devServerUrl === null &&
      this.state.initPhase !== 'ready'
    );
  }

  /**
   * Spawns WebContainer's interactive shell (jsh) and wires it to an xterm
   * instance. Returns handles to send keystrokes and resize the PTY.
   */
  public async attachInteractiveShell(options: {
    cols: number;
    rows: number;
    onOutput: (data: string) => void;
  }): Promise<{ write: (data: string) => void; resize: (cols: number, rows: number) => void; kill: () => void }> {
    const instance = await this.boot();
    // Best-effort: ensure default project files + deps exist before opening shell.
    try {
      await this.ensureStudioReady();
    } catch (err) {
      console.warn('[WebContainer] Shell opened before studio init finished:', err);
    }

    const process = await instance.spawn('jsh', {
      terminal: { cols: options.cols, rows: options.rows },
    });

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          options.onOutput(data);
        },
      }),
    );

    const writer = process.input.getWriter();

    return {
      write: (data: string) => {
        void writer.write(data);
      },
      resize: (cols: number, rows: number) => {
        process.resize({ cols, rows });
      },
      kill: () => {
        process.kill();
        void writer.close();
      },
    };
  }
}

export const webContainerManager = WebContainerManager.getInstance();
