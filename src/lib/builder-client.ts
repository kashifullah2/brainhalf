import { authFetch } from './auth-client';

export async function builderRequest<T>(projectId: string, path: string, init: RequestInit = {}): Promise<T> {
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const origin = local ? (import.meta.env.VITE_BACKEND_HOST || '') : '';
  const response = await authFetch(`${origin}/agents/chat-agent/${encodeURIComponent(projectId)}/builder${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || 'Agent tools could not complete this request.');
  return body;
}
