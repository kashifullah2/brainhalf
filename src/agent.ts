import { Agent, type Connection } from 'agents';
import { tracing } from 'cloudflare:workers';
import { transform } from 'sucrase';

export class ChatAgent extends Agent {
  private ensureSchema() {
    try {
      this.sql`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`;
      
      this.sql`CREATE TABLE IF NOT EXISTS project_files (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`;

      const countRows = [...this.sql`SELECT COUNT(*) as count FROM project_files`];
      if (countRows.length === 0 || countRows[0].count === 0) {
        const defaultApp = `import React from 'react';

export default function App() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: 'linear-gradient(135deg, #0b0c10 0%, #1a1b26 100%)',
      color: '#f8fafc',
      padding: '24px',
      textAlign: 'center'
    }}>
      <div style={{
        maxWidth: '520px',
        padding: '40px 32px',
        borderRadius: '20px',
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(16px)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }}>
        <div style={{
          width: '56px',
          height: '56px',
          borderRadius: '14px',
          background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
          boxShadow: '0 10px 25px -5px rgba(99, 102, 241, 0.4)'
        }}>
          <span style={{ fontSize: '26px' }}>⚡</span>
        </div>
        <h1 style={{
          fontSize: '24px',
          fontWeight: '700',
          margin: '0 0 12px',
          letterSpacing: '-0.02em',
          background: 'linear-gradient(to right, #ffffff, #c4b5fd)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent'
        }}>
          Cloudflare Edge Preview Live
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: '1.6', margin: '0 0 24px' }}>
          Your ultra-fast Edge Preview runtime is connected and ready. Send a prompt in the chat panel to generate custom React components!
        </p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '999px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.25)', color: '#4ade80', fontSize: '12px', fontWeight: 500 }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80' }} />
          Zero Cold-Start Runtime Active
        </div>
      </div>
    </div>
  );
}`;

        const defaultMain = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Edge Preview Error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#f87171', background: '#0f1015', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '12px', padding: '24px', maxWidth: '450px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#f87171', marginBottom: '8px' }}>Preview Error</h3>
            <p style={{ color: '#9ca3af', fontSize: '13px', lineHeight: 1.5, marginBottom: '16px' }}>{this.state.error?.message || 'A render error occurred.'}</p>
            <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 }}>
              Reload Preview
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);`;

        const defaultCss = `* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0;
  background: #0b0c10;
  color: #f8fafc;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}`;

