import { authFetch } from './auth-client';
import { apiOrigin } from './api-origin';

export async function builderRequest<T>(projectId: string, path: string, init: RequestInit = {}): Promise<T> {
  const origin = apiOrigin();
  const response = await authFetch(`${origin}/agents/chat-agent/${encodeURIComponent(projectId)}/builder${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || 'Agent tools could not complete this request.');
  return body;
}
