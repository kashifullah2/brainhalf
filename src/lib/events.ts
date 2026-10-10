type FileMap = Record<string, string>;

export type GenerationStatusPayload = {
  status: string;
  detail?: string;
  file?: string;
  error?: string;
  projectId?: string;
};

type AppEventMap = {
  'auto-fix-error': { projectId?: string; error: string; file?: string; layer?: 'backend' | 'frontend' };
  'clear-workspace': null | undefined;
  'execute-command': { command: string; requestId: string };
  'file-deleted': { path: string; projectId?: string };
  'file-generated': { path: string; content: string; isComplete?: boolean; projectId?: string };
  'files-refreshed': FileMap;
  'generation-mode': { mode: 'full' | 'incremental' };
  'generation-status': GenerationStatusPayload;
  'stop-generation-request': { projectId: string };
  'repair-project-request': { projectId: string; message: string; onAccepted: () => void };
  'runtime-status': { projectId: string; running: boolean; deleted?: boolean };
  'merge-conflict': { sourceName: string; conflicts: string[] };
  'open-project-console': undefined;
  'open-file': { path: string };
  'open-github-modal': undefined;
  'platform-status-sync': { status?: string; detail?: string; projectId?: string };
  'preview-success': null | undefined;
  'preview-state': { projectId: string; state: 'loading' | 'ready' | 'error'; error?: string };
  'project-account-changed': undefined;
  'project-list-updated': undefined;
  'project-messages-updated': { projectId?: string } | undefined;
  'project-ownership-denied': { projectId: string; reason?: string } | undefined;
  'project-renamed': { id: string; name: string };
  'project-switched': { projectId: string };
  'insert-prompt-draft': { prompt: string } | undefined;
  'screenshot-fix-request': { projectId: string };
  'request-export': { projectName?: string };
  'request-workspace-context': { requestId: string };
  'sync-files': { files: FileMap; replaceAll?: boolean };
  'trigger-auto-reply': { message: string };
  'idb-unavailable': undefined;
  'workspace-files-changed': { projectId: string; files: FileMap };
  'workspace-files-synced': { projectId: string; revision: number };
  'workspace-session-ready': { projectId: string };
  'workspace-sync-error': { projectId: string; error: string };
};

type Listener = (payload: unknown) => void;
type EmitArgs<P> = [P] extends [undefined]
  ? [] | [P]
  : [P] extends [null | undefined]
    ? [] | [P]
    : [P];
type WorkspaceContextResponseEvent = `workspace-context-response-${string}`;
type CommandResultEvent = `command-result-${string}`;
type WorkspaceContextResponsePayload = { files?: FileMap } | undefined;
type CommandResultPayload = { output: string; ok: boolean; unsupported?: boolean } | undefined;

export class EventEmitter {
  events: Record<string, Listener[]> = {};

  on<K extends keyof AppEventMap & string>(event: K, listener: (payload: AppEventMap[K]) => void): () => void;
  on(event: WorkspaceContextResponseEvent, listener: (payload: WorkspaceContextResponsePayload) => void): () => void;
  on(event: CommandResultEvent, listener: (payload: CommandResultPayload) => void): () => void;
  on(event: string, listener: (payload: unknown) => void): () => void;
  on(event: string, listener: any): () => void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener as Listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof AppEventMap & string>(event: K, listener: (payload: AppEventMap[K]) => void): void;
  off(event: WorkspaceContextResponseEvent, listener: (payload: WorkspaceContextResponsePayload) => void): void;
  off(event: CommandResultEvent, listener: (payload: CommandResultPayload) => void): void;
  off(event: string, listener: (payload: unknown) => void): void;
  off(event: string, listener: any): void {
    if (!this.events[event]) return;
    this.events[event] = this.events[event].filter((registered) => registered !== (listener as Listener));
    if (this.events[event].length === 0) {
      delete this.events[event];
    }
  }

  emit<K extends keyof AppEventMap & string>(event: K, ...args: EmitArgs<AppEventMap[K]>): void;
  emit(event: WorkspaceContextResponseEvent, ...args: EmitArgs<WorkspaceContextResponsePayload>): void;
  emit(event: CommandResultEvent, ...args: EmitArgs<CommandResultPayload>): void;
  emit(event: string, payload?: unknown): void;
  emit(event: string, ...args: any[]): void {
    const payload = args[0];
    if (!this.events[event]) return;
    const listeners = [...this.events[event]];
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`Error in event listener for "${event}":`, err);
      }
    }
  }
}

export const appEvents = new EventEmitter();
