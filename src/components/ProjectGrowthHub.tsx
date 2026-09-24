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
      {!versions.length ? <p>Your requests will appear here after you send a message.</p> : <div className="settings-table-scroll"><table><thead><tr><th>Saved</th><th>Request</th><th>Actions</th></tr></thead><tbody>{versions.slice(0, 20).map(version => <tr key={version.id}><td>{new Date(version.createdAt).toLocaleString()}</td><td>{version.prompt.slice(0, 160)}</td><td><button onClick={() => { appEvents.emit('insert-prompt-draft', { prompt: version.prompt }); setNotice('Request added to your chat draft.'); }}>Reuse</button><button onClick={() => setVersions(removePromptVersion(projectId, version.id))}>Delete</button></td></tr>)}</tbody></table></div>}
    </details>
    <details>
      <summary>Advanced generation settings</summary>
      <p className="settings-muted">The defaults suit most apps. Changes apply to your next message. Focused context sends less older conversation and source; the builder can read additional files as needed.</p>
      <div className="services-grid">
        <label className="services-toggle"><input type="checkbox" checked={controls.fastMode} onChange={event => setControls(setReliabilityControls(projectId, { fastMode: event.target.checked }))} /> Fast mode · focused context and less reasoning</label>
        <label>Output limit per model call<input type="number" min={300} max={MAX_OUTPUT_TOKENS} value={controls.maxTokens} onChange={event => setControls(setReliabilityControls(projectId, { maxTokens: Number(event.target.value) }))} /></label>
        <label>Maximum tool rounds<input type="number" min={1} max={10} value={controls.maxSteps} onChange={event => setControls(setReliabilityControls(projectId, { maxSteps: Number(event.target.value) }))} /></label>
        <label>Generation timeout (seconds)<input type="number" min={15} max={AI_TIMEOUT_MS / 1000} step={15} value={controls.timeoutMs / 1000} onChange={event => setControls(setReliabilityControls(projectId, { timeoutMs: Number(event.target.value) * 1000 }))} /></label>
      </div>
      <p className="settings-muted">Very small output limits can cut files short. A shorter timeout stops work sooner; it does not make the model faster.</p>
      <button onClick={() => { setControls(setReliabilityControls(projectId, DEFAULT_RELIABILITY)); setNotice('Recommended generation limits restored.'); }}>Restore recommended limits</button>
    </details>
    <details>
      <summary>Generation timing</summary>
      <p className="settings-muted">Elapsed time from pressing Send, measured in this browser. Builder activity includes text or tool work. A completed response is separate from a verified app. Missing stages are not estimated.</p>
      {!timings.length ? <p>Send a request to record its timing.</p> : <div className="settings-table-scroll"><table><thead><tr><th>Started</th><th>Sent</th><th>Server ready</th><th>Model called</th><th>First activity</th><th>Preview ready</th><th>Total</th><th>Result</th></tr></thead><tbody>{timings.map(row => <tr key={row.id}><td>{new Date(row.startedAt).toLocaleString()}</td><td>{seconds(row.elapsed.sent)}</td><td>{seconds(row.elapsed.accepted)}</td><td>{seconds(row.elapsed.model)}</td><td>{seconds(row.elapsed.activity)}</td><td>{seconds(row.elapsed.preview)}</td><td>{seconds(row.durationMs)}</td><td>{row.outcome || 'In progress'}</td></tr>)}</tbody></table></div>}
    </details>
    <details>
      <summary>Recent activity</summary>
      <p className="settings-muted">Actions requested in this browser. Publication status is shown in Publish; these counts do not confirm success.</p>
      <div className="settings-table-scroll"><table><thead><tr><th>Day (UTC)</th><th>Requests</th><th>Publishes requested</th><th>Checks requested</th></tr></thead><tbody>{usageRows.map(row => <tr key={row.day}><td>{row.day}</td><td>{row.prompts}</td><td>{row.publishes}</td><td>{row.verifications}</td></tr>)}</tbody></table></div>
    </details>
    <p>Need help? <a href="mailto:support@brainhalf.com">Contact BrainHalf support</a>.</p>
  </section>;
}
