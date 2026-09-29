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
  return <section className="settings-card"><h3>AI usage and app verification</h3>
    <button onClick={() => setVersion(value => value + 1)}>Refresh usage</button>
    <p>Response completion and working-app verification are separate. Provider-reported token counts stay blank when unavailable.</p>
    <h4>Your app outcomes</h4>
    <p>Across your account, since measurement began. App checks apply to the exact generated revision; they do not guarantee every possible workflow.</p>
    {outcomesError && <p role="status">{outcomesError}</p>}
    {outcomes && <dl className="product-outcome-grid">
      <div><dt>Verified apps / generations</dt><dd>{outcomes.verifiedWorkingGenerations} / {outcomes.generations}</dd></div>
      <div><dt>Successful publishing</dt><dd>{outcomes.published} / {outcomes.publishAttempts}</dd></div>
      <div><dt>Time to first live app</dt><dd>{outcomes.medianTimeToFirstLiveMs === null ? 'No live app yet' : `${Math.max(1, Math.round(outcomes.medianTimeToFirstLiveMs / 60000))} min`}</dd></div>
      <div><dt>Returned in week one</dt><dd>{outcomes.weekOneRetention === null ? 'Awaiting full 14-day window' : outcomes.returnedWeekOneAccounts ? 'Yes' : 'No'}</dd></div>
    </dl>}
    {allowanceError && <p role="status">{allowanceError}</p>}
    {usage && <div className="settings-notice"><strong>Account allowance · {usage.day} UTC</strong><p>{usage.calls} / {usage.limits.dailyCalls} provider calls · {usage.reservedOutputTokens?.toLocaleString() ?? '—'} / {usage.limits.dailyOutputTokens?.toLocaleString() ?? '—'} output tokens reserved · {usage.activeGenerations} / {usage.limits.concurrentGenerations} active generations.</p><p>Shared across all projects and model tests. Each provider call reserves its maximum output before starting, including retries. Unused reservations are retained until midnight UTC. This is a protective allowance, not a monetary bill or a count of tokens actually used.</p></div>}
    {error && <p role="status">{error}</p>}{!error && !generations.length && <p>No recorded generations yet.</p>}
    {!!generations.length && <>
      <p className="settings-muted">First response measures time from generation start to the first text or tool activity. Provider calls include tool rounds and retries. Older generations show a dash when these measurements are unavailable.</p>
      <div className="settings-table-scroll" role="region" aria-label="Agent generation activity" tabIndex={0}><table><thead><tr><th>Model</th><th>Response</th><th>App checks</th><th>Input / output tokens</th><th>First response</th><th>Provider calls</th><th>Duration</th></tr></thead><tbody>{generations.map((item, index) => <tr key={index}><td>{item.model === 'claude-sonnet-6' ? 'Claude Sonnet 4.6' : item.model}</td><td>{item.status}</td><td>{item.source_revision && verification?.revision === item.source_revision ? verification.passed ? 'Passed for this revision' : 'Failed for this revision' : 'No matching verification'}</td><td>{item.input_tokens?.toLocaleString() ?? '—'} / {item.output_tokens?.toLocaleString() ?? '—'}</td><td>{item.first_response_at != null ? `${Math.max(0, (item.first_response_at - item.started_at) / 1000).toFixed(1)}s` : '—'}</td><td>{item.provider_calls ?? '—'}</td><td>{item.finished_at ? `${Math.round((item.finished_at - item.started_at) / 1000)}s` : '—'}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
