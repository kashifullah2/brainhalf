import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, Loader2, Trash2, ImagePlus, X, User, CheckCircle2, ArrowRight } from 'lucide-react';
import { appEvents } from '../lib/events';
import { parseMessageSegments } from '../lib/message-parser';
import CodeFileBlock from './CodeFileBlock';
import CommandBlock from './CommandBlock';
import PlanBlock from './PlanBlock';

const QUICK_ACTIONS = [
  '✦ Add dark mode toggle',
  '✦ Make responsive for mobile',
  '✦ Add smooth animations',
  '✦ Refactor into clean components',
  '✦ Explain architecture',
];

const STARTER_PROMPTS = [
  { title: 'Crypto & Stock Dashboard', desc: 'Real-time charts, asset cards & metrics' },
  { title: 'Interactive Kanban Board', desc: 'Drag-and-drop tasks with column states' },
  { title: 'Analytics SaaS Platform', desc: 'Key metrics, conversion funnels & tables' },
];

const MODELS = [
  { id: 'qwen/qwen3.8-max:free', name: 'Qwen 3.8 Max (Xkiro)', provider: 'xkiro' },
  { id: 'qwen/qwen3.5-omni-plus:free', name: 'Qwen 3.5 Omni (Xkiro)', provider: 'xkiro' },
  { id: 'minimax/minimax-m3:free', name: 'MiniMax M3 (Xkiro)', provider: 'xkiro' },
  { id: 'minimax/minimax-m2:free', name: 'MiniMax M2 (Xkiro)', provider: 'xkiro' },
  { id: 'us.meta.llama3-3-70b-instruct-v1:0', name: 'Llama 3 70B (AWS)', provider: 'aws' },
  { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', name: 'Claude 3.5 Sonnet (AWS)', provider: 'aws' },
  { id: 'us.anthropic.claude-3-opus-20240229-v1:0', name: 'Claude 3 Opus (AWS)', provider: 'aws' },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6 (AWS)', provider: 'aws' },
  { id: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0', name: 'Claude 3.5 Sonnet Legacy (AWS)', provider: 'aws' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8', name: 'Llama 3.1 8B (CF)', provider: 'cloudflare' },
  { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B (CF)', provider: 'cloudflare' },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B (CF)', provider: 'cloudflare' },
  { id: '@cf/mistral/mistral-7b-instruct-v0.2-lora', name: 'Mistral 7B (CF)', provider: 'cloudflare' },
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
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: 'What kind of application would you like to build today? For example, "Create a crypto tracker app."' }
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageType, setImageType] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isGeneratingRef = useRef(false);

  // File parsing state
  const bufferRef = useRef('');
  const aiMessageRef = useRef('');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;
    let isMounted = true;

    // Reset buffer on project change
    bufferRef.current = '';
    aiMessageRef.current = '';

    const connect = () => {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const backendHost = isLocal 
        ? (import.meta.env.VITE_BACKEND_HOST || 'brainhalf.com')
        : window.location.host;
      const isHttpsOrRemote = window.location.protocol === 'https:' || isLocal;
      const protocol = isHttpsOrRemote ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${backendHost}/agents/chat-agent/${activeProjectId}`;
      
      console.log(`Connecting to Durable Object session: ${activeProjectId} (${wsUrl})`);
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) return;
        setIsConnected(true);
        console.log(`Connected to session: ${activeProjectId}`);
      };

      ws.onmessage = (event) => {
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

              // Rehydrate files into workspace from previous history
              for (const msg of loadedMsgs) {
                if (msg.role === 'ai') {
                  const { fileMap } = parseMessageSegments(msg.content, true);
                  for (const [path, content] of Object.entries(fileMap)) {
                    appEvents.emit('file-generated', { path, content, isComplete: true });
                  }
                }
              }
              appEvents.emit('generation-status', { status: 'Ready', detail: 'Loaded saved session' });
            } else {
              setMessages([
                { role: 'ai', content: 'What kind of application would you like to build today? For example, "Create a counter app."' }
              ]);
            }
          } else if (data.type === 'stream') {
            if (data.chunk?.response) {
              const text = data.chunk.response;
              bufferRef.current += text;
              aiMessageRef.current += text;

              // Parse files into file map without leaking raw wrapper tags
              const { segments } = parseMessageSegments(bufferRef.current, false);
              
              // Sync files to workspace: mark isComplete: true only when </file> was reached
              for (const seg of segments) {
                if (seg.type === 'file') {
                  appEvents.emit('file-generated', { 
                    path: seg.path, 
                    content: seg.content,
                    isComplete: !seg.isStreaming
                  });
                }
              }

              // Notify workspace of active file being generated
              const activeFileSeg = segments.filter(s => s.type === 'file').pop();
              if (activeFileSeg && activeFileSeg.type === 'file') {
                appEvents.emit('generation-status', { 
                  status: 'Generating', 
                  detail: `Writing ${activeFileSeg.path}...`, 
                  file: activeFileSeg.path 
                });
              }

              setMessages(prev => {
                const newMsgs = [...prev];
                if (newMsgs[newMsgs.length - 1]?.role === 'user') {
                  newMsgs.push({ role: 'ai', content: aiMessageRef.current });
                } else {
                  newMsgs[newMsgs.length - 1].content = aiMessageRef.current;
                }
                return newMsgs;
              });
            }
            
            if (data.chunk?.done) {
              setIsGenerating(false);
              isGeneratingRef.current = false;
              
              // Final parse and dispatch to ensure all completed files are mounted
              const { fileMap } = parseMessageSegments(bufferRef.current, true);
              for (const [path, content] of Object.entries(fileMap)) {
                appEvents.emit('file-generated', { path, content, isComplete: true });
              }
              
              appEvents.emit('generation-status', { status: 'Ready', detail: 'App code generated' });
            }
            
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          } else if (data.type === 'error') {
            setIsGenerating(false);
            isGeneratingRef.current = false;
            appEvents.emit('generation-status', { status: 'Error', error: data.error || 'Generation failed' });
            setMessages(prev => [
              ...prev,
              { role: 'ai', content: `⚠️ ${data.error || 'An error occurred during generation. Please try again.'}` }
            ]);
          }
        } catch (e) {
          console.error('Parse error in WS message:', e);
        }
      };

      ws.onclose = () => {
        if (!isMounted) return;
        setIsConnected(false);
        if (isGeneratingRef.current) {
          appEvents.emit('generation-status', { status: 'Error', error: 'Connection lost' });
        }
        setIsGenerating(false);
        isGeneratingRef.current = false;
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.warn('WS error on session:', activeProjectId, err);
      };
    };

    connect();

    const handleSyncFiles = (data: { files: any }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'sync_files', files: data.files }));
      }
    };
    const unsubSyncFiles = appEvents.on('sync-files', handleSyncFiles);

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimer);
      unsubSyncFiles();
      if (ws) {
        ws.close();
      }
    };
  }, [activeProjectId]);

  const handleClearChat = () => {
    if (confirm('Clear chat history for this project?')) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'clear' }));
      }
      setMessages([
        { role: 'ai', content: 'Chat history cleared. What would you like to build next?' }
      ]);
      appEvents.emit('clear-workspace', null);
    }
  };

  const handleSendMessage = useCallback((overrideMessage?: string, overrideImage?: string | null, overrideImageType?: string) => {
    const textToSend = overrideMessage && typeof overrideMessage === 'string' ? overrideMessage : input;
    if (!textToSend.trim() || isGeneratingRef.current) return;

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

    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage }
    ]);

    setIsGenerating(true);
    isGeneratingRef.current = true;
    appEvents.emit('generation-status', { status: 'Generating', detail: 'Connecting to AI model...' });

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const modelObj = MODELS.find(m => m.id === selectedModelId);
      const reqId = Math.random().toString(36).substring(7);
      let contextReceived = false;

      const unsub = appEvents.on(`workspace-context-response-${reqId}`, (payload: any) => {
        contextReceived = true;
        unsub();
        wsRef.current?.send(JSON.stringify({
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
          wsRef.current?.send(JSON.stringify({
            prompt: userMessage,
            projectId: activeProjectId,
            model: modelObj?.id,
            provider: modelObj?.provider,
            image: imagePayload,
            imageType: imageTypePayload
          }));
        }
      }, 500);
    } else {
      setTimeout(() => {
        setIsGenerating(false);
        isGeneratingRef.current = false;
        appEvents.emit('generation-status', { status: 'Error', error: 'Connection unavailable. Reconnecting...' });
      }, 1000);
    }

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [activeProjectId, imageType, input, selectedImage, selectedModelId]);

  useEffect(() => {
    const handleAutoFix = (payload: { error: string }) => {
      if (!isGeneratingRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        const autoMsg = `[Auto-Fix] The dev server crashed with this error:\n\n${payload.error}\n\nPlease fix the code.`;
        handleSendMessage(autoMsg);
      }
    };
    const handleAutoReply = (payload: { message: string }) => {
      if (!isGeneratingRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        handleSendMessage(payload.message);
      }
    };
    
    const unsubFix = appEvents.on('auto-fix-error', handleAutoFix);
    const unsubReply = appEvents.on('trigger-auto-reply', handleAutoReply);
    return () => {
      unsubFix();
      unsubReply();
    };
  }, [handleSendMessage]);


  return (
    <div className="chat-panel-container" style={{ width: width ? `${width}px` : '440px', minWidth: '360px' }}>
      {/* Sleek Chat Panel Header (48px height, 24px padding matching horizontal grid) */}
      <div style={{
        height: '48px',
        padding: '0 24px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.015)',
        gap: '8px',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            background: 'rgba(168, 85, 247, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Bot size={14} color="var(--accent-light)" />
          </div>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>AI Assistant</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1, justifyContent: 'flex-end' }}>
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            aria-label="Select AI Model"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '6px',
              color: '#f3f4f6',
              fontSize: '11.5px',
              fontWeight: 500,
              padding: '4px 8px',
              outline: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              colorScheme: 'dark',
              maxWidth: '220px',
              minWidth: '140px',
              textOverflow: 'ellipsis'
            }}
          >
            <optgroup label="Xkiro AI Platform (Free)" style={{ background: '#141724', color: '#c084fc', fontWeight: 600 }}>
              {MODELS.filter(m => m.provider === 'xkiro').map(m => (
                <option key={m.id} value={m.id} style={{ background: '#181b28', color: '#f3f4f6' }}>{m.name}</option>
              ))}
            </optgroup>
            <optgroup label="AWS Bedrock (High Perf)" style={{ background: '#141724', color: '#c084fc', fontWeight: 600 }}>
              {MODELS.filter(m => m.provider === 'aws').map(m => (
                <option key={m.id} value={m.id} style={{ background: '#181b28', color: '#f3f4f6' }}>{m.name}</option>
              ))}
            </optgroup>
            <optgroup label="Cloudflare (Free & Fast)" style={{ background: '#141724', color: '#c084fc', fontWeight: 600 }}>
              {MODELS.filter(m => m.provider === 'cloudflare').map(m => (
                <option key={m.id} value={m.id} style={{ background: '#181b28', color: '#f3f4f6' }}>{m.name}</option>
              ))}
            </optgroup>
          </select>

          <div style={{ 
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
              background: isConnected ? 'var(--color-success)' : '#f59e0b', 
              boxShadow: isConnected ? '0 0 6px rgba(16, 185, 129, 0.6)' : 'none' 
            }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
              {isConnected ? 'Active' : 'Connecting'}
            </span>
          </div>

          <button 
            className="icon-btn"
            onClick={handleClearChat}
            title="Clear conversation history"
            style={{ padding: '4px', flexShrink: 0 }}
          >
            <Trash2 size={13} />
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
                  ? 'rgba(168, 85, 247, 0.12)'
                  : 'rgba(255, 255, 255, 0.08)',
                border: isAi ? '1px solid rgba(168, 85, 247, 0.25)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '4px'
              }}>
                {isAi ? <Bot size={13} color="var(--color-ai)" /> : <User size={13} color="#ffffff" />}
              </div>
              
              <div style={{ 
                maxWidth: isAi ? 'calc(100% - 36px)' : '85%',
                flex: isAi ? 1 : 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: isAi ? 'flex-start' : 'flex-end',
                gap: '6px'
              }}>
                {/* Clean Author Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  color: 'var(--text-muted)',
                  padding: '0 2px'
                }}>
                  <span>{isAi ? 'BRAINHALF' : 'YOU'}</span>
                  {isAi && (
                    <span style={{
                      fontSize: '9.5px',
                      background: 'rgba(168, 85, 247, 0.1)',
                      color: 'var(--color-ai)',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontWeight: 500
                    }}>
                      {MODELS.find(m => m.id === selectedModelId)?.name || 'AI'}
                    </span>
                  )}
                </div>

                {msg.role === 'user' ? (
                  /* Clean User Message (Subtle contrast, no harsh box) */
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#f3f4f6',
                    padding: '12px 16px',
                    borderRadius: '6px',
                    fontSize: '13.5px',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    border: 'none',
                    boxShadow: 'none'
                  }}>
                    {msg.content}
                  </div>
                ) : (
                  /* Structured AI Response (Unboxed natural flow, no nested card) */
                  <div style={{
                    background: 'transparent',
                    color: '#e2e8f0',
                    padding: '2px 0',
                    borderRadius: '0',
                    fontSize: '13.5px',
                    lineHeight: 1.65,
                    border: 'none',
                    boxShadow: 'none',
                    width: '100%',
                    boxSizing: 'border-box'
                  }}>
                    {(() => {
                      const { segments } = parseMessageSegments(msg.content, !isCurrentGenerating);

                      if (segments.length === 0) {
                        return isCurrentGenerating ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-light)', fontSize: '13px', fontWeight: 500 }}>
                            <Loader2 size={15} className="lucide-spin" style={{ color: 'var(--color-ai)' }} />
                            <span>Thinking and writing code...</span>
                          </div>
                        ) : null;
                      }

                      const fileSegments = segments.filter(s => s.type === 'file');

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {fileSegments.length > 1 && (
                            <div className="file-change-summary-bar">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <CheckCircle2 size={13} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                                <span style={{ fontWeight: 600 }}>AI generated {fileSegments.length} files</span>
                              </div>
                              <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                                {fileSegments.map(f => f.path.split('/').pop()).join(' • ')}
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
        {messages.length <= 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em' }}>
              Quick Templates
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
              {STARTER_PROMPTS.map((sp, sIdx) => (
                <div
                  key={sIdx}
                  onClick={() => handleSendMessage(`Build an app: ${sp.title} - ${sp.desc}`)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.025)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    transition: 'all 0.15s ease'
                  }}
                  className="hover-bright"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(`Build an app: ${sp.title} - ${sp.desc}`); }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>{sp.title}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{sp.desc}</span>
                  </div>
                  <ArrowRight size={13} style={{ color: 'var(--color-neutral)', opacity: 0.6 }} />
                </div>
              ))}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form Bar with Quick Action Chips */}
      <div style={{
        padding: '12px 24px 24px 24px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        {/* Action Chips Bar */}
        <div className="action-chips-container">
          {QUICK_ACTIONS.map((action, aIdx) => (
            <button
              key={aIdx}
              className="action-chip"
              onClick={() => handleSendMessage(action.replace('✦ ', ''))}
              disabled={isGenerating}
              type="button"
            >
              <span>{action}</span>
            </button>
          ))}
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          background: isGenerating ? 'rgba(168, 85, 247, 0.03)' : 'rgba(255, 255, 255, 0.03)',
          border: isGenerating ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid var(--border-subtle)',
          borderRadius: '6px',
          padding: '12px 14px',
          transition: 'all 0.2s ease',
          position: 'relative'
        }} className="chat-input-wrapper">
          {isGenerating && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '6px',
              fontSize: '11px',
              color: '#c084fc',
              fontWeight: 500
            }}>
              <Loader2 size={12} className="lucide-spin" />
              <span>AI is generating code... input locked until complete</span>
            </div>
          )}
          {selectedImage && (
            <div style={{ position: 'relative', width: '56px', height: '56px', marginBottom: '8px', border: '1px solid var(--border-subtle)', borderRadius: '6px' }}>
              <img src={selectedImage} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '5px' }} />
              <button 
                onClick={() => { setSelectedImage(null); setImageType(''); }}
                style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', padding: '2px', cursor: 'pointer' }}
              >
                <X size={12} />
              </button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
            <button
              className="icon-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating}
              style={{ padding: '6px', opacity: isGenerating ? 0.4 : 0.8, borderRadius: '6px' }}
              title="Attach Image / Wireframe"
            >
              <ImagePlus size={16} color="var(--text-secondary)" />
            </button>
            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                  setSelectedImage(event.target?.result as string);
                  setImageType(file.type);
                };
                reader.readAsDataURL(file);
                e.target.value = '';
              }}
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={isGenerating ? "Synthesizing code..." : "Ask AI to build or refine your app..."}
              rows={2}
              disabled={isGenerating}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#f3f4f6',
                fontSize: '13.5px',
                fontFamily: 'inherit',
                resize: 'none',
                outline: 'none',
                lineHeight: 1.5
              }}
            />
            <button 
              onClick={() => handleSendMessage()}
              disabled={(!input.trim() && !selectedImage) || isGenerating}
              style={{ 
                background: ((!input.trim() && !selectedImage) || isGenerating) 
                  ? 'rgba(255, 255, 255, 0.04)' 
                  : 'var(--accent-gradient)',
                color: ((!input.trim() && !selectedImage) || isGenerating) ? 'var(--text-muted)' : '#ffffff',
                border: 'none',
                borderRadius: '6px',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: ((!input.trim() && !selectedImage) || isGenerating) ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: ((!input.trim() && !selectedImage) || isGenerating) ? 'none' : '0 2px 8px rgba(168, 85, 247, 0.35)'
              }}
              title="Send Message (Enter)"
            >
              {isGenerating ? <Loader2 size={15} className="lucide-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
