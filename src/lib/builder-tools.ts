import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { isPublicRoutableHost } from './ssrf';

export interface BuilderSkill { id: string; name: string; instructions: string; enabled: boolean }
export interface McpToolInfo { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }
export interface BuilderMcpServer { id: string; name: string; url: string; enabled: boolean; allowedTools: string[]; tools: McpToolInfo[]; hasToken: boolean }
export interface BuilderConfiguration { servers: BuilderMcpServer[]; skills: BuilderSkill[] }

export function validateMcpUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a public HTTPS MCP endpoint.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid HTTPS MCP endpoint.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || !url.hostname.includes('.') || !isPublicRoutableHost(url.hostname) || /\.(?:internal|local|localhost|lan)$/i.test(url.hostname)) throw new Error('Use a public HTTPS endpoint on port 443. Local and private addresses are unavailable.');
  if (url.search) throw new Error('Use the bearer token field for credentials; query-string endpoints are not supported.');
  return url.href;
}

export async function withMcpClient<T>(url: string, bearer: string, action: (client: Client) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const endpoint = new URL(validateMcpUrl(url));
  const timeout = AbortSignal.timeout(20_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const client = new Client({ name: 'BrainHalf', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} },
    fetch: async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : String(input));
      validateMcpUrl(target.href);
      if (target.origin !== endpoint.origin) throw new Error('MCP connections cannot forward credentials to another origin.');
      const signals = [combined, ...(init?.signal ? [init.signal] : [])];
      const response = await fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any(signals) });
      if (!response.body) return response;
      let bytes = 0;
      const bounded = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > 2 * 1024 * 1024) { controller.error(new Error('MCP response exceeds 2 MB.')); return; }
        controller.enqueue(chunk);
      } }));
      return new Response(bounded, response);
    },
  });
  try { await client.connect(transport); return await action(client); }
  finally { await client.close().catch(() => {}); }
}

export async function discoverMcpTools(url: string, bearer: string): Promise<McpToolInfo[]> {
  return withMcpClient(url, bearer, async client => {
    const result = await client.listTools();
    if (result.tools.length > 40 || result.nextCursor) throw new Error('This endpoint exposes too many tools. Use an endpoint with at most 40 tools.');
    return result.tools.map(entry => {
      if (!/^[\w.-]{1,64}$/.test(entry.name) || JSON.stringify(entry.inputSchema).length > 20_000) throw new Error('The server returned an unsupported tool definition.');
      return { name: entry.name, description: (entry.description || entry.name).slice(0, 1600), inputSchema: entry.inputSchema, readOnly: entry.annotations?.readOnlyHint === true };
    });
  });
}

export function skillContext(skills: BuilderSkill[]): string {
  const enabled = skills.filter(skill => skill.enabled);
  if (!enabled.length) return '';
  return '\nPROJECT SKILLS (user-selected project guidance; tool permissions, security rules, and the current request still apply):\n' + enabled.map(skill => JSON.stringify({ name: skill.name, instructions: skill.instructions })).join('\n');
}
