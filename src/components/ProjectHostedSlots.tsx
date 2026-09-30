import { useCallback, useEffect, useState } from 'react';
import { listHostedSlots, releaseHostedSlot, type HostedSlot } from '../lib/project-runtime-client';

/** Hosted-slot accounting for the signed-in account. Slots can outlive their
 *  projects (old clients deleted projects locally without server cleanup), and
 *  orphaned slots block new builds and publishes — this panel releases them. */
export default function ProjectHostedSlots({ projectId }: { projectId: string }) {
  const [slots, setSlots] = useState<HostedSlot[] | null>(null);
  const [error, setError] = useState('');
  const [releasing, setReleasing] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setSlots(await listHostedSlots(projectId)); setError(''); }
    catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not load hosted apps.'); }
  }, [projectId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const release = async (alias: string, live: boolean) => {
    if (releasing) return;
    if (live && !window.confirm('This slot belongs to a live project. Releasing it will take the app offline until its next publish. Release it anyway?')) return;
    setReleasing(alias); setError('');
    try {
      await releaseHostedSlot(projectId, alias, live);
      setSlots(current => (current || []).filter(slot => slot.alias !== alias));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Release failed. Try again.');
    } finally {
      setReleasing(null);
    }
  };

  return <section className="settings-card">
    <h3>Hosted app slots</h3>
    <p className="settings-muted">
      Every app that has been built or published holds one hosting slot on your account. Slots from deleted or
      unused projects can stay behind and block new builds — release the unused ones here. Releasing a slot that
      belongs to a live app takes that app offline until its next publish, so those ask for confirmation first.
    </p>
    {error && <p role="alert" className="settings-error">{error}</p>}
    {slots === null && !error && <p className="settings-muted">Loading hosted apps…</p>}
    {slots !== null && slots.length === 0 && <p className="settings-muted">No hosted slots on your account.</p>}
    {slots !== null && slots.length > 0 && (
      <ul className="hosted-slot-list">
        {slots.map(slot => (
          <li key={slot.alias}>
            <span className="hosted-slot-id" title={`Slot ${slot.alias}`}>Project {slot.projectId}</span>
            {slot.live === false
              ? <span className="hosted-slot-orphan">Unused</span>
              : <span className="hosted-slot-live">Live</span>}
            {slot.projectId === projectId
              ? <span className="hosted-slot-current">This project</span>
              : <button type="button" disabled={releasing !== null} onClick={() => void release(slot.alias, slot.live !== false)}>
                  {releasing === slot.alias ? 'Releasing…' : 'Release slot'}
                </button>}
          </li>
        ))}
      </ul>
    )}
    <p className="settings-muted">
      <button type="button" className="hosted-slot-refresh" onClick={() => void load()} disabled={releasing !== null}>Refresh list</button>
    </p>
  </section>;
}
