import { transform } from 'sucrase';
import { isAllowedOrigin } from './auth';
import {
  MODEL_ALLOWLIST,
  MODEL_TEST_TIMEOUT_MS,
  resolveModel,
  withTimeout,
} from './models';

export interface ModelTestResult {
  success: boolean;
  level: 'simple' | 'medium' | 'hard';
  model: string;
  provider: string;
  ttftMs: number | null;
  durationMs: number;
  tokens: number;
  tokensPerSec: number;
  syntaxValid: boolean;
  syntaxError?: string;
  previewUrl?: string;
  codeSnippet?: string;
  error?: string;
}

const PROMPTS = {
  simple: `Build an interactive Counter component in React with increment, decrement, and reset buttons with sleek glassmorphism styling.
Structure the response cleanly with:
<file path="/src/App.jsx">
import React, { useState } from 'react';

export default function App() {
  // your implementation
}
</file>`,

  medium: `Build an interactive Todo and Task Manager in React. Include task creation, category tags, filtering tabs (All, Active, Completed), and status toggle with clean dark mode styling.
Structure the response cleanly with:
<file path="/src/App.jsx">
import React, { useState } from 'react';

export default function App() {
  // your implementation
}
</file>`,

  hard: `Build a complete, responsive SaaS Analytics Dashboard in React using Tailwind CSS classes (Tailwind is preloaded, do not write custom CSS or <style> tags). Include:
1. Three metric cards (Revenue, Active Users, Conversion Rate) with trend indicators.
2. Interactive date range filter buttons (7D, 30D, 90D) that update the displayed metrics.
3. An animated CSS bar chart showing revenue trends for the selected period.
4. A customer activity table with a search input and status badges (Active, Trial, Inactive).
Keep the implementation clean, modern, and directly inside App() using Tailwind classes so the entire file stays under 150 lines and completes cleanly.
Structure the response cleanly with:
<file path="/src/App.jsx">
import React, { useState } from 'react';

export default function App() {
  // your implementation
}
</file>`
};

