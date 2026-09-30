import { describe, expect, it } from 'vitest';
import { toResumableJobInfo } from '../components/ChatPanel';

describe('toResumableJobInfo', () => {
  it('normalizes a well-formed resumable job', () => {
    expect(toResumableJobInfo({
      id: 'job-1', completedFiles: 10, error: 'dropped', resumesLeft: 2,
    })).toEqual({ id: 'job-1', completedFiles: 10, error: 'dropped', resumesLeft: 2 });
  });

  it('coerces numeric strings and defaults missing fields', () => {
    expect(toResumableJobInfo({ id: 'job-1', completedFiles: '7' })).toEqual({
      id: 'job-1', completedFiles: 7, error: null, resumesLeft: 0,
    });
  });

  it('rejects malformed payloads so a broken Resume button can never render', () => {
    expect(toResumableJobInfo(null)).toBeNull();
    expect(toResumableJobInfo(undefined)).toBeNull();
    expect(toResumableJobInfo('job-1')).toBeNull();
    expect(toResumableJobInfo({})).toBeNull();
    expect(toResumableJobInfo({ id: '' })).toBeNull();
    expect(toResumableJobInfo({ id: 42 })).toBeNull();
    expect(toResumableJobInfo({ id: 'job-1', error: 42, completedFiles: NaN })).toEqual({
      id: 'job-1', completedFiles: 0, error: null, resumesLeft: 0,
    });
  });
});
