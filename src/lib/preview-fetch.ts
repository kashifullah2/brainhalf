import { executeBackendRequest, type InMemoryDataStore } from './backend-runner';
import { BACKEND_NOT_RUNNING, usesSimulatedApi } from './preview-mode';

export function createPreviewFetch(
  nativeFetch: typeof fetch,
  files: Record<string, string>,
  store: InMemoryDataStore,
  origin: string,
  reportError: (message: string) => void,
): typeof fetch {
  return async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    const url = new URL(address, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);

    const request = new Request(input instanceof Request ? input : url, init);
    request.signal.throwIfAborted();
    if (!usesSimulatedApi(files)) {
      return Response.json({ error: BACKEND_NOT_RUNNING, code: 'BACKEND_NOT_RUNNING' }, { status: 501 });
    }
    let body: unknown = null;
    if (request.body) {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
        body = Object.fromEntries(await request.formData());
      } else {
        const source = await request.text();
        try { body = JSON.parse(source); } catch { body = source; }
      }
    }
    request.signal.throwIfAborted();

    try {
      const result = await executeBackendRequest(files, {
        method: request.method,
        url: url.href,
        headers: Object.fromEntries(request.headers),
        body,
      }, store);
      request.signal.throwIfAborted();
      if (result.status >= 500) reportError(result.error || `[Backend Error] ${result.status}: ${result.body?.error || 'API call failed'}`);
      return new Response(request.method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json', ...result.headers },
      });
    } catch (error) {
      request.signal.throwIfAborted();
      const message = `[Backend Error] Failed to execute API route: ${error instanceof Error ? error.message : String(error)}`;
      reportError(message);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}
