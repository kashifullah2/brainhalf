import { useState } from 'react';
import { runtimeRequest } from '../lib/project-runtime-client';
import type { IntegrationProvider, ProjectEnvironment } from '../runtime/types';
import ConfirmModal from './ConfirmModal';

export default function ProjectConnections({ projectId, environment, onChanged }: { projectId: string; environment: ProjectEnvironment; onChanged: () => void }) {
  const [provider, setProvider] = useState<IntegrationProvider>('google');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [remove, setRemove] = useState(false);
  const names = provider === 'google' ? [['clientId', 'Google client ID', 'text'], ['clientSecret', 'Google client secret', 'password']] : [['apiKey', 'Resend API key', 'password'], ['from', 'Verified sender email', 'text'], ['contactTo', 'Contact recipient email', 'email'], ['webhookSecret', 'Webhook signing secret (optional)', 'password']];
  async function save(method: 'PUT' | 'DELETE') {
    if (busy) return; setBusy(true); setNotice('');
    try {
      await runtimeRequest(projectId, `/integrations/${provider}`, environment, { method, ...(method === 'PUT' ? { body: JSON.stringify(fields) } : {}) });
      setFields({}); setRemove(false); setNotice(method === 'PUT' ? 'Connection saved. Test the real sign-in or delivery flow before relying on it.' : 'Custom connection removed. The managed provider is selected.'); onChanged();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Connection could not be saved.'); }
    finally { setBusy(false); }
  }
  return <details className="settings-card"><summary>Custom provider connections</summary><p>Credentials are encrypted on the server and belong to this environment. They are cleared from this form after saving.</p>
    <form className="settings-integration" onSubmit={event => { event.preventDefault(); void save('PUT'); }}><fieldset disabled={busy}><label>Provider<select value={provider} onChange={event => { setProvider(event.target.value as IntegrationProvider); setFields({}); setNotice(''); }}><option value="google">Google</option><option value="resend">Resend</option></select></label>
      {names.map(([name, label, type]) => <label key={name}>{label}<input type={type} value={fields[name] || ''} maxLength={4000} autoComplete="off" onChange={event => setFields(current => ({ ...current, [name]: event.target.value }))} /></label>)}
      <div className="settings-actions"><button type="submit">Save connection</button><button type="button" onClick={() => setRemove(true)}>Remove custom connection</button></div>
    </fieldset></form>{notice && <p role="status">{notice}</p>}
    <ConfirmModal isOpen={remove} title="Remove custom provider?" message={`This removes the ${provider} credentials from ${environment} and switches the app to BrainHalf's managed provider.`} confirmLabel="Remove connection" pending={busy} onConfirm={() => void save('DELETE')} onCancel={() => { if (!busy) setRemove(false); }} />
  </details>;
}
