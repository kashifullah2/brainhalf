import { describe, expect, it } from 'vitest';
import { publishStageIndex, stageKeys } from '../components/PublicationControls';

describe('publishStageIndex', () => {
  it('does not mark any stage active while the job is queued (M6)', () => {
    // A queued job has not started building; the stepper must not show
    // "Build app" as the in-progress step.
    expect(publishStageIndex('queued', undefined)).toBe(-1);
    expect(publishStageIndex('queued', 'build')).toBe(-1);
  });

  it('marks the reported stage active while running', () => {
    expect(publishStageIndex('running', 'build')).toBe(0);
    expect(publishStageIndex('running', 'verify')).toBe(1);
    expect(publishStageIndex('running', 'deploy')).toBe(3);
    expect(publishStageIndex('running', undefined)).toBe(0);
  });

  it('marks the final stage when the job passed', () => {
    expect(publishStageIndex('passed', undefined)).toBe(stageKeys.length - 1);
  });

  it('keeps the last known stage for other statuses', () => {
    expect(publishStageIndex('stopping', 'services')).toBe(2);
    expect(publishStageIndex('failed', 'verify')).toBe(1);
  });
});
