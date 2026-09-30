import type { ProductOutcomes } from '../lib/product-outcomes';
import { useEffect, useState } from 'react';
import { authFetch } from '../lib/auth-client';
import { runtimeRequest } from '../lib/project-runtime-client';
import type { AiUsage } from '../lib/ai-budget';
import type { RuntimeStatus, VerificationReport } from '../runtime/types';

interface Generation { model: string; started_at: number; finished_at: number | null; status: string; input_tokens: number | null; output_tokens: number | null; source_revision?: string | null; first_response_at?: number | null; provider_calls?: number | null }
export default function ProjectAgentUsage({ projectId }: { projectId: string }) {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [verification, setVerification] = useState<VerificationReport | null>(null);
  const [error, setError] = useState('');
  const [allowanceError, setAllowanceError] = useState('');
  const [outcomes, setOutcomes] = useState<ReturnType<ProductOutcomes['report']> | null>(null);
  const [outcomesError, setOutcomesError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? import.meta.env.VITE_BACKEND_HOST || '' : '';
    setError(''); setAllowanceError(''); setOutcomes(null); setOutcomesError('');
    void authFetch(`${origin}/api/account/outcomes`, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok || typeof data.generations !== 'number') throw new Error('Outcome metrics could not be loaded.');
      if (!controller.signal.aborted) setOutcomes(data);
    }).catch(() => { if (!controller.signal.aborted) setOutcomesError('Outcome metrics could not be loaded. Refresh to retry.'); });
    void authFetch(`${origin}/agents/chat-agent/${encodeURIComponent(projectId)}/usage`, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok || !Array.isArray(data.generations)) throw new Error('AI activity could not be loaded.');
      if (!controller.signal.aborted) setGenerations(data.generations);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    void authFetch(`${origin}/api/account/ai-usage`, { signal: controller.signal }).then(async response => {
      const data = await response.json(); if (!response.ok || !data.limits) throw new Error('Account allowance could not be loaded.');
      if (!controller.signal.aborted) setUsage(data);
    }).catch(cause => { if (!controller.signal.aborted) setAllowanceError(cause.message); });
    void runtimeRequest<RuntimeStatus>(projectId, '/status', 'development', { signal: controller.signal }).then(status => { if (!controller.signal.aborted) setVerification(status.verification); }).catch(() => { if (!controller.signal.aborted) setVerification(null); });
    return () => controller.abort();
  }, [projectId, version]);
  return <section className="settings-card"><h3>AI usage &amp; app checks</h3>
    <p>Builder activity and automatic app checks are counted separately. Numbers stay blank when the AI provider doesn't report them.</p>
    <div className="settings-actions"><button type="button" className="button-secondary" onClick={() => setVersion(value => value + 1)}>Refresh</button></div>
    <h4>Your results</h4>
    <p>Across your whole account, since we started measuring. App checks tested one exact version — they can't cover every possible thing a visitor might do.</p>
    {outcomesError && <p role="status" className="settings-error">{outcomesError}</p>}
    {outcomes && <dl className="product-outcome-grid">
      <div><dt>Working apps / builds</dt><dd>{outcomes.verifiedWorkingGenerations} / {outcomes.generations}</dd></div>
      <div><dt>Successful publishes</dt><dd>{outcomes.published} / {outcomes.publishAttempts}</dd></div>
      <div><dt>Time to first live app</dt><dd>{outcomes.medianTimeToFirstLiveMs === null ? 'No live app yet' : `${Math.max(1, Math.round(outcomes.medianTimeToFirstLiveMs / 60000))} min`}</dd></div>
      <div><dt>Came back in week one</dt><dd>{outcomes.weekOneRetention === null ? 'Awaiting full 14-day window' : outcomes.returnedWeekOneAccounts ? 'Yes' : 'No'}</dd></div>
    </dl>}
    {allowanceError && <p role="status" className="settings-error">{allowanceError}</p>}
    {usage && <div className="settings-notice"><strong>Daily AI allowance · {usage.day}</strong><p>{usage.calls} / {usage.limits.dailyCalls} AI requests · {usage.reservedOutputTokens?.toLocaleString() ?? '—'} / {usage.limits.dailyOutputTokens?.toLocaleString() ?? '—'} writing space reserved · {usage.activeGenerations} / {usage.limits.concurrentGenerations} builds running now.</p><p>Shared across all your projects. Each AI request sets aside its maximum writing space up front, including retries. Unused space is released at midnight. This is a safety limit — not a bill, and not a count of words actually written.</p></div>}
    {error && <p role="status" className="settings-error">{error}</p>}{!error && !generations.length && <p className="settings-muted">No builder activity recorded yet.</p>}
    {!!generations.length && <>
      <p className="settings-muted">First response measures how long until the builder first does something visible. AI calls include retries. Older activity shows a dash when measurements are missing.</p>
      <div className="settings-table-scroll" role="region" aria-label="Builder activity" tabIndex={0}><table><thead><tr><th>AI model</th><th>Status</th><th>Checks</th><th>Text in / out</th><th>First response</th><th>AI requests</th><th>Duration</th></tr></thead><tbody>{generations.map((item, index) => <tr key={index}><td>{item.model === 'claude-sonnet-6' ? 'Claude Sonnet 4.6' : item.model}</td><td>{item.status}</td><td>{item.source_revision && verification?.revision === item.source_revision ? verification.passed ? 'Passed on this version' : 'Failed on this version' : 'Not checked'}</td><td>{item.input_tokens?.toLocaleString() ?? '—'} / {item.output_tokens?.toLocaleString() ?? '—'}</td><td>{item.first_response_at != null ? `${Math.max(0, (item.first_response_at - item.started_at) / 1000).toFixed(1)}s` : '—'}</td><td>{item.provider_calls ?? '—'}</td><td>{item.finished_at ? `${Math.round((item.finished_at - item.started_at) / 1000)}s` : '—'}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
