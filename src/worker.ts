import { routeAgentRequest } from 'agents';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { ChatAgent } from './agent';
import { handleModelTest } from './lib/model-tester';

export { ChatAgent };

export default {
  async fetch(request: Request, env: any, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    
    // Dedicated performance test APIs with zero-fallback real model execution
    if (url.pathname === '/api/test/simple') {
      return handleModelTest(request, env, 'simple');
    }
    if (url.pathname === '/api/test/medium') {
      return handleModelTest(request, env, 'medium');
    }
    if (url.pathname === '/api/test/hard') {
      return handleModelTest(request, env, 'hard');
    }

    // Dynamic Dispatch for Live User Workers (Cloudflare Workers for Platforms)
    if (url.pathname.startsWith('/p/')) {
      const match = url.pathname.match(/^\/p\/([^/]+)(.*)/);
      if (match && match[1]) {
        const scriptName = match[1];
        const subPath = match[2] || '/';
        if (env.DISPATCHER) {
          try {
            const subworker = env.DISPATCHER.get(scriptName);
            const targetUrl = new URL(request.url);
            targetUrl.pathname = subPath;
            const subRequest = new Request(targetUrl.toString(), request);
            return await subworker.fetch(subRequest);
          } catch (dispatchErr: any) {
            return new Response(`Worker "${scriptName}" not found in dispatch namespace: ${dispatchErr.message}`, {
              status: 404,
              headers: { 'Content-Type': 'text/plain' }
            });
          }
        }
      }
    }

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

    // Serve static frontend root assets with strict cache control
    if (env.ASSETS && (url.pathname === '/' || url.pathname === '/index.html')) {
      const response = await env.ASSETS.fetch(request);
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      newHeaders.set('Pragma', 'no-cache');
      newHeaders.set('Expires', '0');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    
    // Serve static frontend assets for all other routes
    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }
    
    return new Response('Not found', { status: 404 });
  }
}