        this.sql`INSERT OR IGNORE INTO project_files (path, content) VALUES ('/src/App.jsx', ${defaultApp});`;
        this.sql`INSERT OR IGNORE INTO project_files (path, content) VALUES ('/src/main.jsx', ${defaultMain});`;
        this.sql`INSERT OR IGNORE INTO project_files (path, content) VALUES ('/src/styles.css', ${defaultCss});`;
      }
    } catch (e) {
      console.warn('SQLite init note:', e);
    }
  }

  private saveTurn(prompt: string, response: string) {
    if (!prompt || !response) return;
    try {
      this.sql`INSERT INTO messages (role, content) VALUES ('user', ${prompt});`;
      this.sql`INSERT INTO messages (role, content) VALUES ('assistant', ${response});`;
      console.log('Saved conversation turn to SQLite for session:', this.name || 'default');
    } catch (e) {
      console.warn('Failed saving turn to SQLite:', e);
    }
  }

  async onConnect(connection: Connection) {
    console.log('Client connected to ChatAgent');
    this.ensureSchema();
    try {
      const rows = [...this.sql`SELECT role, content FROM messages ORDER BY id ASC`];
      connection.send(JSON.stringify({ type: 'history', data: rows }));
    } catch (e) {
      console.warn('Failed retrieving history onConnect:', e);
      connection.send(JSON.stringify({ type: 'history', data: [] }));
    }
  }

  async onMessage(connection: Connection, message: string) {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);

      this.ensureSchema();

      // Handle clearing chat history / starting new project conversation
      if (data.type === 'clear') {
        try {
          this.sql`DELETE FROM messages;`;
          const clearedMsg = JSON.stringify({ type: 'history', data: [] });
          try { connection.send(clearedMsg); } catch (e) {}
          try { this.broadcast(clearedMsg); } catch (e) {}
        } catch (e) {
          console.error('Error clearing history:', e);
        }
        return;
      }

      // Handle syncing project files to Edge SQLite for preview
      if (data.type === 'sync_files' && data.files && typeof data.files === 'object') {
        try {
          for (const [path, content] of Object.entries(data.files)) {
            const cleanPath = path.startsWith('/') ? path : '/' + path;
            const contentStr = content as string;
            this.sql`INSERT INTO project_files (path, content) VALUES (${cleanPath}, ${contentStr})
                     ON CONFLICT(path) DO UPDATE SET content=excluded.content, updated_at=CURRENT_TIMESTAMP;`;
          }
        } catch (e) {
          console.error('Error syncing files to SQLite:', e);
        }
        return;
      }

      const agentId = this.name || 'default';
      const conversationId = 'conv-' + agentId;
      
      let systemPrompt = `You are BrainHalf, an expert AI software developer capable of building beautiful, modern full-stack web applications.
The user wants you to generate or refine a web application. You must output the application code by specifying one or more files.

CODE GENERATION & SURGICAL EDITING RULES:

1. BRAND NEW PROJECTS & FILES:
When creating a brand-new project, a new component, or replacing an entire file from scratch, format your files like this:
<file path="src/App.jsx">
... complete code ...
</file>

2. TARGETED CODE EDITS & FIXING ERRORS (CRITICAL):
When the user asks you to FIX A BUG, REPAIR AN ERROR, or MAKE A TARGETED UPDATE to an existing file:
DO NOT REWRITE THE ENTIRE FILE!
Instead, output a surgical <edit> block containing ONLY the buggy code snippet to search for and the replacement code.

Format:
<edit path="src/App.jsx">
<search>
exact lines of buggy or outdated code from the existing file
</search>
<replace>
corrected code fixing the bug
</replace>
</edit>

You can include multiple <search> and <replace> pairs within the same <edit> block if multiple spots need fixing.
Ensure the text inside <search> accurately matches the existing code lines so it can be cleanly replaced.

CRITICAL RULES:
1. You can create or modify multiple files (e.g. src/App.jsx, src/components/Button.jsx, src/styles.css). Use <file> for new files and <edit> for fixing existing files.
2. The environment is Vite + React. 
3. 'lucide-react' is PRE-INSTALLED. Valid icons: MessageSquare, MessageCircle, Send, Bot, Sparkles, User, Play, RefreshCw, Check, Trash2, Plus, X, Heart, Star, Settings, ChevronRight, Search, ThumbsUp.
   CRITICAL: There is NO 'Chat' icon in lucide-react. For chat, ALWAYS use MessageSquare, MessageCircle, or Send!
4. Tailwind CSS is NOT installed. You MUST use inline styles or generate a normal CSS file (like src/styles.css) and import it.
5. Create beautiful, modern, glassmorphic UI designs. Use gradients, shadows, and smooth borders. Build full responsive layouts: use 100% width with appropriate padding and centered containers (max-width: 600px - 1200px as appropriate for the app type, with margin: 0 auto). Do NOT make apps tiny 300px fixed-width cards unless explicitly requested as a mobile widget. Ensure apps look spacious, well-aligned, and professional on desktop.
6. COMPLETENESS & CLOSURE: When using <file>, write the complete code without shortcuts. When using <edit>, provide the exact search and replace blocks. Always close every tag (</file> or </edit>).
7. SINGLE-TURN COMPLETION: Complete the requested feature or bug fix in this single turn. Never stop halfway.
8. PRESERVE WORKING FEATURES: When fixing an error or bug, preserve all existing working functionality, design, and styling. Never wipe out working components.
9. SELF-CONTAINED CODE: Build components using standard React, CSS, and pre-installed 'lucide-react' icons. Avoid requiring extra npm packages. If you execute a terminal command like <command>npm install library-name</command>, NEVER STOP GENERATING; immediately output the code in <file> or <edit> tags in the same message.
10. Keep conversational text outside the tags very brief (1-2 sentences explaining what bug was fixed or what was built).
`;

      if (data.workspaceFiles && typeof data.workspaceFiles === 'object') {
        let filesSummary = '';
        for (const [path, content] of Object.entries(data.workspaceFiles)) {
          filesSummary += `\n<file path="${path}">\n${content}\n</file>\n`;
        }
        systemPrompt += `\n\n=== CURRENT WORKSPACE FILES ===\nThe user currently has the following files in their project. You can modify existing files by returning an <edit path="..."> block with <search> and <replace> to surgically fix bugs, or create new files with <file path="...">.\n${filesSummary}\n===============================\n`;
      }


      // Retrieve recent conversation history from SQLite for multi-turn context
      let previousMessages: Array<{ role: string; content: string }> = [];
      try {
        const rawHistory = [...this.sql`SELECT role, content FROM messages ORDER BY id DESC LIMIT 6`].reverse();
        previousMessages = rawHistory.map((r: any) => ({
          role: r.role === 'assistant' || r.role === 'ai' ? 'assistant' : 'user',
          content: (r.content as string) || ''
        }));
      } catch (e) {
        console.warn('Error reading history for context:', e);
      }

      let actualPrompt = data.prompt || data.message || 'Hello';
      let isPlannerMode = false;
      if (actualPrompt.startsWith('/plan ')) {
        isPlannerMode = true;
        actualPrompt = actualPrompt.substring(6).trim();
        systemPrompt += `\n\n10. PLANNER MODE ACTIVE: The user has requested a plan. You MUST first output a detailed, step-by-step implementation strategy wrapped exactly in <plan>...</plan> tags. After closing the </plan> tag, immediately proceed to output the code in <file> tags as usual. Do NOT wait for permission to output the code.`;
      }

      const inputMessages = [
        { role: 'system', content: systemPrompt },
        ...previousMessages,
        { role: 'user', content: actualPrompt }
      ];

      // Create the invoke_agent span as required by Cloudflare Agent Tracing
      await tracing.enterSpan('invoke_agent', async (invokeSpan: any) => {
        invokeSpan.setAttribute('gen_ai.operation.name', 'invoke_agent');
        invokeSpan.setAttribute('gen_ai.agent.name', 'brainhalf-agent');
        invokeSpan.setAttribute('gen_ai.agent.id', agentId);
        invokeSpan.setAttribute('gen_ai.conversation.id', conversationId);
        
        // Create the chat span for the model call
        await tracing.enterSpan('chat', async (chatSpan: any) => {
          chatSpan.setAttribute('gen_ai.operation.name', 'chat');
          chatSpan.setAttribute('gen_ai.agent.name', 'brainhalf-agent');
          chatSpan.setAttribute('gen_ai.agent.id', agentId);
          chatSpan.setAttribute('gen_ai.conversation.id', conversationId);
          chatSpan.setAttribute('gen_ai.input.messages', JSON.stringify(inputMessages));

          let handledByBedrock = false;

          const xkiroApiKey = (this as any).env.XKIRO_API_KEY;
          const bedrockApiKey = (this as any).env.BEDROCK_API_KEY;
          const awsKey = (this as any).env.AWS_ACCESS_KEY_ID;
          const awsSecret = (this as any).env.AWS_SECRET_ACCESS_KEY;
          const awsRegion = (this as any).env.AWS_REGION || 'us-east-1';
          const bedrockModel = (data.provider === 'aws' && data.model) ? data.model : ((this as any).env.BEDROCK_MODEL_ID || 'us.meta.llama3-3-70b-instruct-v1:0');
          const xkiroModel = (data.provider === 'xkiro' && data.model) ? data.model : 'qwen/qwen3.8-max:free';

          // 1. If Xkiro Provider
          if (data.provider === 'xkiro' && xkiroApiKey) {
            try {
              console.log(`Attempting Xkiro API SDK with model: ${xkiroModel}`);
              const url = `https://api.xkiro.com/v1/chat/completions`;
              
              // Map inputMessages to xkiro/openai format (inputMessages already includes system prompt)
              const messagesApi = [...inputMessages];
              
              // Simple text-only for now unless xkiro supports multi-modal in openai style, we assume yes
              if (data.image && inputMessages.length > 0) {
                const lastMsg = messagesApi[messagesApi.length - 1];
                if (lastMsg.role === 'user') {
                  const b64 = data.image.startsWith('data:') ? data.image : `data:${data.imageType || 'image/png'};base64,${data.image}`;
                  lastMsg.content = [
                    { type: 'text', text: typeof lastMsg.content === 'string' ? lastMsg.content : (data.prompt || 'Hello') },
                    { type: 'image_url', image_url: { url: b64 } }
                  ] as any;
                }
              }

              const res = await fetch(url, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${xkiroApiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  model: xkiroModel,
                  messages: messagesApi,
                  stream: true,
                  max_tokens: 4096,
                  temperature: 0.3
                })
              });

              if (res.ok && res.body) {
                console.log(`Connected to Xkiro Stream: ${xkiroModel}`);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let outputContent = '';
                let sseBuffer = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  
                  sseBuffer += decoder.decode(value, { stream: true });
                  const lines = sseBuffer.split('\n');
                  sseBuffer = lines.pop() || '';

                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                      const parsed = JSON.parse(jsonStr);
                      const text = parsed.choices?.[0]?.delta?.content;
                      if (text) {
                        outputContent += text;
                        const msg = JSON.stringify({
                          type: 'stream',
                          chunk: { response: text, done: false }
                        });
                        try { connection.send(msg); } catch (e) {}
                        try { this.broadcast(msg, [connection.id]); } catch (e) {}
                      }
                    } catch (e) {}
                  }
                }

                // Broadcast stream completion signal
                const doneMsg = JSON.stringify({
                  type: 'stream',
                  chunk: { response: '', done: true }
                });
                try { connection.send(doneMsg); } catch (e) {}
                try { this.broadcast(doneMsg, [connection.id]); } catch (e) {}

                const outputMessages = [{ role: 'ai', content: outputContent }];
                chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify(outputMessages));
                this.saveTurn(actualPrompt, outputContent);
                handledByBedrock = true; // reusing this flag to skip CF fallback
              } else {
                const errText = await res.text();
                console.warn(`Xkiro API returned ${res.status}:`, errText);
              }
            } catch (err) {
              console.warn('Xkiro API call failed, falling back:', err);
            }
          }
          // 2. If long-term Bedrock API Key (ABSK bearer token) is provided (and not explicitly forced to cloudflare)
          else if (bedrockApiKey && data.provider !== 'cloudflare') {
            try {
              console.log(`Invoking AWS Bedrock via Bearer API Key with model: ${bedrockModel} in ${awsRegion}`);
              const url = `https://bedrock-runtime.${awsRegion}.amazonaws.com/model/${encodeURIComponent(bedrockModel)}/converse-stream`;
              
              let userContentApi: any[] = [{ text: actualPrompt }];
              if (data.image) {
                const base64str = data.image.split(',')[1] || data.image;
                const formatMatch = data.imageType?.match(/image\/(png|jpeg|gif|webp)/);
                const format = formatMatch ? formatMatch[1] : 'png';
                userContentApi.push({
                  image: {
                    format,
                    source: { bytes: base64str }
                  }
                });
              }
              
              const bedrockHistory = previousMessages.map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: [{ text: m.content }]
              }));

              const res = await fetch(url, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${bedrockApiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  system: [{ text: systemPrompt }],
                  messages: [
                    ...bedrockHistory,
                    {
                      role: 'user',
                      content: userContentApi
                    }
                  ],
                  inferenceConfig: {
                    maxTokens: 4096,
                    temperature: 0.3
                  }
                })
              });

              if (res.ok && res.body) {
                console.log(`Connected to Bedrock Bearer Stream: ${bedrockModel}`);
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let outputContent = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const chunkStr = decoder.decode(value, { stream: true });

                  // Extract all text deltas from the AWS eventstream
                  const matches = chunkStr.matchAll(/"delta"\s*:\s*\{\s*"text"\s*:\s*("(?:\\.|[^"\\])*")/g);
                  for (const match of matches) {
                    try {
                      const text = JSON.parse(match[1]);
                      if (text) {
                        outputContent += text;
                        const msg = JSON.stringify({
                          type: 'stream',
                          chunk: { response: text, done: false }
                        });
                        try { connection.send(msg); } catch (e) {}
                        try { this.broadcast(msg, [connection.id]); } catch (e) {}
                      }
                    } catch (e) {}
                  }
                }

                // Broadcast stream completion signal
                const doneMsg = JSON.stringify({
                  type: 'stream',
                  chunk: { response: '', done: true }
                });
                try { connection.send(doneMsg); } catch (e) {}
                try { this.broadcast(doneMsg, [connection.id]); } catch (e) {}

                const outputMessages = [{ role: 'ai', content: outputContent }];
                chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify(outputMessages));
                this.saveTurn(actualPrompt, outputContent);
                handledByBedrock = true;
              } else {
                const errText = await res.text();
                console.warn(`Bedrock Bearer API returned ${res.status}:`, errText);
              }
            } catch (err) {
              console.warn('Bedrock Bearer API call failed, falling back:', err);
            }
          } 
          // 2. If standard AWS IAM credentials are provided (and not explicitly forced to cloudflare)
          else if (awsKey && awsSecret && data.provider !== 'cloudflare') {
            try {
              console.log(`Attempting AWS Bedrock SDK with model: ${bedrockModel} in region: ${awsRegion}`);
              const { BedrockRuntimeClient, ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');
              
              let userContentSdk: any[] = [{ text: actualPrompt }];
              if (data.image) {
                const base64str = data.image.split(',')[1] || data.image;
                const formatMatch = data.imageType?.match(/image\/(png|jpeg|gif|webp)/);
                const format = formatMatch ? formatMatch[1] : 'png';
                // Buffer is available globally in Node/Cloudflare
                const buffer = Buffer.from(base64str, 'base64');
                userContentSdk.push({
                  image: {
                    format,
                    source: { bytes: new Uint8Array(buffer) }
                  }
                });
              }

              const bedrockHistory = previousMessages.map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: [{ text: m.content }]
              }));

              const bedrockClient = new BedrockRuntimeClient({
                region: awsRegion,
                credentials: {
                  accessKeyId: awsKey,
                  secretAccessKey: awsSecret,
                },
              });

              const command = new ConverseStreamCommand({
                modelId: bedrockModel,
                system: [{ text: systemPrompt }],
                messages: [
                  ...bedrockHistory,
                  {
                    role: 'user',
                    content: userContentSdk
                  }
                ] as any,
                inferenceConfig: {
                  maxTokens: 4096,
                  temperature: 0.3
                }
              });

              const bedrockResponse = await bedrockClient.send(command);

              if (bedrockResponse.stream) {
                console.log(`Connected to AWS Bedrock stream: ${bedrockModel}`);
                let outputContent = '';

                for await (const item of bedrockResponse.stream) {
                  const token = item.contentBlockDelta?.delta?.text;
                  if (token) {
                    outputContent += token;
                    const msg = JSON.stringify({
                      type: 'stream',
                      chunk: { response: token, done: false }
                    });
                    try { connection.send(msg); } catch (e) {}
                    try { this.broadcast(msg, [connection.id]); } catch (e) {}
                  }
                }

                const doneMsg = JSON.stringify({
                  type: 'stream',
                  chunk: { response: '', done: true }
                });
                try { connection.send(doneMsg); } catch (e) {}
                try { this.broadcast(doneMsg, [connection.id]); } catch (e) {}

                const outputMessages = [{ role: 'ai', content: outputContent }];
                chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify(outputMessages));
                this.saveTurn(actualPrompt, outputContent);
                handledByBedrock = true;
              }
            } catch (bErr) {
              console.warn('AWS Bedrock SDK failed, falling back to Cloudflare Workers AI:', bErr);
              handledByBedrock = false;
            }
          }

          if (!handledByBedrock) {
            const candidateModels = [
              '@cf/zai-org/glm-5.3-flash',
              '@cf/moonshotai/kimi-k2.7-code',
              '@cf/qwen/qwen3.8-27b',
              '@cf/qwen/qwen2.5-coder-32b-instruct',
              '@cf/meta/llama-3.1-8b-instruct-fp8',
              '@cf/meta/llama-3.2-3b-instruct',
              '@cf/mistral/mistral-7b-instruct-v0.2-lora'
            ];

            if (data.provider === 'cloudflare' && data.model) {
              candidateModels.unshift(data.model);
            }

            let aiResponse: any = null;
            let selectedModel = '';

            for (const model of candidateModels) {
              try {
                console.log(`Attempting Cloudflare AI model: ${model} with max_tokens: 3500`);
                try {
                  aiResponse = await (this as any).env.AI.run(model, {
                    messages: inputMessages,
                    stream: true,
                    max_tokens: 3500,
                    chat_template_kwargs: { enable_thinking: false }
                  });
                } catch {
                  aiResponse = await (this as any).env.AI.run(model, {
                    messages: inputMessages,
                    stream: true,
                    max_tokens: 3500
                  });
                }
                if (aiResponse) {
                  selectedModel = model;
                  break;
                }
              } catch (mErr) {
                console.warn(`Model ${model} failed with max_tokens 3500, trying with 2048:`, mErr);
                try {
                  aiResponse = await (this as any).env.AI.run(model, {
                    messages: inputMessages,
                    stream: true,
                    max_tokens: 2048
                  });
                  if (aiResponse) {
                    selectedModel = model;
                    break;
                  }
                } catch (retryErr) {
                  console.warn(`Model ${model} retry also failed:`, retryErr);
                }
              }
            }

            if (!aiResponse) {
              throw new Error('All candidate AI models failed to respond.');
            }

            console.log(`Connected to Cloudflare AI model: ${selectedModel}`);
            let outputContent = '';
            const decoder = new TextDecoder();
            let sseBuffer = '';

            const extractToken = (obj: any): string | undefined => {
              if (!obj || typeof obj !== 'object') return undefined;
              return obj.response ?? obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.delta?.reasoning_content ?? obj.choices?.[0]?.text;
            };

            // Stream back to client via WebSocket with robust SSE decoding
            for await (const rawChunk of aiResponse) {
              // If already parsed object with response or choices delta
              const directText = extractToken(rawChunk);
              if (directText) {
                outputContent += directText;
                const msg = JSON.stringify({ 
                  type: 'stream', 
                  chunk: { response: directText, done: false } 
                });
                try { connection.send(msg); } catch (e) {}
                try { this.broadcast(msg, [connection.id]); } catch (e) {}
                continue;
              }

              // Decode bytes to text
              const textChunk = typeof rawChunk === 'string' 
                ? rawChunk 
                : decoder.decode(rawChunk, { stream: true });
              
              sseBuffer += textChunk;
              const lines = sseBuffer.split('\n');
              sseBuffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;
                const jsonStr = trimmed.slice(5).trim();
                if (jsonStr === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(jsonStr);
                  const token = extractToken(parsed);
                  if (token) {
                    outputContent += token;
                    const msg = JSON.stringify({ 
                      type: 'stream', 
                      chunk: { response: token, done: false } 
                    });
                    try { connection.send(msg); } catch (e) {}
                    try { this.broadcast(msg, [connection.id]); } catch (e) {}
                  }
                } catch (e) {
                  // Ignore partial JSON
                }
              }
            }

            // Process any trailing sseBuffer
            if (sseBuffer.trim().startsWith('data:')) {
              const jsonStr = sseBuffer.trim().slice(5).trim();
              if (jsonStr && jsonStr !== '[DONE]') {
                try {
                  const parsed = JSON.parse(jsonStr);
                  const token = extractToken(parsed);
                  if (token) {
                    outputContent += token;
                    const msg = JSON.stringify({ 
                      type: 'stream', 
                      chunk: { response: token, done: false } 
                    });
                    try { connection.send(msg); } catch (e) {}
                    try { this.broadcast(msg, [connection.id]); } catch (e) {}
                  }
                } catch (e) {}
              }
            }

            // Broadcast stream completion signal
            const doneMsg = JSON.stringify({ 
              type: 'stream', 
              chunk: { response: '', done: true } 
            });
            try { connection.send(doneMsg); } catch (e) {}
            try { this.broadcast(doneMsg, [connection.id]); } catch (e) {}

            // Store the output payload on the span
            const outputMessages = [{ role: 'ai', content: outputContent }];
            chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify(outputMessages));
            this.saveTurn(actualPrompt, outputContent);
          }
        });
      });
    } catch (err: any) {
      console.error('Error handling message in ChatAgent:', err);
      const errMsg = JSON.stringify({
        type: 'error',
        error: err?.message || 'Failed to process AI generation.'
      });
      try { connection.send(errMsg); } catch (e) {}
      try { this.broadcast(errMsg); } catch (e) {}
    }
  }

  onError(error: unknown) {
    console.error('WebSocket connection error:', error);
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Redirect /preview/:id to /preview/:id/ so relative imports resolve properly
    if (url.pathname.match(/^\/preview\/[^/]+$/)) {
      return Response.redirect(`${url.origin}${url.pathname}/`, 301);
    }

    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Security-Policy': "frame-ancestors *",
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const pathMatch = url.pathname.match(/^\/preview\/[^/]+(.*)$/);
    let path = pathMatch ? pathMatch[1] : url.pathname;
    
    if (path === '' || path === '/') {
      path = '/index.html';
    }

    this.ensureSchema();

    // Serve custom index.html with ESM Import Map
    if (path === '/index.html') {
      const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BrainHalf Edge Preview</title>
    <link rel="preconnect" href="https://esm.sh" crossorigin />
    <link rel="modulepreload" href="https://esm.sh/react@18.2.0" />
    <link rel="modulepreload" href="https://esm.sh/react-dom@18.2.0/client" />
    <link rel="modulepreload" href="https://esm.sh/lucide-react@0.294.0?external=react" />
    <script type="importmap">
      {
        "imports": {
          "react": "https://esm.sh/react@18.2.0",
          "react-dom/client": "https://esm.sh/react-dom@18.2.0/client",
          "lucide-react": "https://esm.sh/lucide-react@0.294.0?external=react"
        }
      }
    </script>
    <style>
      body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; background: #090a0f; color: #fff; }
      @keyframes bh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes bh-pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
      .bh-preview-loader {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        min-height: 100vh; gap: 14px; color: #94a3b8; font-size: 13px; font-weight: 500;
        animation: bh-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }
      .bh-spinner {
        width: 24px; height: 24px; border: 2.5px solid rgba(99, 102, 241, 0.2);
        border-top-color: #6366f1; border-radius: 50%; animation: bh-spin 0.8s linear infinite;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div class="bh-preview-loader">
        <div class="bh-spinner"></div>
        <span>Rendering preview...</span>
      </div>
    </div>
    <script type="module">
      import { createRoot } from 'react-dom/client';
      import React from 'react';
      
      // Auto-mount main
      import('./src/main.jsx').catch(e => {
        if (e.message && e.message.includes('src/main.jsx')) {
          console.log('Falling back to ./src/main.tsx');
          import('./src/main.tsx').catch(console.error);
        } else {
          console.error('Preview Load Error:', e);
        }
      });
    </script>
  </body>
</html>`;
      return new Response(html, { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        } 
      });
    }

    // Serve project files from SQLite
    try {
      const cleanPath = path.startsWith('/') ? path : '/' + path;
      const rows = [...this.sql`SELECT content FROM project_files WHERE path = ${cleanPath}`];
      
      if (rows.length > 0) {
        let content = rows[0].content as string;
        
        // Edge Transpilation for React/TSX
        if (path.endsWith('.jsx') || path.endsWith('.tsx') || path.endsWith('.ts')) {
          try {
            // Strip any wrapping markdown code fences if the model included them inside the tag
            content = content.replace(/^\s*```(?:[a-zA-Z0-9_-]+)?\r?\n/, '').replace(/\r?\n```\s*$/, '');
            content = transform(content, { transforms: ['typescript', 'jsx'] }).code;
            
            // Fix CSS imports (inject link tag dynamically)
            content = content.replace(/import\s+['"]([^'"]+\.css)['"]/g, (match, p1) => {
              return `
                (function() {
                  const link = document.createElement('link');
                  link.rel = 'stylesheet';
                  link.href = '${p1}';
                  document.head.appendChild(link);
                })();
              `;
            });

            // Very basic ESM local path resolution fixing (appending .jsx if no extension provided)
            content = content.replace(/from\s+['"](\.[^'"]+)['"]/g, (match, p1) => {
              if (p1.endsWith('.css') || p1.endsWith('.jsx') || p1.endsWith('.tsx') || p1.endsWith('.ts')) return match;
              return `from '${p1}.jsx'`; // default guess for edge preview local components
            });
            
          } catch (e: any) {
            console.error('Transpile error for', path, e);
            return new Response(`console.error("Transpile Error:\\n" + ${JSON.stringify(e.message)});`, {
              headers: { 
                ...corsHeaders,
                'Content-Type': 'application/javascript; charset=utf-8' 
              }
            });
          }
          return new Response(content, { 
            headers: { 
              ...corsHeaders,
              'Content-Type': 'application/javascript; charset=utf-8' 
            } 
          });
        }
        
        if (path.endsWith('.css')) {
          return new Response(content, { 
            headers: { 
              ...corsHeaders,
              'Content-Type': 'text/css; charset=utf-8' 
            } 
          });
        }
        if (path.endsWith('.json')) {
          return new Response(content, { 
            headers: { 
              ...corsHeaders,
              'Content-Type': 'application/json; charset=utf-8' 
            } 
          });
        }
        
        return new Response(content, { 
          headers: { 
            ...corsHeaders,
            'Content-Type': 'text/plain; charset=utf-8' 
          } 
        });
      }
    } catch (e) {
      console.error('Error querying file:', path, e);
    }

    return new Response('404 Not Found in Edge Preview', { 
      status: 404,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain'
      }
    });
  }
}

