import { useEffect, useState } from 'react';
import { appEvents } from '../lib/events';
import { DEFAULT_RELIABILITY } from '../lib/generation-controls';
import { AI_TIMEOUT_MS, MAX_OUTPUT_TOKENS } from '../lib/models';
import { getPromptVersions, getReliabilityControls, removePromptVersion, setReliabilityControls, usageByDay } from '../lib/project-growth';
import { getGenerationTimings } from '../lib/generation-timing';

const seconds = (value?: number) => value === undefined ? 'Not recorded' : `${(value / 1000).toFixed(1)} s`;
export default function ProjectGrowthHub({ projectId }: { projectId: string }) {
  const [versions, setVersions] = useState(() => getPromptVersions(projectId));
  const [controls, setControls] = useState(() => getReliabilityControls(projectId));
  const [timings, setTimings] = useState(() => getGenerationTimings(projectId));
  const [notice, setNotice] = useState('');
  const [usageRows, setUsageRows] = useState(() => usageByDay(projectId, 7));
  useEffect(() => {
    const refresh = () => { setVersions(getPromptVersions(projectId)); setControls(getReliabilityControls(projectId)); setTimings(getGenerationTimings(projectId)); setUsageRows(usageByDay(projectId, 7)); };
    refresh();
    return appEvents.on('generation-status', event => { if (event.projectId === projectId) refresh(); });
  }, [projectId]);

  return <section className="settings-card">
    <h3>Project settings</h3>
    <p className="settings-muted">Describe changes in chat, try them in the preview, then publish when you are ready. BrainHalf manages the app services for you.</p>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    <details>
      <summary>Previous requests</summary>
      <p className="settings-muted">Reuse a request to start a new change. Your saved app stays unchanged until you send it.</p>
      {!versions.length ? <p>Your requests will appear here after you send a message.</p> : <div className="settings-table-scroll" role="region" aria-label="Previous requests" tabIndex={0}><table><thead><tr><th>Saved</th><th>Request</th><th>Actions</th></tr></thead><tbody>{versions.slice(0, 20).map(version => <tr key={version.id}><td>{new Date(version.createdAt).toLocaleString()}</td><td>{version.prompt.slice(0, 160)}</td><td><button type="button" className="button-secondary" onClick={() => { appEvents.emit('insert-prompt-draft', { prompt: version.prompt }); setNotice('Request added to your chat draft.'); }}>Reuse</button><button type="button" className="button-ghost" onClick={() => setVersions(removePromptVersion(projectId, version.id))}>Delete</button></td></tr>)}</tbody></table></div>}
    </details>
    <details>
      <summary>Advanced builder settings</summary>
      <p className="settings-muted">The defaults suit most apps. Changes apply to your next message. Less background information sent with each message can speed things up; the builder reads extra files when it needs them.</p>
      <div className="services-grid">
        <label className="services-toggle"><input type="checkbox" checked={controls.fastMode} onChange={event => setControls(setReliabilityControls(projectId, { fastMode: event.target.checked }))} /> Fast mode · less background info, less double-checking</label>
        <label>How much the builder can write per try<input type="number" min={300} max={MAX_OUTPUT_TOKENS} value={controls.maxTokens} onChange={event => setControls(setReliabilityControls(projectId, { maxTokens: Number(event.target.value) }))} /></label>
        <label>Maximum work rounds<input type="number" min={1} max={10} value={controls.maxSteps} onChange={event => setControls(setReliabilityControls(projectId, { maxSteps: Number(event.target.value) }))} /></label>
        <label>Give up after (seconds)<input type="number" min={15} max={AI_TIMEOUT_MS / 1000} step={15} value={controls.timeoutMs / 1000} onChange={event => setControls(setReliabilityControls(projectId, { timeoutMs: Number(event.target.value) * 1000 }))} /></label>
      </div>
      <p className="settings-muted">Very small writing limits can cut files short. A shorter timeout stops work sooner; it does not make the builder faster.</p>
      <button type="button" className="button-secondary" onClick={() => { setControls(setReliabilityControls(projectId, DEFAULT_RELIABILITY)); setNotice('Recommended builder limits restored.'); }}>Restore recommended limits</button>
    </details>
    <details>
      <summary>Builder timing</summary>
      <p className="settings-muted">Time from pressing Send, measured in this browser. A finished reply is separate from a checked, working app. Missing stages are not estimated.</p>
      {!timings.length ? <p>Send a message in chat to record its timing.</p> : <div className="settings-table-scroll" role="region" aria-label="Builder timing" tabIndex={0}><table><thead><tr><th>Started</th><th>Message sent</th><th>Server ready</th><th>Builder started</th><th>First change</th><th>Preview ready</th><th>Total</th><th>Result</th></tr></thead><tbody>{timings.map(row => <tr key={row.id}><td>{new Date(row.startedAt).toLocaleString()}</td><td>{seconds(row.elapsed.sent)}</td><td>{seconds(row.elapsed.accepted)}</td><td>{seconds(row.elapsed.model)}</td><td>{seconds(row.elapsed.activity)}</td><td>{seconds(row.elapsed.preview)}</td><td>{seconds(row.durationMs)}</td><td>{row.outcome || 'In progress'}</td></tr>)}</tbody></table></div>}
    </details>
    <details>
      <summary>Your activity</summary>
      <p className="settings-muted">Actions requested in this browser. Whether publishing or checks succeeded is shown in Publish; these counts don’t confirm success.</p>
      <div className="settings-table-scroll" role="region" aria-label="Your activity" tabIndex={0}><table><thead><tr><th>Day</th><th>Messages</th><th>Publishes requested</th><th>Checks requested</th></tr></thead><tbody>{usageRows.map(row => <tr key={row.day}><td>{row.day}</td><td>{row.prompts}</td><td>{row.publishes}</td><td>{row.verifications}</td></tr>)}</tbody></table></div>
    </details>
    <p>Need help? <a href="mailto:support@brainhalf.com">Contact BrainHalf support</a>.</p>
  </section>;
}
