import { RuntimeError } from './types';

export function contactInput(value: unknown): { name: string; email: string; message: string } {
  if (!value || typeof value !== 'object') throw new RuntimeError('Enter a name, email, and message.');
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100 || typeof v.email !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v.email) || v.email.length > 254 || typeof v.message !== 'string' || !v.message.trim() || v.message.length > 5000) throw new RuntimeError('Enter a valid name, email, and message (up to 5,000 characters).');
  return { name: v.name.trim(), email: v.email.trim(), message: v.message.trim() };
}
export function token(): string { return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''); }
export function cookie(request: Request, name: string): string | undefined {
  return request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function secureCookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
export async function readJson(request: Request, max = 16_000, options: { allowEmpty?: boolean } = {}): Promise<unknown> {
  if (Number(request.headers.get('content-length') || 0) > max) throw new RuntimeError('Request is too large.', 413);
  return readStreamJson(request.body, max, options);
}
// Structural reader shape works with both DOM and Workers stream declarations.
export async function readStreamJson(body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<unknown> } } | null, max: number, options: { allowEmpty?: boolean } = {}): Promise<unknown> {
  const reader = body?.getReader();
  if (!reader && options.allowEmpty) return {};
  if (!reader) throw new RuntimeError('A JSON body is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; if (!part.value) throw new RuntimeError('Invalid JSON.'); size += part.value.length; if (size > max) { await reader.cancel(); throw new RuntimeError('Request is too large.', 413); } chunks.push(part.value); }
    if (size === 0 && options.allowEmpty) return {};
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) { if (error instanceof RuntimeError) throw error; throw new RuntimeError('Invalid JSON.'); }
}
