import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2, X, User, CheckCircle2, ArrowRight, Square, Pencil, Undo2, Sparkles, SlidersHorizontal, ArrowDown, Mic, Plus, Copy, Check, ArrowUp } from 'lucide-react';
import { appEvents } from '../lib/events';
import { parseMessageSegments, parseMessageSegmentsMemoized, applyEditsToFile, type CodeEdit, type ParseResult } from '../lib/message-parser';
import { normalizePath } from '../lib/utils';
import { getProjectFiles, getProjectMessages, saveProjectMessages, deleteProjectMessages, getProjectFilesAsync, saveProjectFiles, getProjects, updateProjectName, setActiveProjectId, deleteProject } from '../lib/project-store';
import { getToken, verifyStoredSession, withWsAuthQuery, authFetch } from '../lib/auth-client';
import CodeFileBlock from './CodeFileBlock';
import DiffEditBlock from './DiffEditBlock';
import CommandBlock from './CommandBlock';
import PlanBlock from './PlanBlock';
import ConfirmModal from './ConfirmModal';
import { usePlatformStatus } from '../lib/status-store';
import { CLIENT_SELECTABLE_MODELS, type ModelProvider } from '../lib/models';
import BrainHalfLogo from './BrainHalfLogo';

const STARTER_PROMPTS = [
  { title: 'Full-Stack E-commerce Store', desc: 'React frontend with an Express API for products & cart' },
  { title: 'Real-time Chat App', desc: 'React UI with a WebSocket backend and user presence' },
  { title: 'SaaS Dashboard with Auth', desc: 'Full-stack metrics dashboard with simulated authentication' },
  { title: 'Interactive Kanban Board', desc: 'Drag-and-drop tasks with column states & tags' },
];

interface ModelDef {
  id: string;
  name: string;
  provider: ModelProvider;
  category: 'recommended' | 'coding' | 'fast' | 'reasoning';
  speed?: string;
  badge?: string;
}

/**
 * Presentation metadata for each selectable model. The ids and providers come
 * from the server's allowlist (CLIENT_SELECTABLE_MODELS), so this map can only
 * describe a model the backend will actually accept — it can never add one.
 * An allowlist entry without an entry here still renders, labelled by its id.
 */
const MODEL_DISPLAY: Record<string, Omit<ModelDef, 'id' | 'provider'>> = {
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { name: 'Llama 3.3 70B (Recommended)', category: 'recommended', speed: '72 t/s', badge: 'Flagship' },
  '@cf/openai/gpt-oss-20b': { name: 'GPT-OSS 20B (Ultra-Fast 114 t/s)', category: 'fast', speed: '114 t/s', badge: 'Ultra-Fast' },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { name: 'Llama 4 Scout 17B (Next-Gen)', category: 'coding', speed: '58 t/s', badge: 'Next-Gen' },
  '@cf/openai/gpt-oss-120b': { name: 'GPT-OSS 120B (High-Capacity)', category: 'reasoning', speed: '51 t/s', badge: 'Heavyweight' },
  '@cf/moonshotai/kimi-k2.7-code': { name: 'Kimi K2.7 Code (200k Context)', category: 'coding', speed: '100 t/s', badge: '200k' },
  '@cf/qwen/qwen2.5-coder-32b-instruct': { name: 'Qwen 2.5 Coder 32B', category: 'coding', speed: '35 t/s', badge: 'Coder' },
  '@cf/qwen/qwen3.8-27b': { name: 'Qwen 3.8 27B', category: 'coding', speed: '32 t/s', badge: 'Qwen 3.8' },
  '@cf/zai-org/glm-5.3-flash': { name: 'GLM 5.3 Flash', category: 'fast', speed: '95 t/s', badge: 'Flash' },
  'claude-sonnet-4.6': { name: 'Claude 4.6 Sonnet', category: 'coding', badge: 'Sonnet' },
  'claude-opus-4.6': { name: 'Claude 4.6 Opus', category: 'reasoning', badge: 'Opus' },
  'minimax-m2.5': { name: 'MiniMax m2.5', category: 'fast', badge: 'MiniMax' },
  'kimi-k3': { name: 'Kimi K3 v1 (1M Context)', category: 'reasoning', speed: '90 t/s', badge: '1M Context' },
  'Atria-Dawn-Preview': { name: 'Atria Dawn Preview', category: 'reasoning', badge: 'Atria ASI' },
};

const MODELS: ModelDef[] = CLIENT_SELECTABLE_MODELS.map((m) => ({
  id: m.name,
  provider: m.provider,
  ...(MODEL_DISPLAY[m.name] ?? { name: m.name, category: 'fast' as const }),
}));

interface Message {
  role: 'user' | 'ai';
  content: string;
  /** When the message was created; absent for rows that carry no time. */
  timestamp?: number;
}

/**
 * The message list re-renders on every token of a streaming response, and every
 * row parses its own content on each of those renders. All but the streaming row
 * have content that has not changed since the last frame, so the parse is
 * memoised in the parser module and re-run only when the content actually moves.
 */
function memoizedParse(content: string, includeStreaming: boolean): ParseResult {
  return parseMessageSegmentsMemoized(content, includeStreaming);
}

/** Matches the "Sep 18, 09:38 AM" shape the panel previously hard-coded. */
function formatMessageTime(timestamp?: number): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
  try {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch {
    return null;
  }
}

