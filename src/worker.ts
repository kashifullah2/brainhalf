import { routeAgentRequest } from 'agents';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { ChatAgent } from './agent';

export { ChatAgent };

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
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
