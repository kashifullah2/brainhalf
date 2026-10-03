import { describe, expect, it } from 'vitest';
import { toResumableJobInfo } from '../components/ChatPanel';

describe('toResumableJobInfo', () => {
  it('normalizes a well-formed resumable job', () => {
    expect(toResumableJobInfo({
      id: 'job-1', completedFiles: 10, error: 'dropped', resumesLeft: 2,
    })).toEqual({ id: 'job-1', completedFiles: 10, error: 'dropped', resumesLeft: 2, autoResume: false });
  });

  it('coerces numeric strings and defaults missing fields', () => {
    expect(toResumableJobInfo({ id: 'job-1', completedFiles: '7' })).toEqual({
      id: 'job-1', completedFiles: 7, error: null, resumesLeft: 0, autoResume: false,
    });
  });

  it('passes through the autoResume flag for connection-drop interruptions', () => {
    expect(toResumableJobInfo({
      id: 'job-1', completedFiles: 3, error: 'The connection dropped while the builder was working.', resumesLeft: 2, autoResume: true,
    })).toEqual({
      id: 'job-1', completedFiles: 3, error: 'The connection dropped while the builder was working.', resumesLeft: 2, autoResume: true,
    });
    // Non-boolean autoResume is treated as false.
    expect(toResumableJobInfo({ id: 'job-1', autoResume: 'yes' })?.autoResume).toBe(false);
  });

  it('rejects malformed payloads so a broken Resume button can never render', () => {
    expect(toResumableJobInfo(null)).toBeNull();
    expect(toResumableJobInfo(undefined)).toBeNull();
    expect(toResumableJobInfo('job-1')).toBeNull();
    expect(toResumableJobInfo({})).toBeNull();
    expect(toResumableJobInfo({ id: '' })).toBeNull();
    expect(toResumableJobInfo({ id: 42 })).toBeNull();
    expect(toResumableJobInfo({ id: 'job-1', error: 42, completedFiles: NaN })).toEqual({
      id: 'job-1', completedFiles: 0, error: null, resumesLeft: 0, autoResume: false,
    });
  });
});
