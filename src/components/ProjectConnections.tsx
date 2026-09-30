import { useState } from 'react';
import { runtimeRequest } from '../lib/project-runtime-client';
import type { IntegrationProvider, ProjectEnvironment } from '../runtime/types';
import ConfirmModal from './ConfirmModal';

export default function ProjectConnections({ projectId, environment, onChanged }: { projectId: string; environment: ProjectEnvironment; onChanged: () => void }) {
  const [provider, setProvider] = useState<IntegrationProvider>('google');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [remove, setRemove] = useState(false);
  const fieldsByProvider: Record<IntegrationProvider, [string, string, string][]> = {
    google: [['clientId', 'Google ID', 'text'], ['clientSecret', 'Google secret', 'password']],
    github: [['clientId', 'GitHub ID', 'text'], ['clientSecret', 'GitHub secret', 'password']],
    resend: [['apiKey', 'Resend key', 'password'], ['from', 'Verified sender email', 'text'], ['contactTo', 'Contact recipient email', 'email'], ['webhookSecret', 'Incoming mail security code (optional)', 'password']],
  };
  const envName = environment === 'development' ? 'test' : 'live';
  const names = fieldsByProvider[provider];
  async function save(method: 'PUT' | 'DELETE') {
    if (busy) return; setBusy(true); setNotice('');
    try {
      await runtimeRequest(projectId, `/integrations/${provider}`, environment, { method, ...(method === 'PUT' ? { body: JSON.stringify(fields) } : {}) });
      setFields({}); setRemove(false); setNotice(method === 'PUT' ? 'Saved. Try a real sign-in or send a test email before relying on it.' : provider === 'github' ? 'Removed. GitHub sign-in is now off.' : "Removed. The app now uses BrainHalf's built-in service."); onChanged();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Connection could not be saved.'); }
    finally { setBusy(false); }
  }
  return <details className="settings-card"><summary>Your own sign-in &amp; email accounts</summary><p>Your keys are stored securely and only apply to the {envName} app. They are cleared from this form after saving.</p>
    <form className="settings-integration" onSubmit={event => { event.preventDefault(); void save('PUT'); }}><fieldset disabled={busy}><label>Service<select value={provider} onChange={event => { setProvider(event.target.value as IntegrationProvider); setFields({}); setNotice(''); }}><option value="google">Google</option><option value="github">GitHub</option><option value="resend">Resend</option></select></label>
      {names.map(([name, label, type]) => <label key={name}>{label}<input type={type} value={fields[name] || ''} maxLength={4000} autoComplete="off" onChange={event => setFields(current => ({ ...current, [name]: event.target.value }))} /></label>)}
      <div className="settings-actions"><button type="submit" className="button-primary">Save</button><button type="button" className="button-ghost" onClick={() => setRemove(true)}>Remove</button></div>
    </fieldset></form>{notice && <p role="status" className="settings-notice">{notice}</p>}
    <ConfirmModal isOpen={remove} title="Remove this connection?" message={provider === 'github' ? `This removes your GitHub details from the ${envName} app and turns GitHub sign-in off.` : `This removes your ${provider} details from the ${envName} app and switches back to BrainHalf's built-in service.`} confirmLabel="Remove connection" pending={busy} onConfirm={() => void save('DELETE')} onCancel={() => { if (!busy) setRemove(false); }} />
  </details>;
}