interface ChatPanelProps {
  activeProjectId?: string;
  width?: number;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ activeProjectId = 'default', width, initialPrompt, onInitialPromptConsumed }) => {
  const [input, setInput] = useState('');
  const [selectedModelId, setSelectedModelId] = useState(MODELS[0].id);
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = getProjectMessages(activeProjectId);
    if (saved && saved.length > 0) return saved;
    return [];
  });
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [confirmModalConfig, setConfirmModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);
  const [_isConnected, setIsConnected] = useState(false);
  const platformStatus = usePlatformStatus(activeProjectId);
  const [mergeConflict, setMergeConflict] = useState<{ sourceName: string; conflicts: string[] } | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isScrolledUp = target.scrollHeight - target.scrollTop - target.clientHeight > 120;
    setShowScrollBottom(isScrolledUp && messages.length > 2);
  };

  useEffect(() => {
    const unsubConflict = appEvents.on('merge-conflict', (data: { sourceName: string; conflicts: string[] }) => {
      setMergeConflict(data);
    });
    return () => {
      unsubConflict();
    };
  }, []);
  const [imageType, setImageType] = useState<string>('');
  const [hoveredMessageIndex, setHoveredMessageIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectRef = useRef<(() => Promise<void>) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      if (input.trim()) {
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
      }
    }
  }, [input]);

  const isGeneratingRef = useRef(false);
  const messagesRef = useRef<Message[]>(messages);

  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isGenerating) {
      startTimeRef.current = null;
      return;
    }
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // File parsing & workspace state
  const bufferRef = useRef('');
  const aiMessageRef = useRef('');
  const currentFilesRef = useRef<Record<string, string>>(getProjectFiles(activeProjectId) || {});
  const preGenerationFilesRef = useRef<Record<string, string>>({});
  const currentGenIdRef = useRef(0);
  const pendingSendRef = useRef<((ws: WebSocket) => void) | null>(null);

  useEffect(() => {
    currentFilesRef.current = getProjectFiles(activeProjectId) || {};
  }, [activeProjectId]);

  // RAF throttle: pending token queue to avoid calling setMessages on every token
  const pendingTokensRef = useRef('');
  const rafHandleRef = useRef<number | null>(null);
  // Stable ref so the WS onmessage handler always calls the latest handleStopGeneration
  // without needing to re-subscribe every time activeProjectId changes.
  const handleStopGenerationRef = useRef<() => void>(() => {});

  // Auto-send support: when landing page passes an initialPrompt for a brand-new project
  const pendingAutoSendRef = useRef<string | null>(null);
  const handleSendMessageRef = useRef<((override?: string) => void) | null>(null);
  const onInitialPromptConsumedRef = useRef(onInitialPromptConsumed);
  useEffect(() => { onInitialPromptConsumedRef.current = onInitialPromptConsumed; }, [onInitialPromptConsumed]);
  useEffect(() => {
    if (initialPrompt) pendingAutoSendRef.current = initialPrompt;
  }, [initialPrompt]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;
    let isMounted = true;

    const syncFilesAndEdits = (
      fileMap: Record<string, string>,
      editsMap: Record<string, CodeEdit[]>,
      isComplete: boolean = true
    ) => {
      for (const [path, content] of Object.entries(fileMap)) {
        const cleanPath = normalizePath(path);
        currentFilesRef.current[cleanPath] = content;
        appEvents.emit('file-generated', { path: cleanPath, content, isComplete });
      }

      for (const [path, edits] of Object.entries(editsMap)) {
        const cleanPath = normalizePath(path);
        const existing = currentFilesRef.current[cleanPath] || '';
        if (existing && edits.length > 0) {
          const updated = applyEditsToFile(existing, edits);
          currentFilesRef.current[cleanPath] = updated;
          appEvents.emit('file-generated', { path: cleanPath, content: updated, isComplete });
        }
      }
    };

    let connectAttempts = 0;

    const connect = async () => {
      connectRef.current = connect;
      // Same-origin is correct in production (the Worker terminates the WS) and
      // in local dev, where the assets are served from the same host:port as
      // wrangler. VITE_BACKEND_HOST is still honored as an explicit override,
      // e.g. when the vite dev server (5173) needs to reach wrangler (8788).
      // It must never fall back to the production host: a dev shell that
      // silently talks to the real backend is a debugging trap and leaks local
      // session tokens to production.
      const backendHost = import.meta.env.VITE_BACKEND_HOST || window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

      const wsUrl = `${protocol}//${backendHost}/agents/chat-agent/${activeProjectId}`;
      // Browsers cannot set headers on a WebSocket upgrade, so a single-use
      // ticket rides in the query string and the Worker redeems it before the
      // Durable Object is ever reached. The session token itself never lands in
      // a URL.
      const authedUrl = await withWsAuthQuery(wsUrl);
      if (authedUrl === wsUrl) {
        // No credential at all — the user genuinely has no session.
        // Dispatch session-expired so the app redirects to login.
        console.warn('No session credential available for WebSocket; triggering sign-in.');
        setIsConnected(false);
        setIsGenerating(false);
        isGeneratingRef.current = false;
        appEvents.emit('generation-status', {
          status: 'Error',
          error: 'Session expired. Please sign in again.',
        });
        window.dispatchEvent(new CustomEvent('bh-session-expired'));
        return;
      }
      console.log(`Connecting to Durable Object session: ${activeProjectId}`);

      ws = new WebSocket(authedUrl);
      wsRef.current = ws;

      let pingInterval: any = null;

      ws.onopen = () => {
        if (!isMounted) return;
        setIsConnected(true);
        console.log(`Connected to session: ${activeProjectId}`);

        // Reset the attempt counter only after the connection has survived
        // long enough to receive a message. An open-then-immediate-close
        // (e.g. the DO rejecting ownership) must not reset the counter or
        // the backoff cap is defeated and the client loops forever.
        const stableTimer = setTimeout(() => { connectAttempts = 0; }, 2000);
        ws!.addEventListener('close', () => clearTimeout(stableTimer), { once: true });

        // Keep WebSocket alive across long reasoning/generation phases
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch { }
          }
        }, 20000);
        
        // Request the workspace context to sync current files on connect
        const handleWsConnectSync = (data: { files: any }) => {
          appEvents.off('workspace-context-response-ws-connect', handleWsConnectSync);
          if (data.files) {
            currentFilesRef.current = { ...data.files };
          }
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'sync_files', files: data.files }));
          }
        };
        appEvents.on('workspace-context-response-ws-connect', handleWsConnectSync);
        appEvents.emit('request-workspace-context', { requestId: 'ws-connect' });

        if (pendingSendRef.current && ws) {
          const sendFn = pendingSendRef.current;
          pendingSendRef.current = null;
          sendFn(ws);
        }
      };

      ws.onmessage = async (event) => {
        if (!isMounted) return;
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'history') {
            if (Array.isArray(data.data) && data.data.length > 0) {
              const loadedMsgs: Message[] = data.data.map((m: any) => ({
                role: m.role === 'assistant' || m.role === 'ai' ? 'ai' : 'user',
                content: m.content
              }));
              setMessages(loadedMsgs);
              messagesRef.current = loadedMsgs;
              saveProjectMessages(activeProjectId, loadedMsgs);

              // Rehydrate files into workspace from previous history
              for (const msg of loadedMsgs) {
                if (msg.role === 'ai') {
                  const { fileMap, editsMap } = parseMessageSegments(msg.content, true);
                  syncFilesAndEdits(fileMap, editsMap, true);
                }
              }
              appEvents.emit('generation-status', { status: 'Ready', detail: 'Loaded saved session', projectId: activeProjectId });
            } else if (pendingAutoSendRef.current) {
              // Landing page submitted a prompt — always takes priority over
              // any locally-cached messages that may have leaked in before the
              // WS history arrived.
              const autoPrompt = pendingAutoSendRef.current;
              pendingAutoSendRef.current = null;
              onInitialPromptConsumedRef.current?.();
              deleteProjectMessages(activeProjectId);
              setTimeout(() => { handleSendMessageRef.current?.(autoPrompt); }, 60);
            } else {
              const localSaved = getProjectMessages(activeProjectId);
              if (!localSaved || localSaved.length === 0) {
                const freshWelcome: Message[] = [
                  { role: 'ai', content: 'What kind of application would you like to build today? For example, "Create a crypto tracker app."' }
                ];
                setMessages(freshWelcome);
                messagesRef.current = freshWelcome;
                saveProjectMessages(activeProjectId, freshWelcome);
                appEvents.emit('generation-status', { status: 'Ready', detail: 'Fresh project ready', projectId: activeProjectId });
              } else {
                setMessages(localSaved);
                messagesRef.current = localSaved;
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'rewrite_history', messages: localSaved }));
                }
              }
            }
          } else if (data.type === 'stream') {
            if (!isGeneratingRef.current) return;
            if (data.chunk?.response) {
              const text = data.chunk.response;
              bufferRef.current += text;
              aiMessageRef.current += text;
              pendingTokensRef.current += text;

              // Schedule a single RAF flush rather than processing every token immediately.
              // This batches up to ~16ms of tokens into one React render pass.
              if (rafHandleRef.current === null) {
                rafHandleRef.current = requestAnimationFrame(() => {
                  rafHandleRef.current = null;
                  if (!pendingTokensRef.current) return;
                  pendingTokensRef.current = '';

                  // Parse files and edits into file map without leaking raw wrapper tags
                  const { segments } = parseMessageSegments(bufferRef.current, false);

                  // Sync files & targeted patches to workspace
                  for (const seg of segments) {
                    if (seg.type === 'file') {
                      const cleanPath = normalizePath(seg.path);
                      currentFilesRef.current[cleanPath] = seg.content;
                      appEvents.emit('file-generated', {
                        path: cleanPath,
                        content: seg.content,
                        isComplete: !seg.isStreaming
                      });
                    } else if (seg.type === 'edit') {
                      const cleanPath = normalizePath(seg.path);
                      const existing = currentFilesRef.current[cleanPath] || '';
                      if (existing && seg.edits.length > 0) {
                        const updated = applyEditsToFile(existing, seg.edits);
                        if (updated !== existing) {
                          currentFilesRef.current[cleanPath] = updated;
                          appEvents.emit('file-generated', {
                            path: cleanPath,
                            content: updated,
                            isComplete: !seg.isStreaming
                          });
                        }
                      }
                    }
                  }

                  // Notify workspace of active file being generated or patched
                  const activeEditSeg = segments.filter(s => s.type === 'edit').pop();
                  const activeFileSeg = segments.filter(s => s.type === 'file').pop();

                  if (activeEditSeg && activeEditSeg.type === 'edit' && activeEditSeg.isStreaming) {
                    appEvents.emit('generation-status', {
                      status: 'Generating',
                      detail: `Patching ${activeEditSeg.path}...`,
                      file: activeEditSeg.path
                    });
                  } else if (activeFileSeg && activeFileSeg.type === 'file' && activeFileSeg.isStreaming) {
                    appEvents.emit('generation-status', {
                      status: 'Generating',
                      detail: `Writing ${activeFileSeg.path}...`,
                      file: activeFileSeg.path
                    });
                  }

                  // Single batched state update for all tokens accumulated in this frame
                  const snapshot = aiMessageRef.current;
                  const streamMsgs = [...messagesRef.current];
                  if (streamMsgs[streamMsgs.length - 1]?.role === 'user') {
                    streamMsgs.push({ role: 'ai', content: snapshot });
                  } else {
                    streamMsgs[streamMsgs.length - 1] = { ...streamMsgs[streamMsgs.length - 1], content: snapshot };
                  }
                  messagesRef.current = streamMsgs;
                  setMessages(streamMsgs);
                });
              }
            }
            
            if (data.chunk?.done) {
              // Cancel any pending RAF flush — we do a final synchronous update below
              if (rafHandleRef.current !== null) {
                cancelAnimationFrame(rafHandleRef.current);
                rafHandleRef.current = null;
              }
              pendingTokensRef.current = '';

              setIsGenerating(false);
              isGeneratingRef.current = false;

              // Final parse and dispatch to ensure all completed files and targeted edits are mounted
              const { fileMap, editsMap } = parseMessageSegments(bufferRef.current, true);
              syncFilesAndEdits(fileMap, editsMap, true);

              // Ensure the final complete message content is committed to state
              const finalContent = aiMessageRef.current;
              const effectiveContent = finalContent || (bufferRef.current ? bufferRef.current : '⚠️ Model completed without generating response text. Please try sending your prompt again.');
              const completedAt = Date.now();
              const doneMsgs = [...messagesRef.current];
              if (doneMsgs[doneMsgs.length - 1]?.role === 'user') {
                doneMsgs.push({ role: 'ai', content: effectiveContent, timestamp: completedAt });
              } else {
                doneMsgs[doneMsgs.length - 1] = { ...doneMsgs[doneMsgs.length - 1], content: effectiveContent, timestamp: completedAt };
              }
              messagesRef.current = doneMsgs;
              setMessages(doneMsgs);

              appEvents.emit('generation-status', { status: 'Ready', detail: 'App code updated', projectId: activeProjectId });

              setTimeout(() => {
                saveProjectMessages(activeProjectId, messagesRef.current);
              }, 50);
            }
            
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          } else if (data.type === 'stopped') {
            if (isGeneratingRef.current) {
              handleStopGenerationRef.current();
            }
          } else if (data.type === 'error') {
            setIsGenerating(false);
            isGeneratingRef.current = false;
            const errMsg = data.error || data.message || 'Generation failed';
            appEvents.emit('generation-status', { status: 'Error', error: errMsg, projectId: activeProjectId });
            const current = [...messagesRef.current];
            if (current.length > 0 && current[current.length - 1].role === 'ai' && !current[current.length - 1].content) {
              current[current.length - 1] = { role: 'ai', content: `⚠️ ${errMsg}`, timestamp: Date.now() };
            } else {
              current.push({ role: 'ai', content: `⚠️ ${errMsg}`, timestamp: Date.now() });
            }
            messagesRef.current = current;
            setMessages(current);
            saveProjectMessages(activeProjectId, current);
          } else if (data.type === 'tool_call') {
            appEvents.emit('generation-status', {
              status: 'Generating',
              detail: `Running tool ${data.tool}...`
            });
          } else if (data.type === 'file_updated') {
            const cleanPath = normalizePath(data.path);
            currentFilesRef.current[cleanPath] = data.content;
            appEvents.emit('file-generated', {
              path: cleanPath,
              content: data.content,
              isComplete: true
            });
            appEvents.emit('generation-status', {
              status: 'Generating',
              detail: `Updated ${data.path}...`
            });
          } else if (data.type === 'file_deleted') {
            const cleanPath = normalizePath(data.path);
            delete currentFilesRef.current[cleanPath];
            appEvents.emit('file-deleted', { path: cleanPath });
            appEvents.emit('generation-status', {
              status: 'Generating',
              detail: `Deleted ${data.path}...`
            });
          } else if (data.type === 'request_sync') {
            const files = await getProjectFilesAsync(activeProjectId);
            if (files && Object.keys(files).length > 0 && ws) {
              ws.send(JSON.stringify({
                type: 'sync_files',
                replace_all: true,
                files
              }));
            }
          } else if (data.type === 'files_snapshot') {
            if (data.files && Object.keys(data.files).length > 0) {
              currentFilesRef.current = data.files;
              saveProjectFiles(activeProjectId, data.files);
              appEvents.emit('files-refreshed', data.files);
            }
          } else if (data.type === 'trigger-auto-reply') {
            // Server detected a truncated generation (<file> block left open by
            // the token cap) and asks us to continue it. Bridge it to the
            // appEvents listener that sends the continuation prompt.
            appEvents.emit('trigger-auto-reply', { message: data.message });
          }
        } catch (e) {
          console.error('Parse error in WS message:', e);
        }
      };

      ws.onclose = (event) => {
        if (pingInterval) clearInterval(pingInterval);
        if (!isMounted) return;
        setIsConnected(false);
        if (isGeneratingRef.current) {
          appEvents.emit('generation-status', { status: 'Error', error: 'Connection lost' });
        }
        setIsGenerating(false);
        isGeneratingRef.current = false;
        // 4401 = auth/ownership failure (do not reconnect)
        // 4409 = project quota exceeded (do not reconnect, delete local project)
        // 4429 = too many open connections (retryable — user closes another tab)
        // 1006 = abnormal network close (reconnect with backoff)
        if (event?.code === 4409) {
          appEvents.emit('generation-status', {
            status: 'Error',
            error: 'You have reached your project quota. Please delete an existing project before creating a new one.',
            projectId: activeProjectId,
          });
          if (isMounted) {
            // Cleanup the local dummy project that was rejected by the server
            deleteProject(activeProjectId);
            const remaining = getProjects();
            if (remaining.length > 0) {
              const targetId = remaining[0].id;
              setActiveProjectId(targetId);
              appEvents.emit('project-switched', { projectId: targetId });
            }
          }
          return;
        }
        if (event?.code === 4429) {
          appEvents.emit('generation-status', {
            status: 'Error',
            error: 'Too many open tabs for this project. Close a tab and it will reconnect.',
            projectId: activeProjectId,
          });
          // Fall through to reconnect with backoff — the extra tab may close.
        }

        if (event?.code === 4401) {
          if (!getToken()) {
            window.dispatchEvent(new CustomEvent('bh-session-expired'));
            return;
          }
          // Authorization failure — do NOT reconnect. The async check below
          // determines whether this is a session expiry or an ownership conflict
          // and surfaces the right message; reconnecting would just loop.
          verifyStoredSession().then(async (user) => {
            if (!user) {
              if (isMounted) window.dispatchEvent(new CustomEvent('bh-session-expired'));
              return;
            }
            const isLocal = getProjects().some((p: any) => p.id === activeProjectId);
            if (!isLocal && isMounted) {
              try {
                const res = await authFetch('/api/projects');
                if (res.ok) {
                  const data = await res.json().catch(() => null);
                  const userProjects = data?.projects || (Array.isArray(data) ? data : []);
                  if (Array.isArray(userProjects) && userProjects.length > 0) {
                    const isOwned = userProjects.some((p: any) => p.project_id === activeProjectId || p.id === activeProjectId);
                    if (!isOwned) {
                      console.warn(`Project ${activeProjectId} is not owned by user ${user.id}. Auto-switching to owned workspace.`);
                      const targetId = userProjects[0]?.project_id || userProjects[0]?.id;
                      if (targetId) {
                        setActiveProjectId(targetId);
                        appEvents.emit('project-switched', { projectId: targetId });
                        return;
                      }
                    }
                  }
                }
              } catch (e) {
                console.warn('Failed verifying project ownership list:', e);
              }
            } else if (isLocal && isMounted) {
              appEvents.emit('generation-status', {
                status: 'Error',
                error: 'Unable to connect to workspace session. You may have reached your project quota.',
                projectId: activeProjectId,
              });
            }
          });
          return;
        }
        connectAttempts++;
        if (connectAttempts > 10) {
          console.warn(`WS connection failed after ${connectAttempts - 1} attempts; stopping reconnect loop.`);
          appEvents.emit('generation-status', {
            status: 'Error',
            error: 'Connection to workspace session lost. Please refresh the page.',
            projectId: activeProjectId,
          });
          return;
        }
        // Use capped exponential backoff (1s, 2s, 4s, 8s … 30s max)
        const backoffMs = Math.min(1000 * Math.pow(2, connectAttempts - 1), 30_000);
        console.warn(`WS closed (attempt ${connectAttempts}), retrying in ${Math.round(backoffMs / 1000)}s…`);
        reconnectTimer = setTimeout(connect, backoffMs);
      };

      ws.onerror = (err) => {
        if (!isMounted) return;
        console.warn('WS error on session:', activeProjectId, err);
      };
    };

    connect();

    const handleSyncFiles = (data: { files: any; replaceAll?: boolean }) => {
      if (data.files) {
        currentFilesRef.current = { ...data.files };
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: 'sync_files', 
          files: data.files,
          replace_all: !!data.replaceAll 
        }));
      }
    };
    const unsubSyncFiles = appEvents.on('sync-files', handleSyncFiles);

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimer);
      unsubSyncFiles();
      if (ws) {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.onopen = () => ws?.close();
        } else {
          ws.close();
        }
      }
      if (messagesRef.current && messagesRef.current.length > 0) {
        saveProjectMessages(activeProjectId, messagesRef.current);
      }
    };
  }, [activeProjectId]);

  // Handle abrupt offline drops to prevent stuck generating state
  useEffect(() => {
    const handleOffline = () => {
      if (isGeneratingRef.current) {
        setIsGenerating(false);
        isGeneratingRef.current = false;
        appEvents.emit('generation-status', { status: 'Error', error: 'Network disconnected' });
        setMessages(prev => [
          ...prev,
          { role: 'ai', content: 'Network disconnected. Generation interrupted.' }
        ]);
        if (wsRef.current) {
          wsRef.current.close();
        }
      }
    };
    window.addEventListener('offline', handleOffline);
    return () => window.removeEventListener('offline', handleOffline);
  }, []);

  const handleClearChat = () => {
    setConfirmModalConfig({
      isOpen: true,
      title: 'Clear Chat History',
      message: 'Are you sure you want to clear all chat history and workspace logs for this project?',
      confirmLabel: 'Clear Chat',
      onConfirm: () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'clear' }));
        }
        const cleared: Message[] = [
          { role: 'ai', content: 'Chat history cleared. What would you like to build next?' }
        ];
        setMessages(cleared);
        messagesRef.current = cleared;
        deleteProjectMessages(activeProjectId);
        appEvents.emit('clear-workspace', null);
        setConfirmModalConfig(null);
      }
    });
  };

  const handleStopGeneration = useCallback(() => {
    // 1. Invalidate current generation ID to ignore trailing stream chunks
    currentGenIdRef.current += 1;

    // 2. Tell backend agent to abort and bump write epoch
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }

    // 3. Cancel scheduled RAF flush and reset streaming token buffers
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    pendingTokensRef.current = '';

    // 4. Halt generating state
    setIsGenerating(false);
    isGeneratingRef.current = false;

    // 5. Restore workspace files to pre-generation snapshot if partial edits occurred
    if (preGenerationFilesRef.current && Object.keys(preGenerationFilesRef.current).length > 0) {
      currentFilesRef.current = { ...preGenerationFilesRef.current };
      appEvents.emit('files-refreshed', preGenerationFilesRef.current);
    }

    // 6. Commit the stopped message state
    const stoppedMsgs = [...messagesRef.current];
    const last = stoppedMsgs[stoppedMsgs.length - 1];
    if (last && last.role === 'ai') {
      const text = (aiMessageRef.current || last.content || '').trim();
      stoppedMsgs[stoppedMsgs.length - 1] = {
        ...last,
        content: text ? `${text}\n\n*[Generation stopped by user]*` : '*[Generation stopped by user]*',
        timestamp: Date.now()
      };
    }
    messagesRef.current = stoppedMsgs;
    saveProjectMessages(activeProjectId, stoppedMsgs);
    setMessages(stoppedMsgs);

    // 7. Emit Stopped platform status
    appEvents.emit('generation-status', { status: 'Stopped', detail: 'Generation stopped by user', projectId: activeProjectId });
  }, [activeProjectId]);

  // Keep the stable ref up-to-date so the WS handler always calls the latest version
  handleStopGenerationRef.current = handleStopGeneration;

  const handleEditMessage = (index: number) => {
    if (isGeneratingRef.current) return;
    const msg = messagesRef.current[index];
    if (!msg || msg.role !== 'user') return;
    
    setInput(msg.content);
    
    const newMsgs = messagesRef.current.slice(0, index);
    setMessages(newMsgs);
    messagesRef.current = newMsgs;
    saveProjectMessages(activeProjectId, newMsgs);
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'rewrite_history', messages: newMsgs }));
    }
  };

  const handleRollbackMessage = (index: number) => {
    if (isGeneratingRef.current) return;
    setConfirmModalConfig({
      isOpen: true,
      title: 'Rewind Conversation',
      message: 'Are you sure you want to rewind the conversation to this point? All subsequent messages will be deleted.',
      confirmLabel: 'Rewind',
      onConfirm: () => {
        const newMsgs = messagesRef.current.slice(0, index + 1);
        setMessages(newMsgs);
        messagesRef.current = newMsgs;
        saveProjectMessages(activeProjectId, newMsgs);
        
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'rewrite_history', messages: newMsgs }));
        }
        setConfirmModalConfig(null);
      }
    });
  };

  const handleDeleteMessage = (index: number) => {
    if (isGeneratingRef.current) return;
    setConfirmModalConfig({
      isOpen: true,
      title: 'Delete Message',
      message: 'Are you sure you want to delete this message and its corresponding response?',
      confirmLabel: 'Delete',
      onConfirm: () => {
        const newMsgs = [...messagesRef.current];
        const deleteCount = (index + 1 < newMsgs.length && newMsgs[index + 1].role === 'ai') ? 2 : 1;
        newMsgs.splice(index, deleteCount);
        setMessages(newMsgs);
        messagesRef.current = newMsgs;
        saveProjectMessages(activeProjectId, newMsgs);
        
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'rewrite_history', messages: newMsgs }));
        }
        setConfirmModalConfig(null);
      }
    });
  };

  const handleSendMessage = useCallback((overrideMessage?: string, overrideImage?: string | null, overrideImageType?: string) => {
    const textToSend = overrideMessage && typeof overrideMessage === 'string' ? overrideMessage : input;
    if (!textToSend.trim() || isGeneratingRef.current) return;

    if (!textToSend.startsWith('[Auto-Fix]')) {
      autoFixCountRef.current = 0;
    }

    const userMessage = textToSend.trim();
    const imagePayload = overrideImage !== undefined ? overrideImage : selectedImage;
    const imageTypePayload = overrideImageType !== undefined ? overrideImageType : imageType;

    if (!overrideMessage || typeof overrideMessage !== 'string') {
      setInput('');
      setSelectedImage(null);
      setImageType('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
    
    bufferRef.current = '';
    aiMessageRef.current = '';

    const newMsgs: Message[] = [
      ...messagesRef.current,
      { role: 'user', content: userMessage, timestamp: Date.now() },
      { role: 'ai', content: '' }
    ];
    setMessages(newMsgs);
    messagesRef.current = newMsgs;
    saveProjectMessages(activeProjectId, newMsgs);
    appEvents.emit('project-messages-updated', { projectId: activeProjectId });

    // If the active project still has a generic name, auto-rename with first user prompt (truncated to ~30 chars)
    try {
      const allProjects = getProjects();
      const currentProj = allProjects.find(p => p.id === activeProjectId);
      if (currentProj && (/^Project \d+$/i.test(currentProj.name) || currentProj.name === 'Untitled Project' || /^chat-easy-\d+$/i.test(currentProj.name))) {
        const cleanedPrompt = userMessage.trim().replace(/\s+/g, ' ');
        const newTitle = cleanedPrompt.length > 30 ? `${cleanedPrompt.slice(0, 30)}…` : cleanedPrompt;
        updateProjectName(activeProjectId, newTitle);
        appEvents.emit('project-renamed', { id: activeProjectId, name: newTitle });
      }
    } catch (e) {
      console.error('Error auto-renaming project from first prompt:', e);
    }

    preGenerationFilesRef.current = { ...currentFilesRef.current };
    currentGenIdRef.current += 1;
    setIsGenerating(true);
    isGeneratingRef.current = true;
    appEvents.emit('generation-status', { status: 'Generating', detail: 'Connecting to AI model...', projectId: activeProjectId });

    const sendWithWs = (ws: WebSocket) => {
      const modelObj = MODELS.find(m => m.id === selectedModelId);
      const reqId = Math.random().toString(36).substring(7);
      let contextReceived = false;

      const unsub = appEvents.on(`workspace-context-response-${reqId}`, (payload: any) => {
        contextReceived = true;
        unsub();
        if (payload.files) {
          currentFilesRef.current = { ...payload.files };
          preGenerationFilesRef.current = { ...payload.files };
        }
        ws.send(JSON.stringify({
          prompt: userMessage,
          projectId: activeProjectId,
          model: modelObj?.id,
          provider: modelObj?.provider,
          workspaceFiles: payload.files,
          image: imagePayload,
          imageType: imageTypePayload
        }));
      });

      appEvents.emit('request-workspace-context', { requestId: reqId });

      // Fallback if Workspace component isn't mounted or doesn't respond
      setTimeout(() => {
        if (!contextReceived) {
          unsub();
          ws.send(JSON.stringify({
            prompt: userMessage,
            projectId: activeProjectId,
            model: modelObj?.id,
            provider: modelObj?.provider,
            workspaceFiles: currentFilesRef.current,
            image: imagePayload,
            imageType: imageTypePayload
          }));
        }
      }, 500);
    };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      sendWithWs(wsRef.current);
    } else if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
      const pendingWs = wsRef.current;
      const onOpen = () => {
        pendingWs.removeEventListener('open', onOpen);
        sendWithWs(pendingWs);
      };
      pendingWs.addEventListener('open', onOpen);
    } else {
      pendingSendRef.current = (openedWs: WebSocket) => {
        sendWithWs(openedWs);
      };
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED || wsRef.current.readyState === WebSocket.CLOSING) {
        connectRef.current?.();
      }
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          sendWithWs(wsRef.current);
        }
      }, 1000);
    }

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [activeProjectId, imageType, input, selectedImage, selectedModelId]);

  // Keep ref in sync so the WS closure can always call the latest handleSendMessage
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  const autoFixCountRef = useRef(0);

  useEffect(() => {
    const handleAutoFix = (payload: { error: string; file?: string; layer?: 'backend' | 'frontend' }) => {
      if (!isGeneratingRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        if (autoFixCountRef.current >= 5) {
          appEvents.emit('generation-status', { status: 'Error', error: 'Auto-fix loop limit reached (5). Please fix manually.' });
          return;
        }
        autoFixCountRef.current += 1;
        const fileTarget = payload.file ? ` in ${payload.file}` : '';
        const isBackend = payload.layer === 'backend' || (payload.file && (payload.file.startsWith('/server/') || payload.file.startsWith('server/'))) || payload.error.includes('[Backend Error]');
        const layerLabel = isBackend ? 'backend API server' : 'client dev server';
        const layerAdvice = isBackend
          ? 'Please inspect the server code (/server/index.js, /server/routes/, /server/controllers/, or /server/db.js) and use an <edit> block with exact <search> and <replace> to surgically fix the broken endpoint, database query, or server configuration.'
          : 'Please inspect the code and use an <edit> block with exact <search> and <replace> to surgically fix the broken lines. Do NOT rewrite the entire component from scratch.';
        const autoMsg = `[Auto-Fix] The ${layerLabel} encountered an error${fileTarget}:\n\n${payload.error}\n\n${layerAdvice}`;
        handleSendMessage(autoMsg);
      }
    };
    const handleAutoReply = (payload: { message: string }) => {
      if (!isGeneratingRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        handleSendMessage(payload.message);
      }
    };
    const handlePreviewSuccess = () => {
      autoFixCountRef.current = 0;
    };
    
    const unsubFix = appEvents.on('auto-fix-error', handleAutoFix);
    const unsubReply = appEvents.on('trigger-auto-reply', handleAutoReply);
    const unsubSuccess = appEvents.on('preview-success', handlePreviewSuccess);
    return () => {
      unsubFix();
      unsubReply();
      unsubSuccess();
    };
  }, [handleSendMessage]);

  // NOTE: the model picker is a custom dropdown of buttons, so there is no
  // <select> to drive. Mid-task model handoff used to live in a handleChange
  // here; the picker now just sets the id, and the switch takes effect on the
  // next prompt.


  return (
    <div className="chat-panel-container" style={{ width: width ? `${width}px` : '100%', minWidth: width ? '360px' : '0', display: 'flex', flexDirection: 'column', height: '100%', background: '#0e1015', position: 'relative' }}>
      {/* Message Stream */}
      <div 
        onScroll={handleMessagesScroll}
        style={{ 
          flex: 1, 
          padding: '24px 20px', 
          overflowY: 'auto', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '20px',
          scrollBehavior: 'smooth'
        }}>
        {messages.map((msg, idx) => {
          // Index keys are deliberate: the list is append-only and positional, so
          // a message's position *is* its identity. Content-derived keys would
          // remount the streaming row on every token, discarding its scroll
          // position and remounting the code blocks beneath it.
          const isLastMessage = idx === messages.length - 1;
          const isCurrentGenerating = isGenerating && isLastMessage;
          const isAi = msg.role === 'ai';
          const timeLabel = formatMessageTime(msg.timestamp);

          return (
            <div 
              key={idx} 
              className={`chat-message ${isAi ? 'chat-message-ai' : 'chat-message-user'}`}
              style={{ 
                display: 'flex', 
                gap: '12px', 
                flexDirection: isAi ? 'row' : 'row-reverse',
                alignItems: 'flex-start'
              }}
            >
              {/* Avatar Badge */}
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '6px',
                background: isAi 
                  ? '#18181b'
                  : 'rgba(255, 255, 255, 0.08)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '3px'
              }}>
                {isAi ? (
                  <BrainHalfLogo size={16} strokeWidth={1.75} color="#2dd4bf" />
                ) : (
                  <User size={16} strokeWidth={1.75} color="#ffffff" />
                )}
              </div>
              
              <div style={{ 
                maxWidth: isAi ? 'calc(100% - 36px)' : '85%',
                flex: isAi ? 1 : 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: isAi ? 'flex-start' : 'flex-end',
                gap: '4px'
              }}>
                {isAi && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '6px',
                    fontSize: '11px',
                    color: 'rgba(255, 255, 255, 0.4)',
                    paddingRight: '4px',
                    width: '100%'
                  }}>
                    {timeLabel && <span>{timeLabel}</span>}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                        setCopiedIndex(idx);
                        setTimeout(() => setCopiedIndex(null), 2000);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center'
                      }}
                      title="Copy message"
                      aria-label="Copy message"
                    >
                      {copiedIndex === idx ? <Check size={12} color="#22c55e" /> : <Copy size={12} />}
                    </button>
                  </div>
                )}

                {msg.role === 'user' ? (
                  /* Clean User Message */
                  <div 
                    onMouseEnter={() => setHoveredMessageIndex(idx)}
                    onMouseLeave={() => setHoveredMessageIndex(null)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: '#f3f4f6',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      fontSize: '13.5px',
                      lineHeight: 1.55,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      border: 'none',
                      boxShadow: 'none',
                      position: 'relative'
                    }}
                  >
                    {msg.content}
                    
                    {hoveredMessageIndex === idx && !isGenerating && (
                      <div style={{
                        position: 'absolute',
                        top: '-14px',
                        right: '8px',
                        display: 'flex',
                        gap: '4px',
                        background: '#181b28',
                        padding: '4px',
                        borderRadius: '6px',
                        border: 'none',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
                      }}>
                        <button
                          onClick={() => handleEditMessage(idx)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px'
                          }}
                          title="Edit Message"
                        >
                          <Pencil size={14} strokeWidth={1.75} />
                        </button>
                        <button
                          onClick={() => handleDeleteMessage(idx)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px'
                          }}
                          title="Delete Message"
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div 
                    className="message-block ai-message" 
                    onMouseEnter={() => setHoveredMessageIndex(idx)}
                    onMouseLeave={() => setHoveredMessageIndex(null)}
                    style={{
                      background: 'transparent',
                      color: '#e2e8f0',
                      padding: '2px 0',
                      borderRadius: '0',
                      fontSize: '13.5px',
                      lineHeight: 1.65,
                      border: 'none',
                      boxShadow: 'none',
                      width: '100%',
                      boxSizing: 'border-box',
                      position: 'relative'
                    }}
                  >
                    {hoveredMessageIndex === idx && !isGenerating && (
                      <div className="message-actions" style={{
                        position: 'absolute',
                        top: '-20px',
                        right: '8px',
                        display: 'flex',
                        gap: '4px',
                        background: '#181b28',
                        padding: '4px',
                        borderRadius: '6px',
                        border: 'none',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        zIndex: 10
                      }}>
                        <button
                          onClick={() => handleRollbackMessage(idx)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px'
                          }}
                          title="Rewind conversation to this point"
                        >
                          <Undo2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    )}

                    {(() => {
                      const { segments } = memoizedParse(msg.content, !isCurrentGenerating);

                      if (segments.length === 0) {
                        return isCurrentGenerating ? (
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '10px',
                            padding: '10px 14px',
                            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(20, 184, 166, 0.04) 100%)',
                            border: '1px solid rgba(99, 102, 241, 0.2)',
                            borderRadius: '10px',
                            color: 'var(--text-primary)',
                            fontSize: '13.5px',
                            fontWeight: 500,
                            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
                            marginTop: '8px',
                            width: 'fit-content'
                           }}>
                            <div style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              width: '26px', 
                              height: '26px', 
                              borderRadius: '7px', 
                              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                              boxShadow: '0 0 12px rgba(99, 102, 241, 0.4)'
                             }}>
                               <Sparkles size={14} color="white" />
                            </div>
                            <span style={{ 
                              letterSpacing: '0.01em', 
                              background: 'linear-gradient(90deg, #ffffff 0%, #cbd5e1 100%)', 
                              WebkitBackgroundClip: 'text', 
                              WebkitTextFillColor: 'transparent',
                              fontWeight: 500
                            }}>
                              BrainHalf is thinking...
                            </span>
                            <span style={{ 
                              fontSize: '11px', 
                              color: 'rgba(255, 255, 255, 0.45)', 
                              fontFamily: 'var(--font-mono)',
                              marginLeft: '2px'
                            }}>
                              {elapsedSeconds}s
                            </span>
                          </div>
                        ) : null;
                      }

                      const fileSegments = segments.filter(s => s.type === 'file');
                      const editSegments = segments.filter(s => s.type === 'edit');
                      const totalChanges = fileSegments.length + editSegments.length;

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {totalChanges > 1 && (
                            <div className="file-change-summary-bar">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CheckCircle2 size={13} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                                <span style={{ fontWeight: 600 }}>
                                  AI {fileSegments.length > 0 ? `generated ${fileSegments.length} file${fileSegments.length > 1 ? 's' : ''}` : ''}
                                  {fileSegments.length > 0 && editSegments.length > 0 ? ', ' : ''}
                                  {editSegments.length > 0 ? `patched ${editSegments.length} file${editSegments.length > 1 ? 's' : ''}` : ''}
                                </span>
                              </div>
                              <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                                {[...fileSegments, ...editSegments].map(f => f.path.split('/').pop()).join(' • ')}
                              </span>
                            </div>
                          )}

                          {segments.map((seg, sIdx) => {
                            if (seg.type === 'text') {
                              return (
                                <div key={sIdx} style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, color: '#e2e8f0' }}>
                                  {seg.content}
                                </div>
                              );
                            } else if (seg.type === 'file') {
                              return (
                                <CodeFileBlock
                                  key={sIdx}
                                  filePath={seg.path}
                                  content={seg.content}
                                  isStreaming={seg.isStreaming}
                                />
                              );
                            } else if (seg.type === 'edit') {
                              return (
                                <DiffEditBlock
                                  key={sIdx}
                                  filePath={seg.path}
                                  edits={seg.edits}
                                  isStreaming={seg.isStreaming}
                                />
                              );
                            } else if (seg.type === 'command') {
                              return (
                                <CommandBlock
                                  key={sIdx}
                                  command={seg.command}
                                  isStreaming={seg.isStreaming}
                                />
                              );
                            } else if (seg.type === 'plan') {
                              return (
                                <PlanBlock
                                  key={sIdx}
                                  content={seg.content}
                                  isStreaming={seg.isStreaming}
                                />
                              );
                            }
                            return null;
                          })}

                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Starter suggestions when conversation is fresh */}
        {!messages.some(m => m.role === 'user') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em' }}>
              Quick Templates
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
              {STARTER_PROMPTS.map((sp, sIdx) => (
                <div
                  key={sIdx}
                  onClick={() => handleSendMessage(`Build an app: ${sp.title} - ${sp.desc}`)}
                  className="quick-template-card"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(`Build an app: ${sp.title} - ${sp.desc}`); }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{sp.title}</span>
                      <ArrowRight size={13} strokeWidth={2} className="template-arrow" style={{ color: 'var(--text-secondary)', opacity: 0.8, transition: 'transform 0.15s ease' }} />
                    </div>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>{sp.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Floating scroll to bottom button right above input - only when scrolled up */}
        {showScrollBottom && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
            <button
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                height: '28px',
                padding: '0 12px',
                borderRadius: '14px',
                background: '#181a24',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11.5px',
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(8px)',
                transition: 'all 0.15s ease'
              }}
              title="Scroll to latest message"
              aria-label="Scroll to latest message"
            >
              <ArrowDown size={12} strokeWidth={2} />
              <span>Latest message</span>
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form Area */}
      <div style={{
        padding: '0 20px 20px 20px',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative'
      }}>
        {mergeConflict && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#fca5a5' }}>
                Merge Conflict with "{mergeConflict.sourceName}"
              </span>
              <button 
                onClick={() => setMergeConflict(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
                title="Dismiss"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Conflicting files: {mergeConflict.conflicts.join(', ')}
            </div>
            <button
              onClick={() => {
                handleSendMessage(`[Conflict-Resolution] The files ${mergeConflict.conflicts.join(', ')} contain git-style merge conflict markers: <<<<<<< HEAD and >>>>>>> INCOMING. Please carefully inspect both versions, merge all features and logic without losing functionality, and produce clean, working files.`);
                setMergeConflict(null);
              }}
              style={{
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                alignSelf: 'flex-start'
              }}
            >
              Resolve Conflicts with AI Agent
            </button>
          </div>
        )}

        {/* Input Card Container */}
        <div 
          className="chat-input-wrapper"
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: '#13141c',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '14px',
            padding: '12px 14px 10px 14px',
            position: 'relative',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45)'
          }}
        >
          {selectedImage && (
            <div style={{ position: 'relative', width: '56px', height: '56px', marginBottom: '8px', border: 'none', borderRadius: '6px' }}>
              <img src={selectedImage} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '5px' }} />
              <button 
                onClick={() => { setSelectedImage(null); setImageType(''); }}
                style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', padding: '2px', cursor: 'pointer' }}
                aria-label="Remove image"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              if (e.target.value.trim().length > 0) {
                e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Message..."
            rows={1}
            disabled={isGenerating}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: '#ffffff',
              fontSize: '13.5px',
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.45,
              maxHeight: '180px',
              minHeight: '26px',
              padding: '2px 0 8px 0',
              margin: 0,
              overflowY: 'auto',
              opacity: isGenerating ? 0.6 : 1,
              cursor: isGenerating ? 'not-allowed' : 'text',
              boxShadow: 'none'
            }}
          />

          {/* Model picker popover menu */}
          {showModelPicker && (
            <div style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: '12px',
              width: '280px',
              background: '#161822',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '10px',
              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.65)',
              padding: '8px',
              zIndex: 100,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' }}>Select LLM Model</span>
                <button
                  onClick={() => setShowModelPicker(false)}
                  style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 0 }}
                >
                  <X size={13} />
                </button>
              </div>
              <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {MODELS.map(m => (
                  <button
                    key={m.id}
                    data-testid={`model-option-${m.id}`}
                    aria-label={`Select model ${m.name}`}
                    onClick={() => {
                      setSelectedModelId(m.id);
                      setShowModelPicker(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      background: selectedModelId === m.id ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                      color: selectedModelId === m.id ? '#38bdf8' : '#f3f4f6',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '12px',
                      textAlign: 'left'
                    }}
                  >
                    <span>{m.name}</span>
                    {selectedModelId === m.id && <Check size={13} color="#38bdf8" />}
                  </button>
                ))}
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Status: {platformStatus.modelPanelLabel}</span>
                <button
                  onClick={() => {
                    handleClearChat();
                    setShowModelPicker(false);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#f87171',
                    fontSize: '11px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Trash2 size={12} />
                  <span>Clear History</span>
                </button>
              </div>
            </div>
          )}

          {/* Hidden File Input */}
          <input 
            type="file" 
            ref={fileInputRef} 
            aria-label="Attach file or screenshot"
            style={{ display: 'none' }} 
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              
              if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                  setSelectedImage(event.target?.result as string);
                  setImageType(file.type);
                };
                reader.readAsDataURL(file);
              } else {
                const reader = new FileReader();
                reader.onload = (event) => {
                  const text = event.target?.result as string;
                  setInput(prev => prev + (prev ? '\n\n' : '') + `--- ${file.name} ---\n${text}`);
                };
                reader.readAsText(file);
              }
              e.target.value = '';
            }}
          />

          {/* Bottom Toolbar row inside input container */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px' }}>
            {/* Left Controls: Plus, Model pill, Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Model status pill — always visible, reflects generation state */}
              <div
                data-testid="model-status-pill"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.5)',
                  userSelect: 'none',
                }}
              >
                <span style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  background: platformStatus.dotColor,
                  boxShadow: platformStatus.glow,
                  flexShrink: 0,
                }} />
                <span>{platformStatus.modelPanelLabel}</span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={isGenerating}
                style={{
                  padding: '4px',
                  borderRadius: '6px',
                  color: 'rgba(255, 255, 255, 0.65)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Attach file"
                aria-label="Attach file"
              >
                <Plus size={16} strokeWidth={2} />
              </button>

              {/* Model name pill — visible at all times, click to open picker */}
              <button
                type="button"
                onClick={() => setShowModelPicker(prev => !prev)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: showModelPicker ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.06)',
                  border: `1px solid ${showModelPicker ? 'rgba(56, 189, 248, 0.35)' : 'rgba(255, 255, 255, 0.1)'}`,
                  color: showModelPicker ? '#38bdf8' : 'rgba(255, 255, 255, 0.75)',
                  cursor: 'pointer',
                  fontSize: '11.5px',
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                  maxWidth: '160px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  transition: 'all 0.15s ease'
                }}
                title="Change AI model"
                aria-label="Change AI model"
                data-testid="model-picker-btn"
              >
                <SlidersHorizontal size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(MODELS.find(m => m.id === selectedModelId)?.name ?? selectedModelId).replace(/\s*\([^)]*\)/g, '')}
                </span>
              </button>
            </div>

            {/* Right Controls: Mic + Send/Stop button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                className="icon-btn"
                style={{
                  padding: '4px',
                  borderRadius: '6px',
                  color: 'rgba(255, 255, 255, 0.65)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Voice input"
                aria-label="Voice input"
              >
                <Mic size={15} strokeWidth={2} />
              </button>

              {isGenerating ? (
                <button
                  onClick={handleStopGeneration}
                  style={{
                    background: '#3b82f6',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    width: '32px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(59, 130, 246, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                  title="Stop generation"
                  aria-label="Stop generation"
                  data-testid="stop-generation-btn"
                >
                  <Square size={11} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={() => handleSendMessage()}
                  disabled={(!input.trim() && !selectedImage)}
                  data-testid="send-prompt-btn"
                  style={{
                    background: (!input.trim() && !selectedImage) ? 'rgba(255, 255, 255, 0.08)' : '#38bdf8',
                    color: (!input.trim() && !selectedImage) ? 'rgba(255, 255, 255, 0.45)' : '#090b10',
                    border: '1px solid ' + ((!input.trim() && !selectedImage) ? 'rgba(255, 255, 255, 0.1)' : '#38bdf8'),
                    borderRadius: '8px',
                    width: '32px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: (!input.trim() && !selectedImage) ? 'not-allowed' : 'pointer',
                    boxShadow: (!input.trim() && !selectedImage) ? 'none' : '0 2px 8px rgba(56, 189, 248, 0.35)',
                    transition: 'all 0.15s ease'
                  }}
                  title="Send message"
                  aria-label="Send message"
                >
                  <ArrowUp size={15} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Accessible Non-Blocking Chat Dialog */}
      {confirmModalConfig && (
        <ConfirmModal
          isOpen={confirmModalConfig.isOpen}
          title={confirmModalConfig.title}
          message={confirmModalConfig.message}
          confirmLabel={confirmModalConfig.confirmLabel}
          onConfirm={confirmModalConfig.onConfirm}
          onCancel={() => setConfirmModalConfig(null)}
        />
      )}
    </div>
  );
};

export default ChatPanel;
