import type { Item, User } from '../../shared/api';

export class ApiRequestError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The API returned an invalid response');
  return Object.fromEntries(Object.entries(value));
}
function item(value: unknown): Item {
  const data = record(value);
  if (typeof data.id !== 'string' || typeof data.title !== 'string' || typeof data.createdAt !== 'number') throw new Error('The API returned an invalid item');
  return { id: data.id, title: data.title, createdAt: data.createdAt };
}
function user(value: unknown): User {
  const data = record(record(value).user);
  if (typeof data.id !== 'string' || typeof data.email !== 'string') throw new Error('The API returned an invalid account');
  return { id: data.id, email: data.email };
}
async function request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch('/api' + path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 204) return undefined;
  const data: unknown = await response.json();
  if (!response.ok) throw new ApiRequestError(response.status, typeof record(data).error === 'string' ? String(record(data).error) : 'Request failed. Please retry.');
  return data;
}
export const api = {
  register: async (email: string, password: string) => user(await request('/auth/register', 'POST', { email, password })),
  login: async (email: string, password: string) => user(await request('/auth/login', 'POST', { email, password })),
  me: async () => user(await request('/auth/me')),
  logout: async () => { await request('/auth/logout', 'POST'); },
  items: async (): Promise<Item[]> => { const data = record(await request('/items')); if (!Array.isArray(data.items)) throw new Error('The API returned an invalid list'); return data.items.map(item); },
  createItem: async (title: string) => item(await request('/items', 'POST', { title })),
  updateItem: async (id: string, title: string) => item(await request('/items/' + encodeURIComponent(id), 'PATCH', { title })),
  deleteItem: async (id: string) => { await request('/items/' + encodeURIComponent(id), 'DELETE'); },
};