function extractAppCode(raw: string): string {
  // 1. Strip think blocks if any leaked through
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Try <file path="...">...</file>
  const fileMatch = text.match(/<file[^>]*path=["'](?:\/src\/App\.[jt]sx?|src\/App\.[jt]sx?|App\.[jt]sx?)["'][^>]*>([\s\S]*?)<\/file>/i);
  if (fileMatch && fileMatch[1].trim()) {
    return cleanCode(fileMatch[1].trim());
  }

  // 3. Try unclosed <file path="..."> if truncated
  const unclosedFileMatch = text.match(/<file[^>]*path=["'](?:\/src\/App\.[jt]sx?|src\/App\.[jt]sx?|App\.[jt]sx?)["'][^>]*>([\s\S]*)$/i);
  if (unclosedFileMatch && unclosedFileMatch[1].trim()) {
    return cleanCode(unclosedFileMatch[1].trim());
  }

  // 4. Try generic <file path="...">
  const anyFileMatch = text.match(/<file[^>]*>([\s\S]*?)<\/file>/i);
  if (anyFileMatch && anyFileMatch[1].trim()) {
    return cleanCode(anyFileMatch[1].trim());
  }

  // 5. Try ```jsx or ```tsx markdown code blocks
  const codeBlockMatch = text.match(/```(?:jsx|tsx|javascript|typescript)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch && codeBlockMatch[1].trim()) {
    return cleanCode(codeBlockMatch[1].trim());
  }

  // 6. Sliced code if it contains import or export default
  const importIdx = text.indexOf('import ');
  const exportIdx = text.indexOf('export default');
  const startIdx = (importIdx !== -1 && exportIdx !== -1)
    ? Math.min(importIdx, exportIdx)
    : (importIdx !== -1 ? importIdx : exportIdx);

  if (startIdx !== -1) {
    return cleanCode(text.slice(startIdx).trim());
  }

  return cleanCode(text);
}

export function autoBalanceTruncatedJsx(code: string): string {
  let cleaned = code.trim();
  
  // Try direct transform first
  try {
    transform(cleaned, { transforms: ['jsx', 'typescript'] });
    return cleaned;
  } catch (_) {}

  // Strip trailing incomplete line (e.g. '<td className' or truncated expressions)
  const lines = cleaned.split('\n');
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (last.startsWith('<') && !last.endsWith('>') && !last.endsWith('/>')) {
      lines.pop();
    } else if (last.endsWith('=') || last.endsWith('+') || last.endsWith('-') || last.endsWith('*') || last.endsWith('(') || last.endsWith('{') || last.endsWith('[')) {
      lines.pop();
    } else {
      break;
    }
  }
  cleaned = lines.join('\n');

  // Candidate suffixes for common React truncations
  const suffixes = [
    '',
    '\n}',
    '\n);\n}',
    '\n</div>\n);\n}',
    '\n</div>\n</div>\n);\n}',
    '\n</div>\n</div>\n</div>\n);\n}',
    '\n</tr>))}\n</tbody>\n</table>\n</div>\n</div>\n</div>\n);\n}',
    '\n</tr>))}\n</tbody>\n</table>\n</div>\n</div>\n</div>\n</div>\n);\n}',
    '\n</td>\n</tr>))}\n</tbody>\n</table>\n</div>\n</div>\n</div>\n</div>\n);\n}',
    '\n))}\n</tbody>\n</table>\n</div>\n</div>\n</div>\n);\n}',
    '\n</tbody>\n</table>\n</div>\n</div>\n</div>\n);\n}',
    '\n</table>\n</div>\n</div>\n</div>\n);\n}',
    '\n</section>\n</main>\n</div>\n);\n}',
    '\n</div>\n</section>\n</main>\n</div>\n);\n}'
  ];

  for (const s of suffixes) {
    try {
      const test = cleaned + s;
      transform(test, { transforms: ['jsx', 'typescript'] });
      return test;
    } catch (_) {}
  }

  return code;
}

export function autoHealAppCode(raw: string): string {
  let code = raw;

  // 1. Remove all emojis from code and JSX
  code = code.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');

  // 2. Remove dangling </tr> right after )} and before ))} or ))
  code = code.replace(/(\n\s*\)\}\s*)\n\s*<\/tr>\s*(?=\n\s*\)\)\s*\}?)/g, '$1');

  // 3. Fix unfragmented map: wrap adjacent <tr and {expandedRow && <tr in <React.Fragment key={...}>
  code = code.replace(
    /(\.map\s*\(\s*(?:\([^)]+\)|[a-zA-Z0-9_]+)\s*=>\s*\(\s*)(\r?\n\s*<tr[\s\S]*?<\/\s*tr>\s*\r?\n\s*\{[\s\S]*?<\/\s*tr>\s*\r?\n\s*\)\})(\s*\r?\n\s*\)\))/g,
    (match, mapHead, trGroup, mapEnd) => {
      const keyMatch = trGroup.match(/\bkey=\{([^}]+)\}/);
      const keyStr = keyMatch ? ` key=${keyMatch[1]}` : '';
      const cleanTrGroup = trGroup.replace(/\bkey=\{[^}]+\}\s*/, '');
      return `${mapHead}\r\n<React.Fragment${keyStr}>${cleanTrGroup}\r\n</React.Fragment>${mapEnd}`;
    }
  );

  // 4. Fix ternary missing closing paren before map close
  code = code.replace(
    /(\?\s*\([^?:]*?\)\s*:\s*\([^?:]*?\.map\s*\([\s\S]*?\)\s*)\}\s*(?=<\/tbody>)/g,
    '$1)}'
  );

  // 5. Auto-heal createContext() calls that have no default value.
  // When the browser loads the same context module via two different URL paths,
  // React.createContext() is executed twice, producing two unrelated context objects.
  // Components outside the correct Provider tree will receive `undefined` and crash.
  // Injecting a safe default object prevents the destructure TypeError.
  code = code.replace(
    /createContext\s*\(\s*\)/g,
    'createContext({})'
  );

  // 6. Auto-balance truncated JSX components if needed
  code = autoBalanceTruncatedJsx(code);

  return code;
}

function cleanCode(code: string): string {
  let c = code.trim();
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
  return autoHealAppCode(c.trim());
}

export async function handleModelTest(
  request: Request,
  env: any,
  level: 'simple' | 'medium' | 'hard',
  identity?: { userId: string }
): Promise<Response> {
  // Reflect an allowlisted origin only — never `*`. The worker already applies
  // its own CORS, but this handler also answers direct OPTIONS preflights.
  const origin = request.headers.get('origin');
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin) ? origin : 'https://brainhalf.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-bh-csrf',
    Vary: 'Origin',
    'Content-Type': 'application/json',
    // The body is JSON, never HTML: prevent a content-sniffing browser from
    // treating a model echo as markup.
    'X-Content-Type-Options': 'nosniff',
    // This endpoint returns no markup and is not framed.
    'X-Frame-Options': 'deny',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  let modelId = url.searchParams.get('model') || url.searchParams.get('modelId');
  let provider = url.searchParams.get('provider') || '';

  if (request.method === 'POST') {
    try {
      const body: any = await request.json();
      if (body.model) modelId = body.model;
      if (body.modelId) modelId = body.modelId;
      if (body.provider) provider = body.provider;
    } catch {
      // ignore
    }
  }

  if (!modelId) {
    return new Response(JSON.stringify({
      error: 'Missing required parameter: model',
      usage: `GET or POST /api/test/${level}?model=@cf/openai/gpt-oss-20b`
    }), { status: 400, headers: corsHeaders });
  }

  // Strict allowlist: an exact match is required. Previously any @cf/ string
  // was passed straight to env.AI.run and any claude-* id ran as sonnet.
  const resolved = resolveModel(modelId, provider);
  if (!resolved) {
    return new Response(JSON.stringify({
      error: `Model "${modelId}" is not in the model allowlist`,
      allowedModels: MODEL_ALLOWLIST.map((m) => m.name)
    }), { status: 400, headers: corsHeaders });
  }

  const modelSlug = modelId.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').toLowerCase();
  // Scope the ephemeral test preview to the authenticated user so that
  // test-<model>-<level> previews are not shared across users.
  const userScope = identity?.userId ? identity.userId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() : 'anon';
  const testProjectId = `test-${userScope}-${modelSlug}-${level}`;
  const prompt = PROMPTS[level];

  // -------------------------------------------------------------
  // STRICT ZERO-FALLBACK EXECUTION
  // -------------------------------------------------------------
  const startTime = Date.now();
  let firstTokenTime: number | null = null;
  let outputContent = '';
  let errorMsg: string | null = null;

  try {
    if (resolved.provider === 'cloudflare') {
      if (!env || !env.AI) {
        throw new Error('Cloudflare Workers AI binding env.AI is not available');
      }

      let aiResponse: any = null;
      const testLadder = [65536, 32768, 16384, 8192];
      for (const tokenLimit of testLadder) {
        try {
          aiResponse = await withTimeout(
            env.AI.run(resolved.id, {
              messages: [
                { role: 'system', content: 'You are BrainHalf, an elite autonomous React developer. Always provide complete, modular, working React code inside a <file path="/src/App.jsx">...</file> block. Do not use emoji characters anywhere in the UI or code (use SVG or clean styling instead). Ensure all JSX elements and conditional expressions are strictly balanced with valid syntax.' },
                { role: 'user', content: prompt }
              ],
              stream: true,
              max_tokens: tokenLimit,
              max_completion_tokens: tokenLimit,
              chat_template_kwargs: { enable_thinking: false }
            }),
            MODEL_TEST_TIMEOUT_MS,
            `Model test (${resolved.id})`
          );
          if (aiResponse) break;
        } catch (limitErr: any) {
          const msg = String(limitErr?.message || limitErr || '');
          if (!/token|context|length/i.test(msg)) {
            throw limitErr;
          }
        }
      }

      const decoder = new TextDecoder();
      let sseBuffer = '';

      const extractToken = (obj: any): string | undefined => {
        if (!obj) return undefined;
        if (typeof obj === 'string') return obj;
        if (obj.response != null) return String(obj.response);
        const content = obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.text;
        if (content != null) return String(content);
        return undefined;
      };

      if (aiResponse && typeof aiResponse.getReader === 'function') {
        const reader = aiResponse.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!firstTokenTime) {
            firstTokenTime = Date.now() - startTime;
          }

          const direct = extractToken(value);
          if (direct) {
            outputContent += direct;
            continue;
          }

          if (value instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)) {
            const text = decoder.decode(value, { stream: true });
            sseBuffer += text;
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
                if (token) outputContent += token;
              } catch { }
            }
          }
        }
      } else if (aiResponse && Symbol.asyncIterator in aiResponse) {
        for await (const chunk of aiResponse) {
          if (!firstTokenTime) {
            firstTokenTime = Date.now() - startTime;
          }

          const direct = extractToken(chunk);
          if (direct) {
            outputContent += direct;
            continue;
          }

          if (chunk instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && chunk instanceof ArrayBuffer)) {
            const text = decoder.decode(chunk, { stream: true });
            sseBuffer += text;
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
                if (token) outputContent += token;
              } catch { }
            }
          }
        }
      } else if (aiResponse && aiResponse.response) {
        firstTokenTime = Date.now() - startTime;
        outputContent = aiResponse.response;
      }

      // Flush remaining buffer
      if (sseBuffer.trim().startsWith('data:')) {
        const jsonStr = sseBuffer.trim().slice(5).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(jsonStr);
            const token = parsed.response || parsed.delta || (parsed.choices && parsed.choices[0]?.delta?.content) || '';
            outputContent += token;
          } catch { }
        }
      }
    } else if (resolved.provider === 'anthropic') {
      const anthropicApiKey = env.ANTHROPIC_API_KEY;
      if (!anthropicApiKey) {
        throw new Error(`ANTHROPIC_API_KEY is not configured in Cloudflare Workers secrets. Strict Zero-Fallback policy prohibits substituting with alternative models.`);
      }

      const { createAnthropic } = await import('@ai-sdk/anthropic');
      const { streamText } = await import('ai');
      const anthropic = createAnthropic({ apiKey: anthropicApiKey });
      const stream = streamText({
        model: anthropic(resolved.id),
        messages: [{ role: 'user', content: prompt }],
        abortSignal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS)
      });

      for await (const chunk of stream.textStream) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now() - startTime;
        }
        outputContent += chunk;
      }
    } else if (resolved.provider === 'aws') {
      const awsKey = env.AWS_ACCESS_KEY_ID;
      const awsSecret = env.AWS_SECRET_ACCESS_KEY;
      const bedrockApiKey = env.BEDROCK_API_KEY;

      if (!bedrockApiKey && (!awsKey || !awsSecret)) {
        throw new Error(`AWS Bedrock credentials are not configured in Cloudflare Workers secrets. Strict Zero-Fallback policy prohibits substituting with alternative models.`);
      }

      const { createAmazonBedrock } = await import('@ai-sdk/amazon-bedrock');
      const { streamText } = await import('ai');
      const bedrock = createAmazonBedrock({
        region: env.AWS_REGION || 'us-east-1',
        accessKeyId: awsKey,
        secretAccessKey: awsSecret
      });
      const stream = streamText({
        model: bedrock(resolved.id),
        messages: [{ role: 'user', content: prompt }],
        abortSignal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS)
      });

      for await (const chunk of stream.textStream) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now() - startTime;
        }
        outputContent += chunk;
      }
    } else if (resolved.provider === 'atria') {
      const atriaApiKey = env.ATRIA_API_KEY;
      const atriaBaseUrl = env.ATRIA_BASE_URL || 'https://api.atria-asi.ai/v1';

      if (!atriaApiKey) {
        throw new Error(`ATRIA_API_KEY is not configured in Cloudflare Workers secrets. Strict Zero-Fallback policy prohibits substituting with alternative models.`);
      }

      const { createOpenAI } = await import('@ai-sdk/openai');
      const { streamText } = await import('ai');
      const atria = createOpenAI({
        apiKey: atriaApiKey,
        baseURL: atriaBaseUrl,
      });
      const stream = streamText({
        model: atria(resolved.id),
        messages: [{ role: 'user', content: prompt }],
        abortSignal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
      });

      for await (const chunk of stream.textStream) {
        if (!firstTokenTime) {
          firstTokenTime = Date.now() - startTime;
        }
        outputContent += chunk;
      }
    } else {
      // Unreachable: resolveModel already rejected anything else.
      throw new Error(`Unsupported provider for model: ${resolved.name}`);
    }
  } catch (err: any) {
    errorMsg = err.message || String(err);
  }

  const durationMs = Date.now() - startTime;
  const estimatedTokens = Math.round(outputContent.length / 4);
  const streamDurationSec = firstTokenTime ? (durationMs - firstTokenTime) / 1000 : durationMs / 1000;
  const tokensPerSec = streamDurationSec > 0 ? Math.round(estimatedTokens / streamDurationSec) : 0;

  if (errorMsg || !outputContent.trim()) {
    const failedResult: ModelTestResult & { rawOutput?: string } = {
      success: false,
      level,
      model: resolved.name,
      provider: resolved.provider,
      ttftMs: firstTokenTime,
      durationMs,
      tokens: estimatedTokens,
      tokensPerSec,
      syntaxValid: false,
      error: errorMsg || 'Model returned empty response with 0 tokens',
      rawOutput: outputContent.substring(0, 300)
    };
    // A model-side failure is not a 200: report 502 so callers cannot read a
    // broken run as a successful one. The JSON body is unchanged.
    return new Response(JSON.stringify(failedResult, null, 2), { status: 502, headers: corsHeaders });
  }

  // -------------------------------------------------------------
  // SYNTAX & TRANSPILATION VALIDATION
  // -------------------------------------------------------------
  const extractedCode = extractAppCode(outputContent);
  let syntaxValid = false;
  let syntaxError: string | undefined;

  try {
    transform(extractedCode, { transforms: ['jsx', 'typescript'] });
    syntaxValid = true;
  } catch (transpileErr: any) {
    syntaxValid = false;
    syntaxError = transpileErr.message || 'Sucrase JSX/TypeScript transpile error';
  }

  // -------------------------------------------------------------
  // EDGE PREVIEW PERSISTENCE
  // -------------------------------------------------------------
  let previewUrl = `/preview/${testProjectId}/index.html`;
  try {
    if (env.ChatAgent) {
      const doId = env.ChatAgent.idFromName(testProjectId);
      const doObj = env.ChatAgent.get(doId);
      await doObj.fetch(new Request(`https://brainhalf.com/preview/${testProjectId}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: {
            '/src/App.jsx': extractedCode,
            '/src/styles.css': '/* Auto-generated preview styles */\nbody { margin: 0; font-family: system-ui, sans-serif; background: #0b0f19; color: #f8fafc; }'
          }
        })
      }));
    }
  } catch (syncErr: any) {
    console.warn('Failed to auto-sync to Edge Preview DO:', syncErr);
  }

  const result: ModelTestResult & { rawOutput?: string } = {
    success: true,
    level,
    model: resolved.name,
    provider: resolved.provider,
    ttftMs: firstTokenTime,
    durationMs,
    tokens: estimatedTokens,
    tokensPerSec,
    syntaxValid,
    syntaxError,
    previewUrl,
    codeSnippet: extractedCode.substring(0, 200) + '...',
    rawOutput: outputContent.substring(0, 300)
  };

  return new Response(JSON.stringify(result, null, 2), { status: 200, headers: corsHeaders });
}
