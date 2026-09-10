import { Agent, type Connection } from 'agents';
import { tracing } from 'cloudflare:workers';
import { transform } from 'sucrase';
import { normalizePath } from './lib/utils';

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
import * as AppModule from './App.jsx';
import './styles.css';

const App = AppModule.default || AppModule.App || Object.values(AppModule).find(v => typeof v === 'function') || (() => React.createElement('div', { style: { padding: '24px', color: '#f87171' } }, 'No component found in App.jsx'));

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
          try { connection.send(clearedMsg); } catch {}
          try { this.broadcast(clearedMsg); } catch {}
        } catch (e) {
          console.error('Error clearing history:', e);
        }
        return;
      }

      // Handle syncing project files to Edge SQLite for preview
      if (data.type === 'sync_files' && data.files && typeof data.files === 'object') {
        try {
          if (data.replace_all) {
            this.sql`DELETE FROM project_files;`;
          }
          for (const [path, content] of Object.entries(data.files)) {
            const cleanPath = normalizePath(path);
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
      
      let systemPrompt = `You are BrainHalf, an autonomous software engineering AGENT, NOT a conversational chatbot.
Your purpose is to build, edit, and maintain web applications directly in the user's project workspace.

CRITICAL FORMAT REQUIREMENT:
- You must NEVER write code inside raw markdown code blocks (such as \`\`\`jsx ... \`\`\`) in chat.
- All code MUST be enclosed in <file path="...">...</file> or <edit path="...">...</edit> tags.
- The IDE runtime engine CANNOT load or preview code that is written as plain markdown in chat.
- If you write code, it MUST be wrapped in <file path="src/App.jsx">...</file> or <edit path="...">...</edit>.

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
10. Keep conversational text outside the tags very brief (1-2 sentences explaining what was created or fixed). Never write code outside <file> or <edit> tags.
`;

      let filesToInclude: Record<string, string> = {};
      if (data.workspaceFiles && typeof data.workspaceFiles === 'object' && Object.keys(data.workspaceFiles).length > 0) {
        filesToInclude = data.workspaceFiles;
      } else {
        try {
          const dbFiles = [...this.sql`SELECT path, content FROM project_files LIMIT 20`];
          for (const row of dbFiles) {
            filesToInclude[row.path as string] = row.content as string;
          }
        } catch (e) {
          console.warn('Error reading project_files from DB:', e);
        }
      }

      if (Object.keys(filesToInclude).length > 0) {
        let filesSummary = '';
        for (const [path, content] of Object.entries(filesToInclude)) {
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
      let _isPlannerMode = false;
      if (actualPrompt.startsWith('/plan ')) {
        _isPlannerMode = true;
        actualPrompt = actualPrompt.substring(6).trim();
        systemPrompt += `\n\n10. PLANNER MODE ACTIVE: The user has requested a plan. You MUST first output a detailed, step-by-step implementation strategy wrapped exactly in <plan>...</plan> tags. After closing the </plan> tag, immediately proceed to output the code in <file> tags as usual. Do NOT wait for permission to output the code.`;
      }

      const isErrorFixing = /\[Auto-Fix\]|error|syntax|transpile|unexpected token|cannot find|not defined|is not a function/i.test(actualPrompt);

      let formatDirective = '';
      if (isErrorFixing) {
        formatDirective = `\n\n[ERROR RESOLUTION DIRECTIVE:
1. SINCERELY FIX THE SPECIFIC ERROR: Inspect the exact error message and the target file in CURRENT WORKSPACE FILES.
2. SURGICAL EDIT PREFERRED: Use <edit path="..."> with exact <search>...</search> and <replace>...</replace> to fix only the broken lines. DO NOT rewrite the entire component from scratch if only a few lines or imports are broken.
3. PREVENT TOKEN TRUNCATION: If you must output a full <file path="...">, keep the implementation concise and modular so it finishes completely. Never truncate mid-expression.
4. SYNTAX INTEGRITY: Ensure all JSX tags have matching closing tags, all brackets/parentheses are balanced, and all imports exist.]`;
      } else {
        formatDirective = `\n\n[FORMAT DIRECTIVE: Output all code inside <file path="src/App.jsx">...</file> or targeted <edit path="...">...</edit> tags so it compiles directly into the workspace files. Do not output raw markdown code blocks.]`;
      }

      const formattedUserPrompt = actualPrompt.includes('<file') || actualPrompt.includes('<edit')
        ? actualPrompt
        : `${actualPrompt}${formatDirective}`;

      const inputMessages = [
        { role: 'system', content: systemPrompt },
        ...previousMessages,
        { role: 'user', content: formattedUserPrompt }
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
          const requestedMaxTokens = Number(data.max_tokens || data.maxTokens) || 8192;

          // 1. If Xkiro Provider
          if (data.provider === 'xkiro' && xkiroApiKey) {
            try {
              console.log(`Attempting Xkiro API SDK with model: ${xkiroModel} and max_tokens: ${requestedMaxTokens}`);
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

              const requestBody: any = {
                model: xkiroModel,
                messages: messagesApi,
                stream: true,
                temperature: 0.3
              };
              if (data.max_tokens || data.maxTokens) {
                requestBody.max_tokens = Number(data.max_tokens || data.maxTokens);
              }

              const res = await fetch(url, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${xkiroApiKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
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
                        try { connection.send(msg); } catch {}
                        try { this.broadcast(msg, [connection.id]); } catch {}
                      }
                    } catch {}
                  }
                }

                // Broadcast stream completion signal
                const doneMsg = JSON.stringify({
                  type: 'stream',
                  chunk: { response: '', done: true }
                });
                try { connection.send(doneMsg); } catch {}
                try { this.broadcast(doneMsg, [connection.id]); } catch {}

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
                    maxTokens: Math.min(requestedMaxTokens, 8192),
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
                        try { connection.send(msg); } catch {}
                        try { this.broadcast(msg, [connection.id]); } catch {}
                      }
                    } catch {}
                  }
                }

                // Broadcast stream completion signal
                const doneMsg = JSON.stringify({
                  type: 'stream',
                  chunk: { response: '', done: true }
                });
                try { connection.send(doneMsg); } catch {}
                try { this.broadcast(doneMsg, [connection.id]); } catch {}

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
              
              let userContentSdk: any[] = [{ text: formattedUserPrompt }];
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
                  maxTokens: Math.min(requestedMaxTokens, 8192),
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
                    try { connection.send(msg); } catch {}
                    try { this.broadcast(msg, [connection.id]); } catch {}
                  }
                }

                const doneMsg = JSON.stringify({
                  type: 'stream',
                  chunk: { response: '', done: true }
                });
                try { connection.send(doneMsg); } catch {}
                try { this.broadcast(doneMsg, [connection.id]); } catch {}

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
              '@cf/qwen/qwen2.5-coder-32b-instruct',
              '@cf/meta/llama-3.1-8b-instruct-fp8',
              '@cf/zai-org/glm-5.3-flash',
              '@cf/moonshotai/kimi-k2.7-code',
              '@cf/qwen/qwen3.8-27b',
              '@cf/meta/llama-3.2-3b-instruct',
              '@cf/mistral/mistral-7b-instruct-v0.2-lora'
            ];

            if (data.provider === 'cloudflare' && data.model) {
              candidateModels.unshift(data.model);
            }

            let aiResponse: any = null;
            let selectedModel = '';

            for (const model of candidateModels) {
              // 1. Unlimited generation attempt (no max_tokens restriction)
              try {
                console.log(`Attempting Cloudflare AI model (unlimited tokens): ${model}`);
                try {
                  aiResponse = await (this as any).env.AI.run(model, {
                    messages: inputMessages,
                    stream: true,
                    chat_template_kwargs: { enable_thinking: false }
                  });
                } catch {
                  aiResponse = await (this as any).env.AI.run(model, {
                    messages: inputMessages,
                    stream: true
                  });
                }
                if (aiResponse) {
                  selectedModel = model;
                  break;
                }
              } catch (unlimitedErr) {
                console.warn(`Model ${model} unlimited attempt failed, falling back with maximum tokens:`, unlimitedErr);
                // Fallback for models requiring explicit max_tokens
                for (const tokens of [16384, 8192, 4096]) {
                  try {
                    aiResponse = await (this as any).env.AI.run(model, {
                      messages: inputMessages,
                      stream: true,
                      max_tokens: tokens
                    });
                    if (aiResponse) {
                      selectedModel = model;
                      break;
                    }
                  } catch {}
                }
                if (aiResponse) break;
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
                try { connection.send(msg); } catch {}
                try { this.broadcast(msg, [connection.id]); } catch {}
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
                    try { connection.send(msg); } catch {}
                    try { this.broadcast(msg, [connection.id]); } catch {}
                  }
                } catch {
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
                    try { connection.send(msg); } catch {}
                    try { this.broadcast(msg, [connection.id]); } catch {}
                  }
                } catch {}
              }
            }

            // Broadcast stream completion signal
            const doneMsg = JSON.stringify({ 
              type: 'stream', 
              chunk: { response: '', done: true } 
            });
            try { connection.send(doneMsg); } catch {}
            try { this.broadcast(doneMsg, [connection.id]); } catch {}

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
      try { connection.send(errMsg); } catch {}
      try { this.broadcast(errMsg); } catch {}
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
          "react/": "https://esm.sh/react@18.2.0/",
          "react-dom": "https://esm.sh/react-dom@18.2.0?external=react",
          "react-dom/": "https://esm.sh/react-dom@18.2.0/",
          "react-dom/client": "https://esm.sh/react-dom@18.2.0/client?external=react",
          "lucide-react": "https://esm.sh/lucide-react@0.344.0?external=react",
          "lucide-react/": "https://esm.sh/lucide-react@0.344.0?external=react/"
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

      window.addEventListener('error', (event) => {
        try {
          if (window.parent) {
            window.parent.postMessage({
              type: 'preview-error',
              file: event.filename || 'preview',
              error: event.message || 'Unknown runtime error',
              lineno: event.lineno,
              colno: event.colno
            }, '*');
          }
        } catch (_) {}
      });

      window.addEventListener('unhandledrejection', (event) => {
        try {
          if (window.parent) {
            window.parent.postMessage({
              type: 'preview-error',
              file: 'async',
              error: String(event.reason?.message || event.reason || 'Unhandled Promise Rejection')
            }, '*');
          }
        } catch (_) {}
      });
      
      // Auto-mount main
      import('./src/main.jsx').then(() => {
        try {
          if (window.parent) {
            window.parent.postMessage({ type: 'preview-success' }, '*');
          }
        } catch (_) {}
      }).catch(e => {
        if (e.message && e.message.includes('src/main.jsx')) {
          console.log('Falling back to ./src/main.tsx');
          import('./src/main.tsx').then(() => {
            try {
              if (window.parent) {
                window.parent.postMessage({ type: 'preview-success' }, '*');
              }
            } catch (_) {}
          }).catch(err => {
            console.error('Preview Load Error (main.tsx):', err);
            try {
              if (window.parent) {
                window.parent.postMessage({
                  type: 'preview-error',
                  file: 'src/main.tsx',
                  error: err?.message || 'Failed to mount main.tsx'
                }, '*');
              }
            } catch (_) {}
          });
        } else {
          console.error('Preview Load Error (main.jsx):', e);
          try {
            if (window.parent) {
              window.parent.postMessage({
                type: 'preview-error',
                file: 'src/main.jsx',
                error: e?.message || 'Failed to mount main.jsx'
              }, '*');
            }
          } catch (_) {}
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
      const cleanPath = normalizePath(path);
      const strippedPath = cleanPath.replace(/^\//, '');
      const srcPrefixed = cleanPath.startsWith('/src/') ? cleanPath : '/src' + cleanPath;
      const srcStripped = cleanPath.startsWith('/src/') ? cleanPath.replace('/src/', '/') : cleanPath;

      let rows = [...this.sql`SELECT content FROM project_files 
        WHERE path = ${cleanPath} 
           OR path = ${srcPrefixed} 
           OR path = ${srcStripped} 
           OR path = ${strippedPath} 
           OR path = ${'src/' + strippedPath}`];
      
      // Fallback: match by basename if still not found
      if (rows.length === 0) {
        const filename = cleanPath.split('/').pop() || '';
        if (filename) {
          const safeFilename = filename.replace(/[%_\\]/g, '\\$&');
          rows = [...this.sql`SELECT content FROM project_files WHERE path LIKE '%' || ${safeFilename} ESCAPE '\\' LIMIT 1`];
        }
      }

      // If CSS was requested and genuinely not found yet, return an empty CSS stylesheet (200 OK) to prevent 404 console errors
      if (rows.length === 0 && cleanPath.endsWith('.css')) {
        return new Response('/* edge preview styles */', {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/css; charset=utf-8',
            'Cache-Control': 'no-cache'
          }
        });
      }
      
      if (rows.length > 0) {
        let content = rows[0].content as string;
        
        // Edge Transpilation for React/TSX
        if (path.endsWith('.jsx') || path.endsWith('.tsx') || path.endsWith('.ts')) {
          try {
            // Strip any subsequent tag starts if AI omitted closing tag
            const nextTagMatch = content.search(/<(?:file|edit)\s+path=/i);
            if (nextTagMatch !== -1) {
              content = content.substring(0, nextTagMatch);
            }

            // Strip any wrapping markdown code fences and trailing conversational text
            let c = content.trim();
            const fenceStart = c.match(/^\s*```(?:[a-zA-Z0-9_-]+)?\r?\n/);
            if (fenceStart) {
              const afterFence = c.substring(fenceStart[0].length);
              const fenceEnd = afterFence.search(/\r?\n```/);
              if (fenceEnd !== -1) {
                c = afterFence.substring(0, fenceEnd);
              } else {
                c = afterFence.replace(/\r?\n```[\s\S]*$/, '');
              }
            } else {
              const trailingFence = c.search(/\r?\n```(?:\s*\r?\n|$)/);
              if (trailingFence !== -1) {
                c = c.substring(0, trailingFence);
              }
              c = c.replace(/^\s*```(?:[a-zA-Z0-9_-]+)?\r?\n/, '').replace(/\r?\n```[\s\S]*$/, '');
            }
            content = c.trim();

            // 1. Alias common hallucinated Lucide icons before transpiling
            const lucideAliases: Record<string, string> = {
              Chat: 'MessageSquare',
              Dashboard: 'LayoutDashboard',
              Spinner: 'Loader2',
              Gear: 'Settings',
              Robot: 'Bot',
              Bin: 'Trash2',
              Cross: 'X',
              Close: 'X',
              Logout: 'LogOut',
              Exit: 'LogOut',
              Profile: 'User',
              Graph: 'BarChart2',
              Stats: 'BarChart',
              Tick: 'Check',
              Add: 'Plus',
              Warning: 'AlertTriangle',
              Information: 'Info',
              Magnifier: 'Search',
              Delete: 'Trash2'
            };
            content = content.replace(/import\s*\{([^}]+)\}\s*from\s*['"](?:https:\/\/esm\.sh\/)?lucide-react['"]/g, (match, importsStr) => {
              const parts = importsStr.split(',').map((p: string) => {
                const trimmed = p.trim();
                if (!trimmed) return '';
                if (trimmed.includes(' as ')) return trimmed;
                if (lucideAliases[trimmed]) {
                  return `${lucideAliases[trimmed]} as ${trimmed}`;
                }
                return trimmed;
              }).filter(Boolean);
              return `import { ${parts.join(', ')} } from 'lucide-react'`;
            });

            // 2. Auto-inject missing React hooks without creating duplicate imports
            const commonHooks = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext', 'useReducer'];
            const importedFromReact = new Set<string>();

            // Extract all named imports from any import ... from 'react' clause
            const reactImportRegex = /import\s+([\s\S]*?)\s+from\s*['"]react['"]/g;
            let rMatch: RegExpExecArray | null;
            while ((rMatch = reactImportRegex.exec(content)) !== null) {
              const clause = rMatch[1];
              const namedMatch = clause.match(/\{([\s\S]*?)\}/);
              if (namedMatch) {
                namedMatch[1].split(',').forEach(item => {
                  const name = item.trim().split(/\s+as\s+/)[0].trim();
                  if (name) importedFromReact.add(name);
                });
              }
            }

            const missingHooks: string[] = [];
            for (const hook of commonHooks) {
              const usedRegex = new RegExp(`(?<![.\\w])${hook}\\s*\\(`, 'g');
              if (usedRegex.test(content)) {
                if (!importedFromReact.has(hook)) {
                  const definedRegex = new RegExp(`(?:const|let|var|function|type|interface)\\s+${hook}\\b`);
                  if (!definedRegex.test(content)) {
                    missingHooks.push(hook);
                  }
                }
              }
            }

            if (missingHooks.length > 0) {
              // If there's an import from 'react' with curly braces { ... }, append inside the existing braces
              const hasBraces = content.match(/import\s+([^;]*?\{)([\s\S]*?)(\}[^;]*?)\s+from\s*['"]react['"]/);
              if (hasBraces) {
                content = content.replace(/import\s+([^;]*?\{)([\s\S]*?)(\}[^;]*?)\s+from\s*['"]react['"]/, (match, prefix, inside, suffix) => {
                  const trimmedInside = inside.trim();
                  const sep = trimmedInside.length > 0 ? ', ' : '';
                  return `import ${prefix}${trimmedInside}${sep}${missingHooks.join(', ')}${suffix} from 'react'`;
                });
              } else if (content.match(/import\s+React\b[^;]*from\s*['"]react['"]/)) {
                content = content.replace(/import\s+React\b([^;]*from\s*['"]react['"])/, (match, rest) => {
                  return `import React, { ${missingHooks.join(', ')} } ${rest}`;
                });
              } else {
                content = `import React, { ${missingHooks.join(', ')} } from 'react';\n${content}`;
              }
            }

            content = transform(content, { transforms: ['typescript', 'jsx'] }).code;
            
            // Fix CSS imports (inject link tag dynamically with resolved path)
            content = content.replace(/import\s+['"]([^'"]+\.css)['"]/g, (match, p1) => {
              const filename = p1.split('/').pop() || 'styles.css';
              return `
                (function() {
                  const id = 'bh-css-' + '${filename}'.replace(/[^a-zA-Z0-9]/g, '-');
                  if (!document.getElementById(id)) {
                    const link = document.createElement('link');
                    link.id = id;
                    link.rel = 'stylesheet';
                    link.href = '${filename}';
                    document.head.appendChild(link);
                  }
                })();
              `;
            });

            // If file is main.jsx, make App import resilient
            if (path.endsWith('main.jsx') || path.endsWith('main.tsx')) {
              content = content.replace(/import\s+App\s+from\s+['"](\.\/App(?:\.[jt]sx?)?)['"]/g, 
                `import * as AppModule from '$1';\nconst App = AppModule.default || AppModule.App || Object.values(AppModule).find(v => typeof v === 'function');`);
            }

            // If file is App.jsx and has no export default, automatically provide one
            if ((path.endsWith('App.jsx') || path.endsWith('App.tsx')) && !content.match(/export\s+default\b/)) {
              const namedMatch = content.match(/export\s+(?:function|const|class)\s+([A-Za-z0-9_$]+)/) ||
                                 content.match(/(?:function|const|class)\s+([A-Z][A-Za-z0-9_$]+)/);
              if (namedMatch && namedMatch[1]) {
                content += `\nexport default ${namedMatch[1]};\n`;
              }
            }

            // Very basic ESM local path resolution fixing (appending .jsx if no extension provided)
            content = content.replace(/from\s+['"](\.[^'"]+)['"]/g, (match, p1) => {
              if (p1.endsWith('.css') || p1.endsWith('.jsx') || p1.endsWith('.tsx') || p1.endsWith('.ts') || p1.endsWith('.js') || p1.endsWith('.json')) return match;
              return `from '${p1}.jsx'`; // default guess for edge preview local components
            });
            
          } catch (e: any) {
            console.error('Transpile error for', path, e);
            const errMsg = e?.message || 'Syntax or transpilation error';
            const errorFallback = `
              import React from 'react';
              console.error("Transpile Error in ${path}:\\n" + ${JSON.stringify(errMsg)});
              try {
                if (typeof window !== 'undefined' && window.parent) {
                  window.parent.postMessage({
                    type: 'preview-error',
                    file: ${JSON.stringify(path)},
                    error: "Transpile Error in " + ${JSON.stringify(path)} + ": " + ${JSON.stringify(errMsg)}
                  }, '*');
                }
              } catch (_) {}

              export default function TranspileErrorView() {
                const handleAutoFixClick = () => {
                  try {
                    if (window.parent) {
                      window.parent.postMessage({
                        type: 'preview-auto-fix',
                        file: ${JSON.stringify(path)},
                        error: "Transpile Error in " + ${JSON.stringify(path)} + ": " + ${JSON.stringify(errMsg)}
                      }, '*');
                    }
                  } catch (_) {}
                };

                return React.createElement('div', {
                  style: {
                    padding: '32px 20px',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    background: '#0a0a12',
                    color: '#f87171',
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box'
                  }
                }, React.createElement('div', {
                  style: {
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: '16px',
                    padding: '24px 28px',
                    maxWidth: '560px',
                    width: '100%',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                  }
                }, [
                  React.createElement('div', {
                    key: 'header',
                    style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }
                  }, [
                    React.createElement('span', { key: 'dot', style: { width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', display: 'inline-block' } }),
                    React.createElement('h3', { key: 'title', style: { margin: 0, fontSize: '16px', fontWeight: 600, color: '#fca5a5' } }, 'Code Syntax Error')
                  ]),
                  React.createElement('div', {
                    key: 'file',
                    style: { fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }
                  }, 'File: ${path}'),
                  React.createElement('pre', {
                    key: 'msg',
                    style: {
                      margin: '0 0 16px',
                      padding: '14px',
                      background: 'rgba(0,0,0,0.5)',
                      borderRadius: '8px',
                      fontSize: '13px',
                      color: '#f87171',
                      fontFamily: 'ui-monospace, monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      border: '1px solid rgba(239, 68, 68, 0.15)'
                    }
                  }, ${JSON.stringify(errMsg)}),
                  React.createElement('div', {
                    key: 'actions',
                    style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '16px' }
                  }, [
                    React.createElement('button', {
                      key: 'fixBtn',
                      onClick: handleAutoFixClick,
                      style: {
                        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)'
                      }
                    }, '⚡ Fix Automatically with AI'),
                    React.createElement('span', {
                      key: 'hint',
                      style: { fontSize: '12px', color: '#94a3b8' }
                    }, 'AI will surgically patch the broken lines')
                  ])
                ]));
              }
              export const App = TranspileErrorView;
            `;
            return new Response(errorFallback, {
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

