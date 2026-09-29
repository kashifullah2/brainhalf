import { describe, it, expect } from 'vitest';
import { publishProgressView } from '../components/PublishDialog';

describe('publishProgressView', () => {
  it('marks no stage as current while the job is queued', () => {
    const view = publishProgressView({ status: 'queued', message: 'Queued', publishStage: 'build' });
    expect(view.currentStage).toBeNull();
    expect(view.waitingInQueue).toBe(true);
    expect(view.heading).toContain('Queued');
    expect(view.heading).toContain('waiting for a build slot');
  });

  it('marks the real stage as current once the job is running', () => {
    const view = publishProgressView({ status: 'running', message: 'Running checks…', publishStage: 'verify' });
    expect(view.currentStage).toBe(1);
    expect(view.waitingInQueue).toBe(false);
    expect(view.heading).toBe('Running checks…');
  });

  it('falls back to a generic heading when a running job has no message', () => {
    const view = publishProgressView({ status: 'running', message: '', publishStage: 'build' });
    expect(view.heading).toBe('Publishing your app…');
    expect(view.currentStage).toBe(0);
  });

  it('never reports "Queued" and an active stage at the same time', () => {
    const view = publishProgressView({ status: 'queued', message: '', publishStage: 'deploy' });
    // Even if the server attached a stage to the queued job, the UI must not
    // present it as in-progress — that was the reported contradiction.
    expect(view.currentStage).toBeNull();
  });
});
