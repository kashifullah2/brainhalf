import { sha256Hex, isValidEmail } from '../lib/crypto';
import { ManagedStore } from './managed-store';
import { openSecret, sealSecret } from './secrets';
import { MailProviderError, resendStatus, sendResend } from './mail-provider';
import { PILOT_LIMITS, RuntimeError, type ProjectEnvironment } from './types';
import type { EmailPayload, EmailState, EmailTemplate, EmailTemplateKind, ManagedMessage } from './managed-types';

const defaults: EmailTemplate[] = [
  { kind: 'verify_email', subject: 'Verify your email for {{appName}}', text: 'Hello {{name}},\n\nVerify your email to finish joining {{appName}}:\n{{actionUrl}}\n\nThis link expires in 30 minutes. Ignore this email if you did not request it.' },
  { kind: 'reset_password', subject: 'Reset your {{appName}} password', text: 'Hello {{name}},\n\nChoose a new password:\n{{actionUrl}}\n\nThis link expires in 30 minutes. Ignore this email if you did not request it.' },
  { kind: 'magic_link', subject: 'Sign in to {{appName}}', text: 'Hello {{name}},\n\nSign in using this one-time link:\n{{actionUrl}}\n\nThis link expires in 30 minutes. Ignore this email if you did not request it.' },
  { kind: 'welcome', subject: 'Welcome to {{appName}}', text: 'Hello {{name}},\n\nYour account is ready. Welcome to {{appName}}!\n{{appUrl}}' },
  { kind: 'order_receipt', subject: '{{appName}} receipt: {{orderId}}', text: 'Hello {{name}},\n\nThank you for your order {{orderId}}.\nAmount: {{amount}}\n\n{{details}}\n\n{{appUrl}}' },
  { kind: 'contact', subject: '{{appName}}: message from {{name}}', text: 'From: {{name}} <{{email}}>\n\n{{message}}' },
];
const variables: Record<EmailTemplateKind, string[]> = {
  verify_email: ['appName', 'name', 'actionUrl'], reset_password: ['appName', 'name', 'actionUrl'], magic_link: ['appName', 'name', 'actionUrl'],
  welcome: ['appName', 'name', 'appUrl'], order_receipt: ['appName', 'name', 'appUrl', 'orderId', 'amount', 'details'], contact: ['appName', 'name', 'email', 'message'],
};
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
interface MailRow extends Record<string, SqlStorageValue> {
  id: string; environment: ProjectEnvironment; kind: EmailTemplateKind; recipient: string; subject: string; status: EmailState;
  sealed: string; idempotency_key: string; request_hash: string; attempts: number; polls: number; provider_id: string | null;
  next_at: number | null; created: number; updated: number; error: string | null;
}
interface SealedMail { payload: EmailPayload; custom?: { apiKey: string; from: string }; appName: string }

