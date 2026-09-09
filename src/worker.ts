import { routeAgentRequest } from 'agents';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { ChatAgent } from './agent';

export { ChatAgent };

export default {
  async fetch(request: Request, env: any, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    
    // Route edge preview requests directly to the ChatAgent Durable Object
    if (url.pathname.startsWith('/preview/')) {
      const match = url.pathname.match(/^\/preview\/([^/]+)/);
      if (match && match[1]) {
        const agentId = match[1];
        const id = env.ChatAgent.idFromName(agentId);
        const obj = env.ChatAgent.get(id);
        return obj.fetch(request);
      }
    }

    const agentResponse = routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    
    // Serve static frontend assets for all other routes
    const response = await env.ASSETS.fetch(request);
    
    // Clone the response so we can modify the headers (Cloudflare ASSETS responses are immutable)
    const newResponse = new Response(response.body, response);
    
    // Add Cross-Origin Isolation headers required by WebContainers for SharedArrayBuffer
    newResponse.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    newResponse.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    
    return newResponse;
  }
}
