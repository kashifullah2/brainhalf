import { BRAND_IMAGE_BASE64 } from './brand-image';
import { getRegistry, isAllowedOrigin, type RegistryEnv } from './auth';
import { isValidEmail, sha256Hex } from './crypto';

interface EmailEnv extends RegistryEnv {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  CONTACT_EMAIL?: string;
}
const SITE = 'https://brainhalf.com';
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const generic = { ok: true, message: 'If this address is eligible, you will receive an email with the next steps. Check your spam folder too.' };

function configured(env: EmailEnv): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.RESEND_FROM_EMAIL && isValidEmail(env.RESEND_FROM_EMAIL.trim()));
}
async function registry(env: RegistryEnv, path: string, body: unknown) {
  return getRegistry(env).fetch(`https://registry${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function send(env: EmailEnv, to: string, subject: string, text: string, html: string, replyTo?: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ from: `BrainHalf <${env.RESEND_FROM_EMAIL!.trim()}>`, to: [to], subject, text,
      html: `<div style="font-family:Arial,sans-serif;color:#153147;max-width:560px;margin:auto;padding:28px"><img src="cid:brainhalf-logo" width="48" height="48" alt="BrainHalf"><h1 style="font-size:24px">${escape(subject)}</h1>${html}<p style="margin-top:32px;color:#64748b">BrainHalf · Build your next idea</p></div>`,
      attachments: [{ filename: 'brainhalf.png', content: BRAND_IMAGE_BASE64, content_id: 'brainhalf-logo' }],
      ...(replyTo ? { reply_to: replyTo } : {}), }),
    });
  } catch (cause) {
    // Network failures and the 15s timeout reject here — without this log the
    // signup 503 has no diagnosable cause in the Worker logs.
    console.error(`Resend API unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    throw new Error('Email delivery unavailable (network)');
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 500); } catch { /* ignore */ }
    console.error(`Resend API error: status=${response.status} body=${detail}`);
    throw new Error(`Email delivery unavailable (resend_status=${response.status})`);
  }
  await response.body?.cancel();
}

async function actionEmail(env: EmailEnv, email: string, kind: 'verify' | 'reset') {
  const response = await registry(env, '/email/issue', { email, kind });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 500); } catch { /* ignore */ }
  console.error(`email/issue failed: status=${response.status} body=${detail}`);
    throw new Error('Email service unavailable');
  }
  let action: { token: string; email: string } | null;
  try {
    action = await response.json() as { token: string; email: string } | null;
  } catch (cause) {
    console.error(`email/issue returned malformed JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
    throw new Error('Email service unavailable');
  }
  if (!action) return;
  // Fragments never go to servers, access logs, or referrer headers.
  const url = `${SITE}/${kind === 'reset' ? 'reset-password' : 'verify-email'}#token=${action.token}`;
  const subject = kind === 'reset' ? 'Reset your BrainHalf password' : 'Verify your BrainHalf email';
  const duration = kind === 'reset' ? '30 minutes' : '24 hours';
  const text = `${subject}\n\nOpen this link: ${url}\n\nThis link expires in ${duration} and works once. If you did not request this, ignore this email.`;
  await send(env, action.email, subject, text, `<p>Use the button below to continue. This link expires in ${duration} and works once.</p><p><a href="${escape(url)}" style="display:inline-block;padding:14px 22px;background:#176c85;color:white;border-radius:8px;text-decoration:none">${kind === 'reset' ? 'Reset password' : 'Verify email'}</a></p><p>If you did not request this, ignore this email.</p>`);
}

async function readBody(request: Request): Promise<any> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid request');
  const decoder = new TextDecoder();
  let size = 0, value = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 20_000) { await reader.cancel(); throw new Error('Request too large'); }
      value += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(value + decoder.decode());
  } finally { reader.releaseLock(); }
}

export async function handleEmailRequest(request: Request, env: EmailEnv): Promise<Response> {
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
  if (!isAllowedOrigin(request.headers.get('origin')) || request.headers.get('sec-fetch-site') === 'cross-site') return reply(403, { error: 'Untrusted request origin' });
  let body: any;
  try { body = await readBody(request); } catch { return reply(400, { error: 'Invalid request body' }); }
  if (!body || typeof body !== 'object') return reply(400, { error: 'Invalid request body' });
  const path = new URL(request.url).pathname;
  const completing = path === '/api/auth/reset-password' || path === '/api/auth/verify-email';
  try {
    if (completing) {
      const result = await registry(env, '/email/complete', { token: body.token, password: body.password, kind: path.endsWith('/reset-password') ? 'reset' : 'verify' });
      return reply(result.status, await result.json());
    }
    if (!configured(env)) return reply(503, { error: 'Email service is not available yet. Please try again later.' });
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!isValidEmail(email)) return reply(400, { error: 'Enter a valid email address.' });
    if (path === '/api/contact') {
      if (body.website) return reply(200, { ok: true });
      if (!env.CONTACT_EMAIL || !isValidEmail(env.CONTACT_EMAIL.trim())) return reply(503, { error: 'Contact service is not available yet. Please try again later.' });
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!name || name.length > 100 || message.length < 10 || message.length > 5000) return reply(400, { error: 'Add your name and a message between 10 and 5,000 characters.' });
      await send(env, env.CONTACT_EMAIL.trim(), 'New BrainHalf contact message', `From: ${name} (${email})\n\n${message}`, `<p>From: ${escape(name)} (${escape(email)})</p><p style="white-space:pre-wrap">${escape(message)}</p>`, email);
      return reply(200, { ok: true });
    }
    if (path === '/api/auth/signup') {
      const created = await registry(env, '/auth/signup', { email, password: body.password, requireVerification: true });
      if (!created.ok) return reply(created.status, await created.json());
      try { await actionEmail(env, email, 'verify'); }
      catch (cause) {
        // The account exists but the verification email failed — log the real
        // cause so a signup 503 is diagnosable from the Worker logs.
        console.error(`Signup verification email failed for ${email}: ${cause instanceof Error ? cause.message : String(cause)}`);
        return reply(503, { error: 'Your account was created, but the email could not be delivered. Use “Resend verification email” to try again.' });
      }
      return reply(202, { verificationRequired: true, message: 'Check your email to verify your account, then sign in.' });
    }
    if (!['/api/auth/forgot-password', '/api/auth/resend-verification'].includes(path)) return reply(404, { error: 'Not found' });
    const rate = await registry(env, '/rate-limit/check', { bucket: 'email-recipient', key: await sha256Hex(email), limit: 3, windowMs: 3600_000 });
    if (!rate.ok) return reply(503, { error: 'Email service is temporarily unavailable.' });
    if ((await rate.json() as { ok: boolean }).ok) {
      try { await actionEmail(env, email, path.endsWith('/forgot-password') ? 'reset' : 'verify'); }
      catch (cause) { console.warn(`Transactional email delivery failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
    return reply(202, generic);
  } catch (cause) {
    console.error(`Email request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return reply(503, { error: 'The request could not be completed. Please try again.' });
  }
}
