import { useCallback, useEffect, useState } from 'react';
import type { ProjectEnvironment, ProjectUpload } from '../runtime/types';
import { runtimeBase, runtimeRequest } from '../lib/project-runtime-client';
import { authFetch } from '../lib/auth-client';

export default function ProjectFiles({ projectId, environment, onChanged }: { projectId: string; environment: ProjectEnvironment; onChanged: () => void }) {
  const [files, setFiles] = useState<ProjectUpload[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [deleting, setDeleting] = useState<ProjectUpload | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setFiles([]); setDeleting(null);
    void runtimeRequest<{ files: ProjectUpload[] }>(projectId, '/uploads', environment, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setFiles(result.files); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Files could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, environment, version]);
  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true); setError('');
    try {
      await runtimeRequest(projectId, `/uploads/${encodeURIComponent(deleting.id)}`, environment, { method: 'DELETE' });
      setDeleting(null); refresh(); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'File deletion failed.'); }
    finally { setBusy(false); }
  };
  const download = async (file: ProjectUpload) => {
    setBusy(true); setError('');
    try {
      const response = await authFetch(`${runtimeBase(projectId)}/uploads/${encodeURIComponent(file.id)}?environment=${environment}`);
      if (!response.ok) throw new Error('Download failed. Refresh the file list and try again.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Download failed.'); }
    finally { setBusy(false); }
  };
  return <div className="settings-files">
    <p className="settings-muted">Files uploaded by users of this app. Development and production files stay separate. Each file is private to its uploader and the project owner.</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Loading files…</p> : files.length ? <ul aria-label="Uploaded project files">{files.map(file => <li key={file.id}>
      <span><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(1)} KB · {new Date(file.createdAt).toLocaleDateString()}</small></span>
      <div className="settings-actions"><button disabled={busy} onClick={() => void download(file)} aria-label={`Download ${file.name}`}>Download</button><button disabled={busy} onClick={() => setDeleting(file)} aria-label={`Delete ${file.name}`}>Delete</button></div>
    </li>)}</ul> : <p>No files have been uploaded in this environment.</p>}
    {deleting && <div className="settings-notice" role="group" aria-label="Confirm file deletion"><p>Delete <strong>{deleting.name}</strong>? App links to this file will stop working.</p><div className="settings-actions"><button disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete file permanently'}</button><button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></div></div>}
    <button disabled={busy || loading} onClick={refresh}>Refresh files</button>
  </div>;
}
