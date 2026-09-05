import { create } from 'zustand';
import { DEFAULT_INDEX_HTML, DEFAULT_GAME_JS, DEFAULT_PACKAGE_JSON } from '../lib/default-project';

export interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  parentId: string | null;
  content?: string;
  isDirty?: boolean;
  path?: string; // full relative path e.g. "src/game.js"
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { id: string; type: string; message: string; status: 'loading' | 'done' }[];
}

export type RepairStatus = 'detected' | 'repairing' | 'verifying' | 'fixed' | 'failed';

/** A single self-healing repair attempt, surfaced in the UI and logged. */
export interface RepairAttempt {
  id: string;
  /** 1-based attempt number. */
  attempt: number;
  maxAttempts: number;
  status: RepairStatus;
  /** Short category summary, e.g. "2 vite, 1 runtime". */
  summary: string;
  errors: { category: string; message: string; file?: string }[];
  startedAt: number;
  finishedAt?: number;
}

interface StudioState {
  projectFiles: FileNode[];
  openFiles: string[]; // file ids
  activeFileId: string | null;
  generationStatus: 'idle' | 'generating' | 'ready';
  agentMessages: AgentMessage[];
  credits: number;
  projectId: string | null;
  projectTitle: string;
  gameType: '2D' | '3D';
  saveStatus: 'Saved' | 'Unsaved changes';
  aiModel: string;
  
  // Actions
  setProjectFiles: (files: FileNode[]) => void;
  openFile: (id: string) => void;
  closeFile: (id: string) => void;
  setActiveFile: (id: string) => void;
  updateFileContent: (id: string, content: string) => void;
  addAgentMessage: (msg: AgentMessage) => void;
  updateAgentMessage: (id: string, partialMsg: Partial<AgentMessage>) => void;
  markFilesPersisted: (ids: string[]) => void;
  setProjectId: (id: string | null) => void;
  setProjectTitle: (title: string) => void;
  setSaveStatus: (status: 'Saved' | 'Unsaved changes') => void;
  setAiModel: (model: string) => void;
  initializeGreeting: (greeting: string) => void;
  
  // Agent state
  isGenerating: boolean;
  setIsGenerating: (isGenerating: boolean) => void;
  currentJobId: string | null;
  setCurrentJobId: (id: string | null) => void;
  generationProgress: number;
  setGenerationProgress: (progress: number) => void;
  creditsUsed: number;
  setCreditsUsed: (credits: number) => void;
  deductCredits: (amount: number) => void;
  /** null = session not checked yet */
  isSignedIn: boolean | null;
  setIsSignedIn: (signedIn: boolean) => void;

  /** Path within the Vite dev server for the preview iframe (e.g. `/tetris.html`). */
  previewPath: string;
  /** Incremented to force the preview iframe to reload after file changes. */
  previewReloadKey: number;
  setPreviewPath: (path: string) => void;
  bumpPreviewReload: () => void;

  /** Self-healing repair attempts for the current generation (newest last). */
  repairHistory: RepairAttempt[];
  startRepairAttempt: (attempt: RepairAttempt) => void;
  updateRepairAttempt: (id: string, partial: Partial<RepairAttempt>) => void;
  clearRepairHistory: () => void;
}

const initialFiles: FileNode[] = [
  { id: '0', name: 'package.json', type: 'file',   parentId: null,  path: 'package.json', content: DEFAULT_PACKAGE_JSON },
  { id: '1', name: 'index.html', type: 'file',   parentId: null,  path: 'index.html', content: DEFAULT_INDEX_HTML },
  { id: '3', name: 'public',     type: 'folder', parentId: null,  path: 'public' },
  { id: '4', name: 'src',        type: 'folder', parentId: null,  path: 'src' },
  { id: '5', name: 'game.js',    type: 'file',   parentId: '4',   path: 'src/game.js', content: DEFAULT_GAME_JS },
  { id: '6', name: 'physics.js', type: 'file',   parentId: '4',   path: 'src/physics.js', content: 'export const applyPhysics = () => {};' },
  { id: '7', name: 'assets',     type: 'folder', parentId: null,  path: 'assets' },
  { id: '8', name: 'textures',   type: 'folder', parentId: '7',   path: 'assets/textures' },
  { id: '9', name: 'models',     type: 'folder', parentId: '7',   path: 'assets/models' },
];

