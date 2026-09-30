import { useCallback, useEffect, useState } from 'react';
import { listHostedSlots, releaseHostedSlot, type HostedSlot } from '../lib/project-runtime-client';
import { getProjects } from '../lib/project-store';
import { HOSTED_APP_LIMIT } from '../lib/hosted-limit';

/** App-space accounting for the signed-in account. Spaces can outlive their
 *  projects (old clients deleted projects locally without server cleanup), and
 *  leftover spaces block new builds and publishes — this panel frees them.
 *  Copy is written for non-technical users: "spaces" and "remove", never
 *  "slots" or "release". */
export default function ProjectHostedSlots({ projectId }: { projectId: string }) {
  const [slots, setSlots] = useState<HostedSlot[] | null>(null);
  const [error, setError] = useState('');
  const [releasing, setReleasing] = useState<string | null>(null);
  // Show app names instead of raw project ids where the project still exists.
  const [names, setNames] = useState<Record<string, string>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await listHostedSlots(projectId);
      if (signal?.aborted) return;
      setSlots(next); setError('');
      try {
        const byId: Record<string, string> = {};
        for (const project of getProjects()) byId[project.id] = project.name || project.id;
        setNames(byId);
      } catch { /* names are a nicety; ids still render */ }
    }
    catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not load your app spaces.'); }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const release = async (alias: string, live: boolean, label: string) => {
    if (releasing) return;
    if (live && !window.confirm(`Removing this space will take “${label}” offline for visitors until you publish it again. Remove it anyway?`)) return;
    setReleasing(alias); setError('');
    try {
      await releaseHostedSlot(projectId, alias, live);
      setSlots(current => (current || []).filter(slot => slot.alias !== alias));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove that space. Try again.');
    } finally {
      setReleasing(null);
    }
  };

  const used = slots?.length ?? 0;
  return <section className="settings-card">
    <h3>Your app spaces</h3>
    <p className="settings-muted">
      {slots === null ? `Your account has ${HOSTED_APP_LIMIT} spaces for running apps.` : `You’re using ${used} of your ${HOSTED_APP_LIMIT} app spaces.`}{' '}
      Every app you build or publish uses one space. Spaces left behind by apps you deleted can linger and block
      new work — remove the ones you don’t need here. Removing the space for a live app takes it offline for
      visitors until you publish it again, so those ask for confirmation first.
    </p>
    {error && <p role="alert" className="settings-error">{error}</p>}
    {slots === null && !error && <p className="settings-muted">Loading your app spaces…</p>}
    {slots !== null && slots.length === 0 && <p className="settings-muted">Your account isn’t using any app spaces yet.</p>}
    {slots !== null && slots.length > 0 && (
      <ul className="hosted-slot-list">
        {slots.map(slot => {
          const label = names[slot.projectId] || slot.alias;
          return (
            <li key={slot.alias}>
              <span className="hosted-slot-id" title={`Space ${slot.alias}`}>{label}</span>
              {slot.live === false
                ? <span className="hosted-slot-orphan">Not in use</span>
                : <span className="hosted-slot-live">Live</span>}
              {slot.projectId === projectId
                ? <span className="hosted-slot-current" title="You can't remove the app you're currently working on. Open a different project to remove this one.">This project — can't remove while open</span>
                : <button type="button" disabled={releasing !== null} onClick={() => void release(slot.alias, slot.live !== false, label)}>
                    {releasing === slot.alias ? 'Removing…' : 'Remove'}
                  </button>}
            </li>
          );
        })}
      </ul>
    )}
    <p className="settings-muted">
      <button type="button" className="hosted-slot-refresh" onClick={() => void load()} disabled={releasing !== null}>Refresh list</button>
    </p>
  </section>;
}
