import { readStreamJson } from './integrations';
import type { EmailPayload } from './managed-types';

export class MailProviderError extends Error {
  constructor(public httpStatus: number, public retryable: boolean) { super(`Email provider returned HTTP ${httpStatus || 'unavailable'}.`); }
}
async function provider(apiKey: string, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch('https://api.resend.com' + path, {
      ...init, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
    });
  } catch { throw new MailProviderError(0, true); }
  if (!response.ok) { await response.body?.cancel(); throw new MailProviderError(response.status, response.status === 429 || response.status >= 500); }
  try { return await readStreamJson(response.body, 64_000) as Record<string, unknown>; }
  catch { throw new MailProviderError(502, true); }
}
export async function sendResend(apiKey: string, from: string, payload: EmailPayload, key: string) {
  const data = await provider(apiKey, '/emails', {
    method: 'POST', headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ from, to: [payload.to], subject: payload.subject, text: payload.text, html: payload.html, ...(payload.replyTo ? { reply_to: payload.replyTo } : {}) }),
  });
  if (typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)) throw new MailProviderError(502, true);
  return { id: data.id };
}
export async function resendStatus(apiKey: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new MailProviderError(400, false);
  const data = await provider(apiKey, '/emails/' + id, { method: 'GET' });
  const event = data.last_event;
  // Opens/clicks imply delivery. Never equate provider acceptance with delivery.
  const status = ['delivered', 'opened', 'clicked'].includes(String(event)) ? 'delivered'
    : ['bounced', 'complained', 'suppressed'].includes(String(event)) ? 'bounced'
      : ['failed', 'canceled'].includes(String(event)) ? 'failed' : 'sent';
  return { status: status as 'delivered' | 'bounced' | 'failed' | 'sent' };
}
