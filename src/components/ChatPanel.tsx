import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Trash2, X, User, CheckCircle2, ArrowRight, Square, Pencil, Paperclip, ChevronDown, Undo2, Sparkles } from 'lucide-react';
import { appEvents } from '../lib/events';
import { parseMessageSegments, applyEditsToFile, type CodeEdit } from '../lib/message-parser';
import { normalizePath } from '../lib/utils';
import { getProjectMessages, saveProjectMessages, deleteProjectMessages, getProjectFilesAsync, saveProjectFiles, getProjects, updateProjectName } from '../lib/project-store';
import { getToken, withTokenQuery } from '../lib/auth-client';
import CodeFileBlock from './CodeFileBlock';
import DiffEditBlock from './DiffEditBlock';
import CommandBlock from './CommandBlock';
import PlanBlock from './PlanBlock';
import ConfirmModal from './ConfirmModal';
import { usePlatformStatus } from '../lib/status-store';
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
  provider: 'cloudflare' | 'anthropic' | 'aws' | 'atria';
  category: 'recommended' | 'coding' | 'fast' | 'reasoning';
  speed?: string;
  badge?: string;
}

const MODELS: ModelDef[] = [
  // Verified High-Performance Production Fleet
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (Recommended)', provider: 'cloudflare', category: 'recommended', speed: '72 t/s', badge: 'Flagship' },
  { id: '@cf/openai/gpt-oss-20b', name: 'GPT-OSS 20B (Ultra-Fast 114 t/s)', provider: 'cloudflare', category: 'fast', speed: '114 t/s', badge: 'Ultra-Fast' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B (Next-Gen)', provider: 'cloudflare', category: 'coding', speed: '58 t/s', badge: 'Next-Gen' },
  { id: '@cf/openai/gpt-oss-120b', name: 'GPT-OSS 120B (High-Capacity)', provider: 'cloudflare', category: 'reasoning', speed: '51 t/s', badge: 'Heavyweight' },
  { id: '@cf/moonshotai/kimi-k2.7-code', name: 'Kimi K2.7 Code (200k Context)', provider: 'cloudflare', category: 'coding', speed: '100 t/s', badge: '200k' },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', provider: 'cloudflare', category: 'coding', speed: '35 t/s', badge: 'Coder' },
  { id: '@cf/qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', provider: 'cloudflare', category: 'coding', speed: '32 t/s', badge: 'Qwen 3.8' },
  // AWS Bedrock Models
  { id: 'claude-sonnet-4.6', name: 'Claude 4.6 Sonnet', provider: 'aws', category: 'coding', badge: 'Sonnet' },
  { id: 'claude-opus-4.6', name: 'Claude 4.6 Opus', provider: 'aws', category: 'reasoning', badge: 'Opus' },
  { id: 'minimax-m2.5', name: 'MiniMax m2.5', provider: 'aws', category: 'fast', badge: 'MiniMax' },
  // Atria ASI Models
  { id: 'Atria-Dawn-Preview', name: 'Atria Dawn Preview', provider: 'atria', category: 'reasoning', badge: 'Atria ASI' },
];

interface Message {
  role: 'user' | 'ai';
  content: string;
}

interface ChatPanelProps {
  activeProjectId?: string;
  width?: number;
}

const ChatPanel: React.FC<ChatPanelProps> = ({ activeProjectId = 'default', width }) => {
  const [input, setInput] = useState('');
  const [selectedModelId, setSelectedModelId] = useState(MODELS[0].id);
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = getProjectMessages(activeProjectId);
    if (saved && saved.length > 0) return saved;
    return [
      { role: 'ai', content: "Ready to co-author your application. Specify a concept, an interaction pattern, or a complex UI flow to begin building." }
    ];
  });
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const currentFilesRef = useRef<Record<string, string>>({});

  // RAF throttle: pending token queue to avoid calling setMessages on every token
  const pendingTokensRef = useRef('');
  const rafHandleRef = useRef<number | null>(null);

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

    const connect = () => {
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
      // Browsers cannot set headers on WebSocket, so the HMAC session token rides
      // in the query string; the Worker verifies it before the DO is reached.
      const authedUrl = withTokenQuery(wsUrl);
      console.log(`Connecting to Durable Object session: ${activeProjectId}`);

      ws = new WebSocket(authedUrl);
      wsRef.current = ws;

      let pingInterval: any = null;

      ws.onopen = () => {
        if (!isMounted) return;
        setIsConnected(true);
        console.log(`Connected to session: ${activeProjectId}`);

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
                // If local has history but server has none, this is a newly created branch.
                // Sync the local history to the new server DO instance.
                setMessages(localSaved);
                messagesRef.current = localSaved;
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'rewrite_history', messages: localSaved }));
                }
              }
            }
          } else if (data.type === 'stream') {
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
                  setMessages(prev => {
                    const newMsgs = [...prev];
                    if (newMsgs[newMsgs.length - 1]?.role === 'user') {
                      newMsgs.push({ role: 'ai', content: snapshot });
                    } else {
                      newMsgs[newMsgs.length - 1] = { ...newMsgs[newMsgs.length - 1], content: snapshot };
                    }
                    messagesRef.current = newMsgs;
                    return newMsgs;
                  });
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
              setMessages(prev => {
                const newMsgs = [...prev];
                if (newMsgs[newMsgs.length - 1]?.role === 'user') {
                  newMsgs.push({ role: 'ai', content: finalContent });
                } else {
                  newMsgs[newMsgs.length - 1] = { ...newMsgs[newMsgs.length - 1], content: finalContent };
                }
                messagesRef.current = newMsgs;
                return newMsgs;
              });

              appEvents.emit('generation-status', { status: 'Ready', detail: 'App code updated', projectId: activeProjectId });

              setTimeout(() => {
                saveProjectMessages(activeProjectId, messagesRef.current);
              }, 50);
            }
            
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          } else if (data.type === 'error') {
            setIsGenerating(false);
            isGeneratingRef.current = false;
            const errMsg = data.error || data.message || 'Generation failed';
            appEvents.emit('generation-status', { status: 'Error', error: errMsg, projectId: activeProjectId });
            setMessages(prev => [
              ...prev,
              { role: 'ai', content: errMsg }
            ]);
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
        // 4401 = rejected by the auth gate; 1006 with no stored token = the
        // Worker refused the upgrade. Either way, retrying would just hammer
        // the server — hand the user back to the login screen instead.
        const unauthorized = event?.code === 4401 || event?.code === 1006;
        if (unauthorized && !getToken()) {
          window.dispatchEvent(new CustomEvent('bh-session-expired'));
          return;
        }
        reconnectTimer = setTimeout(connect, 3000);
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
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    setIsGenerating(false);
    isGeneratingRef.current = false;
    appEvents.emit('generation-status', { status: 'Stopped', detail: 'Generation stopped by user', projectId: activeProjectId });
  }, [activeProjectId]);

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
        newMsgs.splice(index, 2); // Remove user message and the following AI response
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
    }
    
    bufferRef.current = '';
    aiMessageRef.current = '';

    const newMsgs: Message[] = [
      ...messagesRef.current,
      { role: 'user', content: userMessage },
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
      if (currentProj && (/^Project \d+$/i.test(currentProj.name) || currentProj.name === 'Untitled Project')) {
        const cleanedPrompt = userMessage.trim().replace(/\s+/g, ' ');
        const newTitle = cleanedPrompt.length > 30 ? `${cleanedPrompt.slice(0, 30)}…` : cleanedPrompt;
        updateProjectName(activeProjectId, newTitle);
        appEvents.emit('project-renamed', { id: activeProjectId, name: newTitle });
      }
    } catch (e) {
      console.error('Error auto-renaming project from first prompt:', e);
    }

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
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          sendWithWs(wsRef.current);
        } else {
          setIsGenerating(false);
          isGeneratingRef.current = false;
          appEvents.emit('generation-status', { status: 'Error', error: 'Connection unavailable. Reconnecting...' });
        }
      }, 1500);
    }

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [activeProjectId, imageType, input, selectedImage, selectedModelId]);

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

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModelId = e.target.value;
    setSelectedModelId(newModelId);
    
    if (isGenerating && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Trigger mid-task handoff
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
      
      const partialText = aiMessageRef.current;
      if (partialText) {
        // Rewrite history on the server to include the partial output as an AI message
        const updatedMsgs: Message[] = [
          ...messagesRef.current,
          { role: 'ai', content: partialText }
        ];
        wsRef.current.send(JSON.stringify({ type: 'rewrite_history', messages: updatedMsgs }));
        setMessages(updatedMsgs);
        messagesRef.current = updatedMsgs;
        
        // Find model definition and send continuation prompt
        const modelObj = MODELS.find(m => m.id === newModelId);
        
        // We reset the buffer so the new tokens just append cleanly to the UI
        aiMessageRef.current = '';
        bufferRef.current = '';
        
        wsRef.current.send(JSON.stringify({
          prompt: "Continue the previous code generation exactly from where you left off. Do not output any markdown formatting or introductory text if you are already inside a code block, just output the raw code continuation.",
          projectId: activeProjectId,
          model: modelObj?.id,
          provider: modelObj?.provider,
          workspaceFiles: currentFilesRef.current
        }));
      }
    }
  };


  return (
    <div className="chat-panel-container" style={{ width: width ? `${width}px` : '100%', minWidth: width ? '360px' : '0' }}>
      {/* Sleek Chat Panel Header */}
      <div className="chat-panel-top-bar chat-panel-model-row" style={{
        height: '48px',
        padding: '0 14px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.015)',
        gap: '24px',
        flexShrink: 0,
        overflow: 'hidden'
      }}>
        {/* Left group: Brand + Model dropdown + Connection status dot */}
        <div className="model-selector-left-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flexShrink: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              background: '#18181b',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              color: '#818cf8'
            }}>
              <BrainHalfLogo size={16} strokeWidth={1.75} />
            </div>
            <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>BrainHalf AI</span>
          </div>

          {/* Model dropdown + connection status dot grouped together on the left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexShrink: 1 }}>
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', maxWidth: '170px', minWidth: '120px', flexShrink: 1 }}>
              <select
                value={selectedModelId}
                onChange={handleModelChange}
                aria-label="Select AI Model"
                style={{
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  MozAppearance: 'none',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#f3f4f6',
                  fontSize: '12px',
                  fontWeight: 500,
                  padding: '5px 24px 5px 8px',
                  outline: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  colorScheme: 'dark',
                  width: '100%',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden'
                }}
              >
                <optgroup label="Cloudflare Workers AI" style={{ background: '#121316', color: '#9ca3af' }}>
                  {MODELS.filter(m => m.provider === 'cloudflare').map(m => (
                    <option key={m.id} value={m.id} style={{ background: '#121316', color: '#f3f4f6' }}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="AWS Bedrock" style={{ background: '#121316', color: '#9ca3af' }}>
                  {MODELS.filter(m => m.provider === 'aws').map(m => (
                    <option key={m.id} value={m.id} style={{ background: '#121316', color: '#f3f4f6' }}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Atria ASI" style={{ background: '#121316', color: '#9ca3af' }}>
                  {MODELS.filter(m => m.provider === 'atria').map(m => (
                    <option key={m.id} value={m.id} style={{ background: '#121316', color: '#f3f4f6' }}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              </select>
              <ChevronDown 
                size={16} 
                strokeWidth={1.75}
                style={{ 
                  position: 'absolute', 
                  right: '8px', 
                  pointerEvents: 'none', 
                  color: 'var(--text-muted)'
                }} 
              />
            </div>

            <div className="model-status-pill" data-testid="model-status-pill" style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px',
              padding: '2px 4px',
              flexShrink: 0
            }}>
              <span style={{ 
                width: '6px', 
                height: '6px', 
                borderRadius: '50%', 
                background: platformStatus.dotColor, 
                boxShadow: platformStatus.glow 
              }} />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
                {platformStatus.modelPanelLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Delete icon isolated on the far right with extra margin */}
        <div className="model-selector-right-isolated" style={{ marginLeft: 'auto', paddingLeft: '16px', flexShrink: 0 }}>
          <button 
            className="icon-btn"
            onClick={handleClearChat}
            title="Clear conversation history"
            aria-label="Clear conversation history"
            style={{ 
              padding: '6px', 
              borderRadius: '6px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--text-muted)'
            }}
          >
            <Trash2 size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      
      {/* Message Stream (24px spacing, unboxed natural typography flow) */}
      <div style={{ 
        flex: 1, 
        padding: '24px', 
        overflowY: 'auto', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '24px',
        scrollBehavior: 'smooth'
      }}>
        {messages.map((msg, idx) => {
          const isLastMessage = idx === messages.length - 1;
          const isCurrentGenerating = isGenerating && isLastMessage;
          const isAi = msg.role === 'ai';

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
                {/* Clean Author Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                  color: 'var(--text-muted)',
                  padding: '0 2px'
                }}>
                  <span>{isAi ? 'BrainHalf' : 'You'}</span>
                </div>

                {msg.role === 'user' ? (
                  /* Clean User Message (Subtle contrast, no harsh box) */
                  <div 
                    onMouseEnter={() => setHoveredMessageIndex(idx)}
                    onMouseLeave={() => setHoveredMessageIndex(null)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: '#f3f4f6',
                      padding: '12px 16px',
                      borderRadius: '6px',
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
                    
                    {/* Hover Actions */}
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
                          <Pencil size={16} strokeWidth={1.75} />
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
                          <Trash2 size={16} strokeWidth={1.75} />
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
                  }}>
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
                          <Undo2 size={16} strokeWidth={1.75} />
                        </button>
                      </div>
                    )}
                    {(() => {
                      const { segments } = parseMessageSegments(msg.content, !isCurrentGenerating);

                      if (segments.length === 0) {
                        return isCurrentGenerating ? (
                          <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '12px',
                            padding: '12px 16px',
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '12px',
                            color: 'var(--text-primary)',
                            fontSize: '14px',
                            fontWeight: 500,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                            marginTop: '8px'
                           }}>
                            <div style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              width: '28px', 
                              height: '28px', 
                              borderRadius: '8px', 
                              background: 'var(--brand-primary)',
                              boxShadow: '0 0 15px rgba(99, 102, 241, 0.5)'
                             }}>
                               <Sparkles size={16} color="white" />
                            </div>
                            <span style={{ letterSpacing: '0.02em', background: 'linear-gradient(90deg, #fff, #a1a1aa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>BrainHalf is thinking...</span>
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
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em' }}>
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
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{sp.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sp.desc}</span>
                  </div>
                  <ArrowRight size={16} strokeWidth={1.75} style={{ color: 'var(--color-neutral)', opacity: 0.6 }} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form Bar */}
      <div style={{
        padding: '16px 20px 20px 20px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
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
            marginBottom: '4px'
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

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255, 255, 255, 0.025)',
          border: 'none',
          borderRadius: '8px',
          padding: '12px 14px',
          transition: 'all 0.15s ease',
          position: 'relative'
        }} className="chat-input-wrapper">
          {selectedImage && (
            <div style={{ position: 'relative', width: '56px', height: '56px', marginBottom: '8px', border: 'none', borderRadius: '6px' }}>
              <img src={selectedImage} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '5px' }} />
              <button 
                onClick={() => { setSelectedImage(null); setImageType(''); }}
                style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', padding: '2px', cursor: 'pointer' }}
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <button
              className="icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating}
              style={{ padding: '6px', opacity: isGenerating ? 0.4 : 0.8, borderRadius: '6px' }}
              title="Attach File (Image / Text)"
            >
              <Paperclip size={16} strokeWidth={1.75} color="var(--text-secondary)" />
            </button>
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
                  // For text, markdown, json, etc
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
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                  e.currentTarget.style.height = 'auto'; // Reset on send
                }
              }}
              placeholder="Ask BrainHalf to build, edit, or style..."
              rows={1}
              disabled={isGenerating}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#f4f4f6',
                fontSize: '13.5px',
                fontFamily: 'inherit',
                resize: 'none',
                outline: 'none',
                lineHeight: 1.5,
                maxHeight: '200px',
                overflowY: 'auto',
                opacity: isGenerating ? 0.5 : 1,
                cursor: isGenerating ? 'not-allowed' : 'text'
              }}
            />
            {isGenerating ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ 
                  fontSize: '11px', 
                  color: 'var(--text-muted)', 
                  fontFamily: 'var(--font-mono)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px'
                }}>
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#3b82f6',
                    animation: 'pulse 1.5s infinite ease-in-out'
                  }} />
                  {elapsedSeconds}s
                </span>
                <button 
                  onClick={handleStopGeneration}
                  style={{
                    background: '#ef4444',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    height: '32px',
                    padding: '0 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '12px',
                    transition: 'all 0.15s ease',
                    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)'
                  }}
                  title="Stop Generation"
                  aria-label="Stop Generation"
                >
                  <Square size={16} strokeWidth={1.75} fill="currentColor" />
                  <span>Stop</span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleSendMessage()}
                style={{
                  background: (!input.trim() && !selectedImage) 
                    ? 'rgba(255, 255, 255, 0.04)' 
                    : '#ffffff',
                  color: (!input.trim() && !selectedImage) ? 'var(--text-muted)' : '#09090b',
                  border: 'none',
                  borderRadius: '6px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: (!input.trim() && !selectedImage) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title="Send Message (Enter)"
                aria-label="Send message"
                data-testid="send-prompt-btn"
                disabled={(!input.trim() && !selectedImage) || isGenerating}
              >
                <Send size={16} strokeWidth={1.75} />
              </button>
            )}
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
