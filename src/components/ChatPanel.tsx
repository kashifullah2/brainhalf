import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, Loader2, Trash2, RefreshCw, ImagePlus, X } from 'lucide-react';
import { appEvents } from '../lib/events';
import { parseMessageSegments } from '../lib/message-parser';
import CodeFileBlock from './CodeFileBlock';
import CommandBlock from './CommandBlock';
import PlanBlock from './PlanBlock';

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
}

const ChatPanel: React.FC<ChatPanelProps> = ({ activeProjectId = 'default' }) => {
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
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/agents/chat-agent/${activeProjectId}`;
      
      console.log(`Connecting to Durable Object session: ${activeProjectId}`);
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

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimer);
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

  const handleSendMessage = (overrideMessage?: string, overrideImage?: string | null, overrideImageType?: string) => {
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
  };

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
  }, [activeProjectId, selectedModelId]); // Add deps to avoid stale closures, though handleSendMessage references refs mostly.


  return (
    <div className="chat-panel-container">
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.015)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '26px',
            height: '26px',
            borderRadius: '6px',
            background: 'rgba(168, 85, 247, 0.15)',
            border: '1px solid rgba(168, 85, 247, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Bot size={15} color="var(--accent-light)" />
          </div>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)' }}>AI Assistant</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              padding: '4px 8px',
              outline: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            <optgroup label="AWS Bedrock (High Perf)">
              {MODELS.filter(m => m.provider === 'aws').map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </optgroup>
            <optgroup label="Cloudflare (Free & Fast)">
              {MODELS.filter(m => m.provider === 'cloudflare').map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </optgroup>
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ 
              width: '6px', 
              height: '6px', 
              borderRadius: '50%', 
              background: isConnected ? '#10b981' : '#f59e0b', 
              boxShadow: isConnected ? '0 0 6px rgba(16, 185, 129, 0.6)' : 'none' 
            }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {isConnected ? 'Session Active' : 'Connecting'}
            </span>
          </div>

          <button 
            className="icon-btn"
            onClick={handleClearChat}
            title="Clear conversation history"
            style={{ padding: '3px' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      
      <div style={{ flex: 1, padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {messages.map((msg, idx) => {
          const isLastMessage = idx === messages.length - 1;
          const isCurrentGenerating = isGenerating && isLastMessage;

          return (
            <div key={idx} style={{ display: 'flex', gap: '10px', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              {msg.role === 'ai' && (
                <div style={{
                  width: '30px', height: '30px', borderRadius: '50%', background: 'var(--bg-base)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-subtle)',
                  flexShrink: 0, marginTop: '2px'
                }}>
                  <Bot size={15} color="var(--accent-primary)" />
                </div>
              )}
              
              <div style={{ 
                maxWidth: msg.role === 'user' ? '82%' : '100%',
                flex: msg.role === 'ai' ? 1 : 'none'
              }}>
                {msg.role === 'user' ? (
                  <div style={{
                    background: 'var(--accent-gradient)',
                    color: 'white',
                    padding: '10px 14px',
                    borderRadius: '16px 16px 0 16px',
                    fontSize: '14px',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap'
                  }}>
                    {msg.content}
                  </div>
                ) : (
                  <div className="chat-bubble-ai">
                    {(() => {
                      const { segments } = parseMessageSegments(msg.content, !isCurrentGenerating);

                      if (segments.length === 0) {
                        return isCurrentGenerating ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                            <Loader2 size={15} className="lucide-spin" style={{ color: 'var(--accent-secondary)' }} />
                            <span>Thinking and writing code...</span>
                          </div>
                        ) : null;
                      }

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {segments.map((seg, sIdx) => {
                            if (seg.type === 'text') {
                              return (
                                <div key={sIdx} style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
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
        <div ref={messagesEndRef} />
      </div>

      <div style={{
        padding: '14px 16px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'rgba(255, 255, 255, 0.015)'
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-canvas)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '8px 12px',
          boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.4)',
        }} className="chat-input-wrapper">
          {selectedImage && (
            <div style={{ position: 'relative', width: '60px', height: '60px', marginBottom: '8px', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
              <img src={selectedImage} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '7px' }} />
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
              style={{ padding: '4px', opacity: isGenerating ? 0.5 : 1 }}
              title="Attach Image"
            >
              <ImagePlus size={18} color="var(--text-secondary)" />
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
            placeholder="Ask AI to build or refine your app..."
            rows={2}
            disabled={isGenerating}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-primary)',
              fontSize: '14px',
              fontFamily: 'inherit',
              resize: 'none',
              outline: 'none',
              lineHeight: 1.5
            }}
          />
            <button 
              className="send-btn"
              onClick={() => handleSendMessage()}
              disabled={(!input.trim() && !selectedImage) || isGenerating}
              style={{ opacity: ((!input.trim() && !selectedImage) || isGenerating) ? 0.4 : 1, padding: '6px' }}
            >
              {isGenerating ? <Loader2 size={16} className="lucide-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
