import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2, Trash2, RefreshCw, Globe } from 'lucide-react';
import { runtimeRequest } from '../lib/project-runtime-client';

interface DomainInfo {
  hostname: string;
  cfId: string;
  status: string;
  ssl?: string;
  verificationRecord?: { type: string; name: string; value: string };
  verificationErrors?: string[];
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  pending: 'Pending DNS verification',
  active_redeploying: 'Updating',
  blocked: 'Blocked — contact support',
  pending_deletion: 'Removing…',
  error: 'Error',
  unknown: 'Checking…',
};

const SSL_LABEL: Record<string, string> = {
  active: 'TLS certificate active',
  initializing: 'Provisioning certificate…',
  pending_validation: 'Awaiting DNS for certificate',
  pending_issuance: 'Issuing certificate…',
  pending_deployment: 'Deploying certificate…',
  expired: 'Certificate expired',
  error: 'Certificate error',
};

export default function CustomDomainSettings({ projectId, productionUrl }: { projectId: string; productionUrl?: string }) {
  const [domain, setDomain] = useState<DomainInfo | null | undefined>(undefined);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    runtimeRequest<{ domain: DomainInfo | null }>(projectId, '/domain', 'production', { signal: controller.signal })
      .then(r => setDomain(r.domain))
      .catch(() => setDomain(null));
    return () => controller.abort();
  }, [projectId]);

  const perform = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed. Please retry.'); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const addDomain = () => perform(async () => {
    const hostname = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const result = await runtimeRequest<{ domain: DomainInfo }>(projectId, '/domain', 'production', {
      method: 'POST', body: JSON.stringify({ hostname }),
    });
    setDomain(result.domain);
    setInput('');
  });

  const refresh = () => perform(async () => {
    const result = await runtimeRequest<{ domain: DomainInfo | null }>(projectId, '/domain', 'production');
    setDomain(result.domain);
  });

  const removeDomain = () => perform(async () => {
    await runtimeRequest(projectId, '/domain', 'production', { method: 'DELETE', body: '{}' });
    setDomain(null);
  });

  const appOrigin = productionUrl ? new URL(productionUrl).hostname : undefined;

  if (domain === undefined) {
    return <div className="custom-domain-loading"><Loader2 size={16} className="publication-spinner" /><span>Loading domain settings…</span></div>;
  }

  return (
    <div className="custom-domain-settings">
      <p className="custom-domain-intro">
        Point your own domain to this app. Add the domain below, then add a CNAME record with your DNS provider.
        TLS is provisioned automatically.
      </p>

      {!domain ? (
        <div className="custom-domain-add">
          <label htmlFor="custom-domain-input">Your domain</label>
          <div className="custom-domain-row">
            <Globe size={15} className="custom-domain-icon" aria-hidden="true" />
            <input
              id="custom-domain-input"
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void addDomain()}
              placeholder="myapp.example.com"
              spellCheck={false}
              disabled={busy}
            />
            <button type="button" className="button-primary" disabled={busy || !input.trim()} onClick={() => void addDomain()}>
              {busy ? <><Loader2 size={14} className="publication-spinner" />Adding…</> : 'Add domain'}
            </button>
          </div>
          {error && <p className="settings-error" role="alert">{error}</p>}
        </div>
      ) : (
        <div className="custom-domain-card">
          <div className="custom-domain-header">
            <div>
              <strong className="custom-domain-hostname">{domain.hostname}</strong>
              <span className={`custom-domain-status status-${domain.status}`}>{STATUS_LABEL[domain.status] || domain.status}</span>
              {domain.ssl && <span className="custom-domain-ssl">{SSL_LABEL[domain.ssl] || domain.ssl}</span>}
            </div>
            <div className="custom-domain-actions">
              <button type="button" title="Refresh status" aria-label="Refresh domain status" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw size={14} />
              </button>
              {domain.status === 'active' && (
                <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer" title="Open live app" aria-label="Open live app">
                  <ExternalLink size={14} />
                </a>
              )}
              <button type="button" title="Remove custom domain" aria-label="Remove custom domain" disabled={busy} onClick={() => void removeDomain()}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {error && <p className="settings-error" role="alert">{error}</p>}

          {domain.status !== 'active' && (
            <div className="custom-domain-dns">
              <p><strong>Add this CNAME record</strong> with your DNS provider to connect your domain:</p>
              <table className="dns-record-table">
                <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
                <tbody>
                  <tr>
                    <td>CNAME</td>
                    <td>{domain.hostname.split('.').slice(0, -2).join('.') || '@'}</td>
                    <td className="dns-value">
                      <code>{appOrigin || `${projectId}.apps.brainhalf.com`}</code>
                      <CopyButton text={appOrigin || `${projectId}.apps.brainhalf.com`} />
                    </td>
                  </tr>
                  {domain.verificationRecord && (
                    <tr>
                      <td>{domain.verificationRecord.type}</td>
                      <td>{domain.verificationRecord.name}</td>
                      <td className="dns-value">
                        <code>{domain.verificationRecord.value}</code>
                        <CopyButton text={domain.verificationRecord.value} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="custom-domain-hint">DNS changes can take up to 24 hours to propagate. Refresh to check status.</p>
              {domain.verificationErrors?.length ? (
                <p className="settings-error">{domain.verificationErrors.join(' ')}</p>
              ) : null}
            </div>
          )}

          {domain.status === 'active' && (
            <div className="custom-domain-live">
              <Check size={14} style={{ color: 'var(--color-success)' }} />
              <span>Your app is live at <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer">{domain.hostname}</a></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="dns-copy-btn"
      title="Copy"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {})}
    >
      {copied ? <Check size={12} /> : 'Copy'}
    </button>
  );
}
