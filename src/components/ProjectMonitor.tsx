import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { runtimeRequest } from '../lib/project-runtime-client';
import { safeCatch } from '../lib/safe-catch';
import type { ProjectEnvironment } from '../runtime/types';

interface Monitoring { daily: Array<{ day: string; requests: number; errors: number; total_ms: number }>; recent: Array<{ method: string; route: string; status: number; duration_ms: number; created_at: number }> }
export default function ProjectMonitor({ projectId, environment }: { projectId: string; environment: ProjectEnvironment }) {
  const [data, setData] = useState<Monitoring | null>(null); const [error, setError] = useState(''); const [version, setVersion] = useState(0);
  useEffect(() => { const controller = new AbortController(); void runtimeRequest<Monitoring>(projectId, '/monitor', environment, { signal: controller.signal }).then(value => { setData(value); setError(''); }).catch(safeCatch(controller.signal, setError, 'Monitoring unavailable.')); return () => controller.abort(); }, [projectId, environment, version]);
  const totals = data?.daily?.reduce((sum, day) => ({ requests: sum.requests + day.requests, errors: sum.errors + day.errors, duration: sum.duration + day.total_ms }), { requests: 0, errors: 0, duration: 0 });
  const envName = environment === 'development' ? 'test' : 'live';
  return <section className="settings-card"><h3><Activity size={17} />App activity</h3>
    <p>How your {envName} app is being used: totals for the last 7 days plus the 100 most recent visits. Private details (like form contents and passwords) are never shown.</p>
    <div className="settings-actions"><button type="button" className="button-secondary" onClick={() => setVersion(value => value + 1)}>Refresh activity</button></div>
    {error && <p role="status" className="settings-error">{error}</p>}
    {totals && <dl className="monitor-summary">
      <div><dt>Times the app was used</dt><dd>{totals.requests.toLocaleString()}</dd></div>
      <div><dt>Errors</dt><dd>{totals.errors.toLocaleString()}</dd></div>
      <div><dt>Average speed</dt><dd>{totals.requests ? Math.round(totals.duration / totals.requests) : 0} ms</dd></div>
    </dl>}
    {data && !data.recent?.length && <p className="settings-muted">No activity yet — open your {envName} app to get started.</p>}
    {!!data?.recent?.length && <div className="settings-table-scroll" role="region" aria-label="Recent app visits" tabIndex={0}><table><thead><tr><th>Time</th><th>What was opened</th><th>Result</th><th>How long</th></tr></thead><tbody>{data.recent.map((entry, index) => <tr key={index}><td>{new Date(entry.created_at).toLocaleTimeString()}</td><td>{entry.method} {entry.route}</td><td className={entry.status >= 500 ? 'settings-error' : ''}>{entry.status}</td><td>{entry.duration_ms} ms</td></tr>)}</tbody></table></div>}
  </section>;
}
