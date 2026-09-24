import { useEffect, useRef, useState } from 'react';
import { Cable, FileText, Sparkles, Trash2, X } from 'lucide-react';
import { builderRequest } from '../lib/builder-client';
import type { BuilderConfiguration, BuilderMcpServer } from '../lib/builder-tools';
import type { AttachmentSummary } from '../lib/builder-attachments';
import { useModalFocus } from '../lib/use-modal-focus';
import './AgentTools.css';

export default function AgentTools({ projectId, onClose, onAttach, initialTab = 'connections' }: { projectId: string; onClose: () => void; onAttach: (file: AttachmentSummary) => void; initialTab?: 'connections' | 'skills' | 'files' }) {
  const [tab, setTab] = useState<'connections' | 'skills' | 'files'>(initialTab);
  const [config, setConfig] = useState<BuilderConfiguration>({ servers: [], skills: [] });
  const [files, setFiles] = useState<AttachmentSummary[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [token, setToken] = useState('');
  const [skillName, setSkillName] = useState(''); const [instructions, setInstructions] = useState('');
  const alive = useRef(true);
  const pendingAction = useRef(false);
  const modal = useModalFocus(true, onClose);
  const refresh = async () => {
    const [next, uploads] = await Promise.all([
      builderRequest<BuilderConfiguration>(projectId, '/configuration'),
      builderRequest<{ attachments: AttachmentSummary[] }>(projectId, '/attachments'),
    ]);
    if (alive.current) { setConfig(next); setFiles(uploads.attachments); }
  };
  useEffect(() => {
    alive.current = true;
    void refresh().catch(cause => { if (alive.current) setError(cause.message); }).finally(() => { if (alive.current) setBusy(false); });
    return () => { alive.current = false; };
  }, [projectId]);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const perform = async (action: () => Promise<void>, optimisticConfig?: BuilderConfiguration) => {
    if (busy || pendingAction.current) return;
    pendingAction.current = true;
    const previous = config;
    let saved = false;
    if (optimisticConfig) setConfig(optimisticConfig);
    setBusy(true); setError('');
    try { await action(); saved = true; await refresh(); }
    catch (cause) {
      if (alive.current) {
        if (optimisticConfig && !saved) setConfig(previous);
        setError(cause instanceof Error ? cause.message : 'Please try again.');
      }
    }
    finally { pendingAction.current = false; if (alive.current) setBusy(false); }
  };
  const updateServer = (server: BuilderMcpServer, tools: string[], enabled: boolean) => perform(async () => {
    await builderRequest(projectId, `/servers/${server.id}`, { method: 'PATCH', body: JSON.stringify({ allowedTools: tools, enabled }) });
  }, { ...config, servers: config.servers.map(item => item.id === server.id ? { ...item, allowedTools: tools, enabled } : item) });
  const updateSkill = (id: string, enabled: boolean) => perform(async () => {
    await builderRequest(projectId, `/skills/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
  }, { ...config, skills: config.skills.map(item => item.id === id ? { ...item, enabled } : item) });
  return <div className="agent-tools-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="agent-tools" role="dialog" aria-modal="true" aria-labelledby="agent-tools-title" ref={modal} tabIndex={-1}>
      <header><div><span className="agent-tools-eyebrow">FOR THIS PROJECT</span><h2 id="agent-tools-title">Agent tools</h2><p>Connect services, add instructions, and reuse your uploads.</p></div><button className="icon-btn" onClick={onClose} aria-label="Close agent tools"><X size={20} /></button></header>
      <nav aria-label="Agent tool categories">{(['connections', 'skills', 'files'] as const).map(value => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'connections' ? <Cable size={16} /> : value === 'skills' ? <Sparkles size={16} /> : <FileText size={16} />}{value === 'connections' ? 'MCP connections' : value === 'skills' ? 'Skills' : 'Uploads'}</button>)}</nav>
      <div className="agent-tools-content" aria-busy={busy}>
        {error && <div className="agent-tools-error" role="alert">{error}<button onClick={() => void perform(async () => {})} disabled={busy}>Retry</button></div>}
        {busy && <p role="status">Working…</p>}
        {tab === 'connections' && <>
          <p>Connect a remote MCP server, then choose the tools your agent may use. Enabled tools can access or change data in the connected service.</p>
          {config.servers.map(server => <section className="agent-tool-card" key={server.id}>
            <div className="agent-tool-row"><h3>{server.name}</h3><button aria-label={`Remove ${server.name}`} disabled={busy} onClick={() => void perform(async () => { await builderRequest(projectId, `/servers/${server.id}`, { method: 'DELETE' }); })}><Trash2 size={15} /></button></div>
            <p className="agent-tool-endpoint">{server.url}</p>
            <label className="agent-tool-check"><input type="checkbox" checked={server.enabled} disabled={busy || !server.allowedTools.length} onChange={event => void updateServer(server, server.allowedTools, event.target.checked)} />Enabled for the agent{server.hasToken && <small>Token stored securely</small>}</label>
            <details><summary>{server.allowedTools.length} of {server.tools.length} tools selected</summary>
              {server.tools.length === 0 && <p>This server exposes no tools.</p>}
              {server.tools.map(tool => <label className="agent-tool-check agent-tool-permission" key={tool.name}><input type="checkbox" checked={server.allowedTools.includes(tool.name)} disabled={busy} onChange={event => {
                const tools = event.target.checked ? [...server.allowedTools, tool.name] : server.allowedTools.filter(name => name !== tool.name);
                void updateServer(server, tools, server.enabled && tools.length > 0);
              }} /><span><strong>{tool.name}</strong><small>{tool.readOnly ? 'Server reports read-only' : 'May change service data'}</small><small>{tool.description}</small></span></label>)}
            </details>
          </section>)}
          <form onSubmit={event => { event.preventDefault(); void perform(async () => { await builderRequest(projectId, '/servers', { method: 'POST', body: JSON.stringify({ name, url, token }) }); if (alive.current) { setName(''); setUrl(''); setToken(''); } }); }}>
            <h3>Add an MCP connection</h3>
            <label>Name<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="My service" /></label>
            <label>Server URL<input required type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" /></label>
            <label>Bearer token <small>optional</small><input type="password" autoComplete="off" maxLength={4096} value={token} onChange={event => setToken(event.target.value)} /></label>
            <small>HTTPS Streamable HTTP endpoints. OAuth-only and local stdio connections are not supported.</small>
            <button className="agent-tools-primary" disabled={busy}>Connect and discover tools</button>
          </form>
        </>}
        {tab === 'skills' && <>
          <p>Reusable instructions for how your agent builds this project. Enabled skills apply to your next message.</p>
          {config.skills.map(skill => <section className="agent-tool-card" key={skill.id}>
            <div className="agent-tool-row"><label className="agent-tool-check"><input type="checkbox" checked={skill.enabled} disabled={busy} onChange={event => void updateSkill(skill.id, event.target.checked)} /><strong>{skill.name}</strong></label><button disabled={busy} aria-label={`Remove ${skill.name}`} onClick={() => void perform(async () => { await builderRequest(projectId, `/skills/${skill.id}`, { method: 'DELETE' }); })}><Trash2 size={15} /></button></div>
            <details><summary>Read instructions</summary><pre>{skill.instructions}</pre></details>
          </section>)}
          <form onSubmit={event => { event.preventDefault(); void perform(async () => { await builderRequest(projectId, '/skills', { method: 'POST', body: JSON.stringify({ name: skillName, instructions }) }); if (alive.current) { setSkillName(''); setInstructions(''); } }); }}>
            <h3>Add a skill</h3><label>Name<input required maxLength={80} value={skillName} onChange={event => setSkillName(event.target.value)} placeholder="Accessibility guidelines" /></label>
            <label>Instructions<textarea required maxLength={12000} rows={6} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Describe the conventions and steps the agent should follow…" /></label>
            <label className="agent-skill-import">Import Markdown or text<input type="file" accept=".md,.txt,text/plain,text/markdown" disabled={busy} onChange={async event => {
              const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
              try { if (file.size > 48000) throw new Error('Skill files must be 12,000 characters or fewer.'); const text = await file.text(); if (text.length > 12000 || text.includes('\0')) throw new Error('Use a text skill with up to 12,000 characters.'); if (alive.current) { setInstructions(text); setSkillName(file.name.replace(/\.(md|txt)$/i, '').slice(0, 80)); } } catch (cause) { if (alive.current) setError((cause as Error).message); }
            }} /></label>
            <button className="agent-tools-primary" disabled={busy}>Save skill</button>
          </form>
        </>}
        {tab === 'files' && <>
          <p>Uploads stay private to this project. Files become part of the exported app only when you ask the agent to use them.</p>
          {!files.length && !busy && <div className="agent-tool-empty"><FileText size={26} /><h3>Your files, ready for the agent</h3><p>Attach images, PDFs, Word documents, Markdown or text using the + button in chat.</p></div>}
          {files.map(file => <div className="agent-tool-card agent-tool-row" key={file.id}><span><strong>{file.name}</strong><small>{Math.ceil(file.size / 1024)} KB{file.note && ` · ${file.note}`}</small></span><button disabled={busy} onClick={() => { onAttach(file); onClose(); }}>Attach</button><button disabled={busy} aria-label={`Delete ${file.name}`} onClick={() => void perform(async () => { await builderRequest(projectId, `/attachments/${file.id}`, { method: 'DELETE' }); })}><Trash2 size={15} /></button></div>)}
        </>}
      </div>
    </div>
  </div>;
}
