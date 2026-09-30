import { useEffect, useState, type FormEvent } from 'react';
import { Mail, Users, ShieldCheck, ExternalLink } from 'lucide-react';
import { runtimeRequest } from '../lib/project-runtime-client';
import type { ProjectEnvironment } from '../runtime/types';
import type { ManagedStatus, ManagedUser, ManagedMessage, EmailTemplate, ManagedSettings } from '../runtime/managed-types';

interface Props { projectId: string; environment: ProjectEnvironment; connectionsVersion: string }
const labels = { verify_email: 'Confirm email address', reset_password: 'Reset password', magic_link: 'Sign-in link', welcome: 'Welcome', order_receipt: 'Order receipt', contact: 'Contact form' };
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
  const save = (event: FormEvent) => { event.preventDefault(); void run(async () => { const result = await request<ManagedStatus>('/services', 'PUT', settings); setStatus(result); setSettings(result.settings); setNotice('Sign-in and email settings saved.'); }); };
  const changeUser = (user: ManagedUser, patch: Partial<ManagedUser>) => run(async () => { await request('/services/users/' + encodeURIComponent(user.id), 'PATCH', patch); await load('users'); setNotice('User updated. Disabling signs them out everywhere.'); });
  const envName = environment === 'development' ? 'test' : 'live';
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
    <h3 id="services-title"><ShieldCheck size={18} />Sign-in &amp; email</h3>
    <p>Use BrainHalf's built-in Google sign-in and email, or connect your own accounts below.</p>
    <nav className="settings-actions" aria-label="Sign-in and email sections">{(['settings', 'users', 'templates', 'messages'] as const).map(value => <button type="button" key={value} aria-pressed={tab === value} disabled={busy} onClick={() => void run(() => load(value))}>{value === 'settings' ? 'Setup' : value === 'users' ? <><Users size={14} />App users</> : value === 'messages' ? <><Mail size={14} />Email inbox</> : 'Email templates'}</button>)}</nav>
    {notice && <p role="status" className="settings-notice">{notice}</p>}
    {!status && !notice && <p role="status">Loading services…</p>}
    {status && settings && tab === 'settings' && <>
      <div className="services-readiness"><span>Google sign-in: <strong>{status.providers.googleReady ? 'Ready' : 'Not set up'}</strong></span><span>GitHub sign-in: <strong>{status.providers.githubReady ? 'Ready' : 'Not set up'}</strong></span><span>Email: <strong>{environment === 'development' && settings.emailEnabled ? 'Test inbox' : status.providers.emailReady ? 'Ready' : 'Not set up'}</strong></span></div>
      {environment === 'production' && settings.emailMode === 'managed' && !status.providers.ownerVerified && <p className="settings-notice"><a href="/resend-verification" target="_blank" rel="noopener noreferrer">Verify your BrainHalf account email</a> to turn on email.</p>}
      {!status.providers.googleReady && settings.googleEnabled && <p className="settings-muted">Google sign-in is switched on but missing its account details. Even a connected account needs one real sign-in test.</p>}
      {settings.githubEnabled && !status.providers.githubReady && <p className="settings-muted">GitHub sign-in is on but missing its account details. Add them under "Your own sign-in &amp; email accounts" below.</p>}
      <form onSubmit={save} className="settings-integration"><fieldset disabled={busy}>
        <label>App name<input value={settings.appName} maxLength={60} required onChange={event => setSettings({ ...settings, appName: event.target.value })} /></label>
        <div className="services-grid"><label>Google sign-in<select value={settings.googleMode} onChange={event => setSettings({ ...settings, googleMode: event.target.value as 'managed' | 'custom' })}><option value="managed">BrainHalf built-in</option><option value="custom">My own Google account</option></select></label><label>Email service<select value={settings.emailMode} onChange={event => setSettings({ ...settings, emailMode: event.target.value as 'managed' | 'custom' })}><option value="managed">BrainHalf built-in</option><option value="custom">My own Resend account</option></select></label></div>
        {([['googleEnabled', 'Continue with Google'], ['githubEnabled', 'Continue with GitHub'], ['passwordEnabled', 'Email and password'], ['magicLinkEnabled', 'Sign in with email link'], ['emailEnabled', 'Send email and accept contact forms'], ['welcomeEnabled', 'Welcome email after email confirmation']] as const).map(([key, label]) => <label className="services-toggle" key={key}><input type="checkbox" checked={settings[key]} onChange={event => setSettings({ ...settings, [key]: event.target.checked })} />{label}</label>)}
        <div className="settings-actions"><button type="submit" className="button-primary">Save settings</button><button type="button" className="button-secondary" onClick={openAuth}><ExternalLink size={14} />Open sign-in page</button></div>
      </fieldset></form>
      <p className="settings-muted">{status.userCount} app users · Up to {status.dailyEmailLimit} emails a day here (your account limit applies too). Test and live have separate users and emails.</p>
      {environment === 'development' ? <p className="settings-muted">Open the sign-in page, create an account, then find its confirmation link in Email inbox. Test emails stay here.</p> : <><p className="settings-muted">Contact-form messages go to {settings.emailMode === 'managed' ? status.providers.ownerEmail || 'your verified account email' : 'your configured contact destination'}. Emails are sent from {status.providers.from || 'not configured'}. “Sent” means the email service accepted it; “Delivered” means it reported a successful delivery.</p><details><summary>Send a test email</summary><p>Send one test email to {status.providers.ownerEmail || 'your verified account email'}. It says this is a test of your email setup — “sent” only means our email service accepted it, not that it reached an inbox.</p><button type="button" className="button-secondary" disabled={busy || !status.providers.emailReady || !status.providers.ownerVerified} onClick={() => void run(async () => { await request('/email-test', 'POST'); setNotice('Test email queued. Watch Email inbox to see if it arrives.'); })}>Send test email</button></details></>}
    </>}
    {tab === 'users' && <><p className="settings-muted">Your 100 newest users. The “Admin” label is passed to your app — make sure your app actually limits what admins can do.</p><div className="services-list">{users.map(user => <div key={user.id}><div><strong>{user.name || user.email}</strong><small>{user.email} · {user.disabled ? 'Disabled' : user.verified ? 'Verified' : 'Not yet confirmed'}</small></div><label className="services-role">Role<select aria-label={`Role for ${user.email}`} value={user.role} disabled={busy} onChange={event => void changeUser(user, { role: event.target.value as 'admin' | 'user' })}><option value="user">User</option><option value="admin">Admin</option></select></label><button type="button" className="button-secondary" disabled={busy} onClick={() => void changeUser(user, { disabled: !user.disabled })}>{user.disabled ? 'Enable' : 'Disable'}</button></div>)}</div>{!users.length && <p className="settings-muted">No users yet. Open the sign-in page to create the first account.</p>}</>}
    {tab === 'templates' && draft && <form className="settings-integration" onSubmit={event => { event.preventDefault(); void run(async () => { const result = await request<{ templates: EmailTemplate[] }>('/services/templates/' + draft.kind, 'PUT', draft); setTemplates(result.templates); setNotice('Template saved for future messages.'); }); }}><fieldset disabled={busy}><label>Email type<select value={draft.kind} onChange={event => setDraft(templates.find(item => item.kind === event.target.value)!)}>{templates.map(item => <option key={item.kind} value={item.kind}>{labels[item.kind]}</option>)}</select></label><label>Subject<input required maxLength={200} value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} /></label><label>Message<textarea required rows={9} maxLength={6000} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label><p className="settings-muted">Keep the {'{{placeholders}}'} — they insert app details automatically. Sign-in emails must include {'{{actionUrl}}'}.</p><div className="settings-actions"><button type="submit" className="button-primary">Save template</button></div></fieldset></form>}
    {tab === 'messages' && <><div className="settings-actions"><button type="button" className="button-secondary" disabled={busy} onClick={() => void run(() => load('messages'))}>Refresh</button></div><div className="services-list">{messages.map(message => <div key={message.id}><div><strong>{message.subject}</strong><small>{message.to} · {message.status} · {new Date(message.createdAt).toLocaleString()}</small></div><div className="settings-actions" style={{ margin: 0 }}><button type="button" className="button-secondary" disabled={busy} onClick={() => void run(async () => setDetail(await request<ManagedMessage & { text: string }>('/services/messages/' + message.id)))}>Read</button>{environment === 'production' && message.status === 'failed' && !message.providerId && <button type="button" className="button-secondary" disabled={busy} onClick={() => void run(async () => { await request('/services/messages/' + message.id + '/retry', 'POST'); await load('messages'); })}>Retry</button>}</div></div>)}</div>{!messages.length && <p className="settings-muted">No emails yet. Send one from a contact form or request a sign-in link.</p>}{detail && <div className="services-message"><h4>{detail.subject}</h4><p>{detail.to} · {detail.status} · tried {detail.attempts} time{detail.attempts === 1 ? '' : 's'}</p>{detail.error && <p role="status" className="settings-error">{detail.error}</p>}<pre>{detail.text}</pre><div className="settings-actions">{environment === 'development' && ['verify_email', 'reset_password', 'magic_link'].includes(detail.kind) && <button type="button" className="button-secondary" disabled={busy} onClick={openEmailAction}>Open test email link</button>}<button type="button" className="button-ghost" onClick={() => setDetail(null)}>Close message</button></div></div>}</>}
  </section>;
}
