import { Agent, type Connection } from 'agents';
import { tracing } from 'cloudflare:workers';

export class ChatAgent extends Agent {
  private ensureSchema() {
    try {
      this.sql`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`;
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

      const agentId = this.name || 'default';
      const conversationId = 'conv-' + agentId;
      
      let systemPrompt = `You are BrainHalf, an expert AI software developer capable of building beautiful, modern full-stack web applications.
The user wants you to generate or refine a web application. You must output the application code by specifying one or more files.

Always format your code files exactly like this:
<file path="src/App.jsx">
import React from 'react';
import { Sparkles } from 'lucide-react';
function App() { return <div><Sparkles /> Hello</div>; }
export default App;
</file>

CRITICAL RULES:
1. You can create or modify multiple files (e.g. src/App.jsx, src/components/Button.jsx, src/styles.css). Just use multiple <file> blocks.
2. The environment is Vite + React. 
3. 'lucide-react' is PRE-INSTALLED. Valid icons: MessageSquare, MessageCircle, Send, Bot, Sparkles, User, Play, RefreshCw, Check, Trash2, Plus, X, Heart, Star, Settings, ChevronRight, Search, ThumbsUp.
   CRITICAL: There is NO 'Chat' icon in lucide-react. For chat, ALWAYS use MessageSquare, MessageCircle, or Send!
4. Tailwind CSS is NOT installed. You MUST use inline styles or generate a normal CSS file (like src/styles.css) and import it.
5. Create beautiful, modern, glassmorphic UI designs. Use gradients, shadows, and smooth borders. Build full responsive layouts: use 100% width with appropriate padding and centered containers (max-width: 600px - 1200px as appropriate for the app type, with margin: 0 auto). Do NOT make apps tiny 300px fixed-width cards unless explicitly requested as a mobile widget. Ensure apps look spacious, well-aligned, and professional on desktop.
6. COMPLETENESS & CLOSURE: Write the COMPLETE, fully-functional code without shortcuts or placeholders. NEVER leave code truncated or cut off. Always close every file tag with </file>.
7. SINGLE-TURN COMPLETION: Complete the entire application or requested feature in this single turn. Never stop halfway, never ask the user to wait or prompt again to continue.
8. If the user asks to modify, enhance, or fix their existing application, maintain their existing code and make the requested enhancements!
9. SELF-CONTAINED CODE: Build components using standard React, CSS, and pre-installed 'lucide-react' icons. Avoid requiring extra npm packages. If you execute a terminal command like <command>npm install library-name</command>, NEVER STOP GENERATING; immediately output the complete code in <file>...</file> tags in the same message.
10. Keep conversational text outside the <file> tags very brief (1-2 sentences). Output mostly code.
`;

      if (data.workspaceFiles && typeof data.workspaceFiles === 'object') {
        let filesSummary = '';
        for (const [path, content] of Object.entries(data.workspaceFiles)) {
          filesSummary += `\n<file path="${path}">\n${content}\n</file>\n`;
        }
        systemPrompt += `\n\n=== CURRENT WORKSPACE FILES ===\nThe user currently has the following files in their project. You can modify these files by returning a new <file> block with the same path, or create new files.\n${filesSummary}\n===============================\n`;
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

      let actualPrompt = data.prompt || 'Hello';
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
              '@cf/meta/llama-3.1-8b-instruct-fp8',
              '@cf/meta/llama-3.2-3b-instruct',
              '@cf/qwen/qwen2.5-coder-32b-instruct',
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
                aiResponse = await (this as any).env.AI.run(model, {
                  messages: inputMessages,
                  stream: true,
                  max_tokens: 3500
                });
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

            // Stream back to client via WebSocket with robust SSE decoding
            for await (const rawChunk of aiResponse) {
              // If already parsed object with response
              if (rawChunk && typeof rawChunk === 'object' && !(rawChunk instanceof Uint8Array) && 'response' in rawChunk) {
                const text = (rawChunk as any).response;
                if (text) {
                  outputContent += text;
                  const msg = JSON.stringify({ 
                    type: 'stream', 
                    chunk: { response: text, done: false } 
                  });
                  try { connection.send(msg); } catch (e) {}
                  try { this.broadcast(msg, [connection.id]); } catch (e) {}
                }
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
                  const token = parsed.response;
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
                  if (parsed.response) {
                    outputContent += parsed.response;
                    const msg = JSON.stringify({ 
                      type: 'stream', 
                      chunk: { response: parsed.response, done: false } 
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
}