export const useStudioStore = create<StudioState>((set) => ({
  projectFiles: initialFiles,
  openFiles: ['5'],
  activeFileId: '5',
  generationStatus: 'idle',
  agentMessages: [],
  credits: 0,
  projectId: null,
  projectTitle: 'Untitled Game',
  gameType: '3D',
  saveStatus: 'Saved',
  aiModel: 'claude-3-5-sonnet-20240620',
  isGenerating: false,
  currentJobId: null,
  generationProgress: 0,
  creditsUsed: 0,
  isSignedIn: null,
  previewPath: '/',
  previewReloadKey: 0,

  setProjectFiles: (files) => set({ projectFiles: files }),
  openFile: (id) => set((state) => {
    if (!state.openFiles.includes(id)) {
      return { openFiles: [...state.openFiles, id], activeFileId: id };
    }
    return { activeFileId: id };
  }),
  closeFile: (id) => set((state) => {
    const newOpenFiles = state.openFiles.filter(fId => fId !== id);
    return {
      openFiles: newOpenFiles,
      activeFileId: state.activeFileId === id ? (newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null) : state.activeFileId
    };
  }),
  setActiveFile: (id) => set({ activeFileId: id }),
  updateFileContent: (id, content) => set((state) => ({
    saveStatus: 'Unsaved changes',
    projectFiles: state.projectFiles.map(f => f.id === id ? { ...f, content, isDirty: true } : f)
  })),
  addAgentMessage: (msg) => set((state) => ({ agentMessages: [...state.agentMessages, msg] })),
  updateAgentMessage: (id, partialMsg) => set((state) => ({
    agentMessages: state.agentMessages.map(msg => msg.id === id ? { ...msg, ...partialMsg } : msg)
  })),
  markFilesPersisted: (ids) => set((state) => {
    const idSet = new Set(ids);
    const projectFiles = state.projectFiles.map(f =>
      idSet.has(f.id) ? { ...f, isDirty: false } : f
    );
    const anyDirty = projectFiles.some(f => f.type === 'file' && f.isDirty);
    return { projectFiles, saveStatus: anyDirty ? 'Unsaved changes' : 'Saved' };
  }),
  setProjectId: (id) => set({ projectId: id }),
  setProjectTitle: (title) => set({ projectTitle: title }),
  setSaveStatus: (status) => set({ saveStatus: status }),
  setAiModel: (aiModel) => set({ aiModel }),
  initializeGreeting: (greeting) => set((state) => ({
    agentMessages: state.agentMessages.length === 1 && state.agentMessages[0].id === 'm1'
      ? [{ ...state.agentMessages[0], content: greeting }]
      : state.agentMessages
  })),
  setIsGenerating: (isGenerating) => set({ isGenerating }),
  setCurrentJobId: (currentJobId) => set({ currentJobId }),
  setGenerationProgress: (generationProgress) => set({ generationProgress }),
  setCreditsUsed: (creditsUsed) => set({ creditsUsed }),
  deductCredits: (amount) => set((state) => ({ credits: Math.max(0, state.credits - amount) })),
  setIsSignedIn: (isSignedIn) => set({ isSignedIn }),
  setPreviewPath: (previewPath) => set({ previewPath }),
  bumpPreviewReload: () => set((state) => ({ previewReloadKey: state.previewReloadKey + 1 })),

  repairHistory: [],
  startRepairAttempt: (attempt) =>
    set((state) => ({ repairHistory: [...state.repairHistory, attempt] })),
  updateRepairAttempt: (id, partial) =>
    set((state) => ({
      repairHistory: state.repairHistory.map((r) =>
        r.id === id ? { ...r, ...partial } : r,
      ),
    })),
  clearRepairHistory: () => set({ repairHistory: [] }),
}));
