import { useEffect, useState, type FormEvent } from 'react';
import { Mail, Users, ShieldCheck, ExternalLink } from 'lucide-react';
import { runtimeRequest } from '../lib/project-runtime-client';
import type { ProjectEnvironment } from '../runtime/types';
import type { ManagedStatus, ManagedUser, ManagedMessage, EmailTemplate, ManagedSettings } from '../runtime/managed-types';

interface Props { projectId: string; environment: ProjectEnvironment; connectionsVersion: string }
const labels = { verify_email: 'Verify email', reset_password: 'Reset password', magic_link: 'Sign-in link', welcome: 'Welcome', order_receipt: 'Order receipt', contact: 'Contact form' };
export default function ProjectServices({ projectId, environment, connectionsVersion }: Props) {
  const [status, setStatus] = useState<ManagedStatus | null>(null);
  const [settings, setSettings] = useState<ManagedSettings | null>(null);
  const [tab, setTab] = useState<'settings' | 'users' | 'templates' | 'messages'>('settings');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [draft, setDraft] = useState<EmailTemplate | null>(null);
  const [messages, setMessages] = useState<ManagedMessage[]>([]);
  const [detail, setDetail] = useState<(ManagedMessage & { text: string }) | null>(null);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const request = <T,>(path: string, method = 'GET', body?: unknown) => runtimeRequest<T>(projectId, path, environment, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  useEffect(() => {
    const controller = new AbortController();
    void runtimeRequest<ManagedStatus>(projectId, '/services', environment, { signal: controller.signal }).then(result => { setStatus(result); setSettings(result.settings); }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [projectId, environment, connectionsVersion]);
  const run = async (work: () => Promise<void>) => { setBusy(true); setNotice(''); try { await work(); } catch (error) { setNotice(error instanceof Error ? error.message : 'Please try again.'); } finally { setBusy(false); } };
  const load = async (next = tab) => {
    setTab(next); setDetail(null);
    if (next === 'users') setUsers((await request<{ users: ManagedUser[] }>('/services/users')).users);
    if (next === 'messages') setMessages((await request<{ messages: ManagedMessage[] }>('/services/messages')).messages);
    if (next === 'templates') { const data = (await request<{ templates: EmailTemplate[] }>('/services/templates')).templates; setTemplates(data); setDraft(data[0]); }
  };
  const save = (event: FormEvent) => { event.preventDefault(); void run(async () => { const result = await request<ManagedStatus>('/services', 'PUT', settings); setStatus(result); setSettings(result.settings); setNotice('Authentication and email settings saved.'); }); };
  const changeUser = (user: ManagedUser, patch: Partial<ManagedUser>) => run(async () => { await request('/services/users/' + encodeURIComponent(user.id), 'PATCH', patch); await load('users'); setNotice('User updated. Disabling an account revokes its sessions.'); });
  const openAuth = () => {
    // Open synchronously so browsers do not block the tab after the request.
    const windowRef = window.open('about:blank', '_blank'); if (windowRef) windowRef.opener = null;
    void run(async () => {
      try {
        const url = environment === 'development' ? (await request<{ url: string }>('/preview-ticket', 'POST', { path: '/__brainhalf/auth' })).url : (await request<{ productionUrl: string }>('/status')).productionUrl + '/__brainhalf/auth';
        if (windowRef) windowRef.location.href = url; else setNotice('Allow pop-ups to open the sign-in page.');
      } catch (error) { windowRef?.close(); throw error; }
    });
  };
  const openEmailAction = () => {
    if (!detail) return; const target = window.open('about:blank', '_blank'); if (target) target.opener = null;
    void run(async () => { try { const result = await request<{ url: string }>('/services/messages/' + detail.id + '/open', 'POST'); if (target) target.location.href = result.url; else setNotice('Allow pop-ups to open the email link.'); } catch (error) { target?.close(); throw error; } });
  };
  return <section className="settings-card settings-services" aria-labelledby="services-title">
    <h3 id="services-title"><ShieldCheck size={18} />Authentication &amp; email</h3>
    <p>Use BrainHalf’s Google sign-in and email service, or connect your own providers below.</p>
    <nav className="settings-actions" aria-label="Authentication and email sections">{(['settings', 'users', 'templates', 'messages'] as const).map(value => <button key={value} aria-pressed={tab === value} disabled={busy} onClick={() => void run(() => load(value))}>{value === 'settings' ? 'Setup' : value === 'users' ? <><Users size={14} />App users</> : value === 'messages' ? <><Mail size={14} />Email inbox</> : 'Templates'}</button>)}</nav>
    {notice && <p role="status" className="settings-notice">{notice}</p>}
    {!status && !notice && <p role="status">Loading services…</p>}
    {status && settings && tab === 'settings' && <>
      <div className="services-readiness"><span>Google: <strong>{status.providers.googleReady ? 'Ready' : 'Unavailable'}</strong></span><span>GitHub: <strong>{status.providers.githubReady ? 'Ready' : 'Unavailable'}</strong></span><span>Email: <strong>{environment === 'development' && settings.emailEnabled ? 'Test inbox' : status.providers.emailReady ? 'Ready' : 'Unavailable'}</strong></span></div>
      {environment === 'production' && settings.emailMode === 'managed' && !status.providers.ownerVerified && <p className="settings-notice"><a href="/resend-verification" target="_blank" rel="noopener noreferrer">Verify your BrainHalf account email</a> to activate managed email.</p>}
      {!status.providers.googleReady && settings.googleEnabled && <p className="settings-muted">Google sign-in needs the selected provider’s credentials. A ready connection still needs a real sign-in test.</p>}
      {settings.githubEnabled && !status.providers.githubReady && <p className="settings-muted">GitHub sign-in is on but has no credentials. Add your GitHub OAuth app under Custom provider connections below.</p>}
      <form onSubmit={save} className="settings-integration"><fieldset disabled={busy}>
        <label>App name<input value={settings.appName} maxLength={60} required onChange={event => setSettings({ ...settings, appName: event.target.value })} /></label>
        <div className="services-grid"><label>Google provider<select value={settings.googleMode} onChange={event => setSettings({ ...settings, googleMode: event.target.value as 'managed' | 'custom' })}><option value="managed">BrainHalf managed</option><option value="custom">My Google credentials</option></select></label><label>Email provider<select value={settings.emailMode} onChange={event => setSettings({ ...settings, emailMode: event.target.value as 'managed' | 'custom' })}><option value="managed">BrainHalf managed</option><option value="custom">My Resend credentials</option></select></label></div>
        {([['googleEnabled', 'Continue with Google'], ['githubEnabled', 'Continue with GitHub'], ['passwordEnabled', 'Email and password'], ['magicLinkEnabled', 'Email sign-in links'], ['emailEnabled', 'Send email and accept contact forms'], ['welcomeEnabled', 'Welcome email after email verification']] as const).map(([key, label]) => <label className="services-toggle" key={key}><input type="checkbox" checked={settings[key]} onChange={event => setSettings({ ...settings, [key]: event.target.checked })} />{label}</label>)}
        <div className="settings-actions"><button type="submit">Save settings</button><button type="button" onClick={openAuth}><ExternalLink size={14} />Open sign-in page</button></div>
      </fieldset></form>
      <p className="settings-muted">{status.userCount} app users · Up to {status.dailyEmailLimit} emails per day in this environment; your account limit also applies. Development and production have separate users and messages.</p>
      {environment === 'development' ? <p className="settings-muted">Open the sign-in page, create an account, then open Email inbox to use its verification link. Development messages stay here.</p> : <><p className="settings-muted">Contact forms go to {settings.emailMode === 'managed' ? status.providers.ownerEmail || 'your verified account email' : 'your configured contact destination'}. Sender: {status.providers.from || 'not configured'}. “Sent” means the provider accepted it; “Delivered” means delivery was reported.</p><details><summary>Test live email</summary><p>Send one labeled test to {status.providers.ownerEmail || 'your verified account email'}. It says: “This verifies your project email configuration. Provider acceptance does not confirm inbox delivery.”</p><button disabled={busy || !status.providers.emailReady || !status.providers.ownerVerified} onClick={() => void run(async () => { await request('/email-test', 'POST'); setNotice('Test queued. Open Email inbox to follow delivery.'); })}>Send test to {status.providers.ownerEmail || 'my email'}</button></details></>}
    </>}
    {tab === 'users' && <><p className="settings-muted">Most recent 100 app users. Roles are supplied to your backend; it must enforce admin permissions.</p><div className="services-list">{users.map(user => <div key={user.id}><div><strong>{user.name || user.email}</strong><small>{user.email} · {user.disabled ? 'Disabled' : user.verified ? 'Verified' : 'Awaiting verification'}</small></div><label className="services-role">Role<select aria-label={`Role for ${user.email}`} value={user.role} disabled={busy} onChange={event => void changeUser(user, { role: event.target.value as 'admin' | 'user' })}><option value="user">User</option><option value="admin">Admin</option></select></label><button disabled={busy} onClick={() => void changeUser(user, { disabled: !user.disabled })}>{user.disabled ? 'Enable' : 'Disable'}</button></div>)}</div>{!users.length && <p>No app accounts yet. Open the sign-in page to create the first one.</p>}</>}
    {tab === 'templates' && draft && <form className="settings-integration" onSubmit={event => { event.preventDefault(); void run(async () => { const result = await request<{ templates: EmailTemplate[] }>('/services/templates/' + draft.kind, 'PUT', draft); setTemplates(result.templates); setNotice('Template saved for future messages.'); }); }}><fieldset disabled={busy}><label>Email type<select value={draft.kind} onChange={event => setDraft(templates.find(item => item.kind === event.target.value)!)}>{templates.map(item => <option key={item.kind} value={item.kind}>{labels[item.kind]}</option>)}</select></label><label>Subject<input required maxLength={200} value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} /></label><label>Message<textarea required rows={9} maxLength={6000} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label><p className="settings-muted">Keep the template’s {'{{fields}}'} to insert app details. Authentication messages must include {'{{actionUrl}}'}. Text is escaped safely in email.</p><button type="submit">Save template</button></fieldset></form>}
    {tab === 'messages' && <><div className="settings-actions"><button disabled={busy} onClick={() => void run(() => load('messages'))}>Refresh messages</button></div><div className="services-list">{messages.map(message => <div key={message.id}><div><strong>{message.subject}</strong><small>{message.to} · {message.status} · {new Date(message.createdAt).toLocaleString()}</small></div><button disabled={busy} onClick={() => void run(async () => setDetail(await request<ManagedMessage & { text: string }>('/services/messages/' + message.id)))}>Read</button>{environment === 'production' && message.status === 'failed' && !message.providerId && <button disabled={busy} onClick={() => void run(async () => { await request('/services/messages/' + message.id + '/retry', 'POST'); await load('messages'); })}>Retry</button>}</div>)}</div>{!messages.length && <p>No messages yet. Submit a contact form or request an email sign-in link.</p>}{detail && <div className="services-message"><h4>{detail.subject}</h4><p>{detail.to} · {detail.status} · {detail.attempts} sending attempts</p>{detail.error && <p role="status">{detail.error}</p>}<pre>{detail.text}</pre>{environment === 'development' && ['verify_email', 'reset_password', 'magic_link'].includes(detail.kind) && <button disabled={busy} onClick={openEmailAction}>Open test email link</button>}<button onClick={() => setDetail(null)}>Close message</button></div>}</>}
  </section>;
}