export class ManagedMail {
  constructor(readonly store: ManagedStore) {}
  templates(environment: ProjectEnvironment): EmailTemplate[] {
    const stored = this.store.sql.exec<{ kind: string; subject: string; text: string }>('SELECT kind,subject,text FROM managed_templates WHERE environment=?', environment).toArray();
    return defaults.map(template => ({ ...template, ...stored.find(row => row.kind === template.kind), kind: template.kind }));
  }
  saveTemplate(environment: ProjectEnvironment, kind: string, value: Record<string, unknown>) {
    if (!defaults.some(template => template.kind === kind)) throw new RuntimeError('Unknown email template.', 404);
    if (typeof value.subject !== 'string' || !value.subject.trim() || value.subject.length > 200 || /[\r\n]/.test(value.subject) || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 6000) throw new RuntimeError('Enter a subject up to 200 characters and message up to 6,000 characters.');
    const allowed = variables[kind as EmailTemplateKind];
    for (const match of (value.subject + value.text).matchAll(/\{\{([^{}]+)\}\}/g)) if (!allowed.includes(match[1])) throw new RuntimeError(`Unknown template field: ${match[1].slice(0, 40)}.`);
    if (allowed.includes('actionUrl') && !value.text.includes('{{actionUrl}}')) throw new RuntimeError('Authentication templates must include {{actionUrl}}.');
    this.store.sql.exec('INSERT INTO managed_templates VALUES (?,?,?,?) ON CONFLICT(environment,kind) DO UPDATE SET subject=excluded.subject,text=excluded.text', environment, kind, value.subject.trim(), value.text);
  }
  render(environment: ProjectEnvironment, kind: EmailTemplateKind, fields: Record<string, string>): Omit<EmailPayload, 'to' | 'replyTo'> {
    const template = this.templates(environment).find(item => item.kind === kind);
    if (!template) throw new RuntimeError('Unknown email template.');
    const values = { ...fields, appName: this.store.settings(environment).appName, appUrl: this.store.deps.origin(environment) };
    const replace = (text: string) => text.replace(/\{\{([A-Za-z]+)\}\}/g, (_, key: string) => values[key as keyof typeof values] || '');
    const text = replace(template.text).slice(0, 12_000);
    const subject = replace(template.subject).replace(/[\r\n]/g, ' ').slice(0, 200);
    const action = fields.actionUrl;
    if (action && new URL(action).origin !== this.store.deps.origin(environment)) throw new RuntimeError('Invalid authentication link.');
    const button = action ? `<p><a href="${escape(action)}" style="display:inline-block;padding:12px 18px;background:#176c85;color:#fff;border-radius:6px">Continue</a></p>` : '';
    return { subject, text, html: `<div style="font:16px/1.6 sans-serif;max-width:560px;margin:auto"><h2>${escape(values.appName)}</h2><p style="white-space:pre-wrap">${escape(text)}</p>${button}<p style="color:#64748b;font-size:12px">Sent by ${escape(values.appName)} using BrainHalf.</p></div>` };
  }
  nextDue(): number | null {
    return this.store.sql.exec<{ next: number | null }>('SELECT MIN(next_at) AS next FROM managed_emails WHERE next_at IS NOT NULL').toArray()[0]?.next ?? null;
  }
  counts(environment: ProjectEnvironment) {
    return Object.fromEntries(this.store.sql.exec<{ status: EmailState; count: number }>('SELECT status,COUNT(*) AS count FROM managed_emails WHERE environment=? GROUP BY status', environment).toArray().map(row => [row.status, row.count]));
  }
  private publicMessage(row: MailRow): ManagedMessage {
    return { id: row.id, kind: row.kind, to: row.recipient, subject: row.subject, status: row.status, createdAt: row.created, updatedAt: row.updated, attempts: row.attempts, providerId: row.provider_id, error: row.error };
  }
  list(environment: ProjectEnvironment) { return this.store.sql.exec<MailRow>('SELECT * FROM managed_emails WHERE environment=? ORDER BY created DESC LIMIT 100', environment).toArray().map(row => this.publicMessage(row)); }
  private scope(row: Pick<MailRow, 'environment' | 'id'>) { return `${this.store.deps.scope.projectId}:${row.environment}:mail:${row.id}`; }
  private async payload(row: MailRow) { return openSecret<SealedMail>(row.sealed, this.store.deps.env.PROJECT_SECRETS_KEY || '', this.scope(row)); }
  async detail(environment: ProjectEnvironment, id: string) {
    const row = this.store.sql.exec<MailRow>('SELECT * FROM managed_emails WHERE environment=? AND id=?', environment, id).toArray()[0];
    if (!row) throw new RuntimeError('Message not found.', 404);
    const { payload } = await this.payload(row);
    return { ...this.publicMessage(row), text: environment === 'development' ? payload.text : payload.text.replace(/#token=[A-Za-z0-9_-]+/g, '#token=[redacted]') }; // No HTML execution or provider credentials in the owner UI.
  }
  async enqueue(environment: ProjectEnvironment, kind: EmailTemplateKind, to: string, fields: Record<string, string>, key: string, replyTo?: string): Promise<ManagedMessage> {
    if (!isValidEmail(to) || (replyTo && !isValidEmail(replyTo)) || !/^[A-Za-z0-9_.:-]{1,180}$/.test(key)) throw new RuntimeError('Invalid email request.');
    if (!this.store.settings(environment).emailEnabled) throw new RuntimeError('Email is disabled for this app.', 503);
    const payload: EmailPayload = { to: to.toLowerCase(), ...this.render(environment, kind, fields), ...(replyTo ? { replyTo } : {}) };
    const fingerprint = await sha256Hex(JSON.stringify({ kind, payload }));
    const existing = () => this.store.sql.exec<MailRow>('SELECT * FROM managed_emails WHERE environment=? AND idempotency_key=?', environment, key).toArray()[0];
    const prior = existing();
    if (prior) { if (prior.request_hash !== fingerprint) throw new RuntimeError('This event key was already used with different content.', 409); return this.publicMessage(prior); }
    const config = this.store.settings(environment);
    const custom = config.emailMode === 'custom' ? (await this.store.deps.integration(environment)).resend : undefined;
    if (environment === 'production' && !(await this.store.readiness(environment)).emailReady) throw new RuntimeError('Email is not ready. The project owner must verify their BrainHalf email or configure a sending provider.', 503);
    const id = crypto.randomUUID(); const now = Date.now();
    const sealed = await sealSecret({ payload, appName: config.appName, ...(custom ? { custom: { apiKey: custom.apiKey, from: custom.from } } : {}) } satisfies SealedMail, this.store.deps.env.PROJECT_SECRETS_KEY || '', this.scope({ environment, id }));
    if (await this.store.deps.storage.get('deleted')) throw new RuntimeError('App not found.', 404);
    if (!this.store.settings(environment).emailEnabled) throw new RuntimeError('Email is disabled for this app.', 503);
    // Recheck after asynchronous encryption/readiness work; retries cannot create duplicate rows.
    const raced = existing();
    if (raced) { if (raced.request_hash !== fingerprint) throw new RuntimeError('This event key was already used with different content.', 409); return this.publicMessage(raced); }
    this.store.limit(`mail:${environment}:${new Date(now).toISOString().slice(0, 10)}`, PILOT_LIMITS.dailyEmails, 86_400_000);
    const status = environment === 'development' ? 'captured' : 'queued';
    this.store.sql.exec('INSERT INTO managed_emails (id,environment,kind,recipient,subject,status,sealed,idempotency_key,request_hash,next_at,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, environment, kind, payload.to, payload.subject, status, sealed, key, fingerprint, status === 'queued' ? now + 100 : null, now, now);
    // A persisted queue entry survives interruption before quota accounting; the alarm accounts by stable ID.
    if (status === 'queued') await this.store.deps.schedule(now + 100);
    else {
      try { await this.store.deps.consumeEmail(id); }
      catch (error) { this.store.sql.exec("UPDATE managed_emails SET status='failed',error='Account email limit reached.' WHERE id=?", id); throw error; }
    }
    this.store.sql.exec("DELETE FROM managed_emails WHERE next_at IS NULL AND created<? AND id NOT IN (SELECT id FROM managed_emails ORDER BY created DESC LIMIT 500)", Date.now() - 30 * 86_400_000);
    return this.publicMessage(existing()!);
  }
  async retry(environment: ProjectEnvironment, id: string) {
    const row = this.store.sql.exec<MailRow>('SELECT * FROM managed_emails WHERE environment=? AND id=?', environment, id).toArray()[0];
    if (environment === 'development' || !this.store.settings(environment).emailEnabled || !row || row.status !== 'failed' || row.provider_id || row.created < Date.now() - 23 * 3_600_000) throw new RuntimeError('Only recent, unsent failed messages can be retried.');
    this.store.sql.exec("UPDATE managed_emails SET status='queued',attempts=0,next_at=?,error=NULL WHERE id=?", Date.now() + 100, id);
    await this.store.deps.schedule(Date.now() + 100);
  }
  async drain() {
    const due = this.store.sql.exec<MailRow>('SELECT * FROM managed_emails WHERE next_at<=? ORDER BY next_at LIMIT 5', Date.now()).toArray();
    for (const row of due) {
      if (await this.store.deps.storage.get('deleted')) return;
      const attempt = row.attempts + 1;
      if (row.status === 'sent') {
        this.store.sql.exec('UPDATE managed_emails SET next_at=?,polls=polls+1 WHERE id=?', Date.now() + 60_000, row.id);
        await this.store.deps.schedule(Date.now() + 60_000);
        try {
          const mail = await this.payload(row);
          const result = mail.custom ? await resendStatus(mail.custom.apiKey, row.provider_id!) : await this.store.platform<{ status: 'sent' | 'delivered' | 'bounced' | 'failed' }>('/email/status', row.environment, { id: row.provider_id });
          this.store.sql.exec('UPDATE managed_emails SET status=?,updated=?,next_at=?,error=NULL WHERE id=?', result.status, Date.now(), result.status === 'sent' && row.polls < 7 ? Date.now() + Math.min(3_600_000, 60_000 * 2 ** row.polls) : null, row.id);
        } catch {
          this.store.sql.exec('UPDATE managed_emails SET next_at=?,error=? WHERE id=?', row.polls < 7 ? Date.now() + 300_000 : null, 'Delivery confirmation unavailable; provider accepted the message.', row.id);
        }
        continue;
      }
      if (!this.store.settings(row.environment).emailEnabled || row.environment === 'development') {
        this.store.sql.exec("UPDATE managed_emails SET status='failed',next_at=NULL,error='Email sending is disabled.' WHERE id=?", row.id); continue;
      }
      if (attempt > 5 || row.created < Date.now() - 23 * 3_600_000) {
        this.store.sql.exec("UPDATE managed_emails SET status='failed',next_at=NULL,error='Automatic retry limit reached.' WHERE id=?", row.id); continue;
      }
      this.store.sql.exec("UPDATE managed_emails SET status='sending',attempts=?,next_at=?,updated=? WHERE id=?", attempt, Date.now() + 30_000, Date.now(), row.id);
      await this.store.deps.schedule(Date.now() + 30_000);
      try {
        await this.store.deps.consumeEmail(row.id);
        const mail = await this.payload(row);
        if (await this.store.deps.storage.get('deleted')) return;
        if (!this.store.settings(row.environment).emailEnabled) throw new RuntimeError('Email is disabled.', 403);
        const result = mail.custom ? await sendResend(mail.custom.apiKey, `${mail.appName.replace(/[<>"\\\r\n]/g, '')} <${mail.custom.from}>`, mail.payload, row.id)
          : await this.store.platform<{ id: string }>('/email', row.environment, { payload: mail.payload, key: row.id, appName: mail.appName });
        this.store.sql.exec("UPDATE managed_emails SET status='sent',provider_id=?,next_at=?,updated=?,error=NULL WHERE id=?", result.id, Date.now() + 60_000, Date.now(), row.id);
      } catch (error) {
        const retryable = error instanceof MailProviderError ? error.retryable : error instanceof RuntimeError ? error.status >= 500 && (error as RuntimeError & { retryable?: boolean }).retryable !== false : true;
        const again = retryable && attempt < 5;
        this.store.sql.exec('UPDATE managed_emails SET status=?,next_at=?,updated=?,error=? WHERE id=?', again ? 'queued' : 'failed', again ? Date.now() + 30_000 * 2 ** attempt : null, Date.now(), error instanceof MailProviderError ? error.message : error instanceof RuntimeError && error.status === 429 ? 'Account email limit reached.' : 'Email could not be sent. Check sending configuration.', row.id);
      }
    }
    // Retain bounded operational history. Active work is never pruned.
    this.store.sql.exec("DELETE FROM managed_emails WHERE next_at IS NULL AND created<? AND id NOT IN (SELECT id FROM managed_emails ORDER BY created DESC LIMIT 500)", Date.now() - 30 * 86_400_000);
    const next = this.nextDue(); if (next !== null && !await this.store.deps.storage.get('deleted')) await this.store.deps.schedule(next);
  }
}
