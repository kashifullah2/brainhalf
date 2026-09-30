import { describe, expect, it } from 'vitest';
import { buildRepairMessage, extractBuildErrors } from '../lib/automatic-build-fix';

describe('extractBuildErrors', () => {
  it('extracts TypeScript errors', () => {
    const log = 'src/App.tsx(5,10): error TS2322: Type string is not assignable to type number';
    expect(extractBuildErrors(log)).toContain('error TS2322');
  });

  it('extracts ERESOLVE dependency conflicts', () => {
    const log = [
      'npm ERR! code ERESOLVE',
      'npm ERR! ERESOLVE could not resolve',
      'npm ERR! While resolving: my-app@1.0.0',
    ].join('\n');
    const result = extractBuildErrors(log);
    expect(result).toContain('ERESOLVE');
  });

  it('extracts ETARGET version mismatches', () => {
    const log = 'npm ERR! code ETARGET\nnpm ERR! notarget No matching version found for left-pad@99.99.99';
    expect(extractBuildErrors(log)).toContain('ETARGET');
  });

  it('extracts npm ERR! install failures', () => {
    const log = 'npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path /tmp/package.json';
    expect(extractBuildErrors(log)).toContain('npm ERR!');
  });

  it('extracts network failures during install', () => {
    const log = 'npm ERR! code EAI_AGAIN\nnpm ERR! syscall getaddrinfo\nnpm ERR! errno EAI_AGAIN';
    const result = extractBuildErrors(log);
    expect(result).toContain('EAI_AGAIN');
  });

  it('returns empty string when no errors found', () => {
    expect(extractBuildErrors('Build succeeded\nAll good')).toBe('');
  });
});

describe('buildRepairMessage', () => {
  it('mentions dependency errors for ERESOLVE', () => {
    const msg = buildRepairMessage('build', 'npm ERR! code ERESOLVE');
    expect(msg).toContain('dependency or install errors');
    expect(msg).toContain('package.json');
  });

  it('mentions TypeScript errors for TS errors', () => {
    const msg = buildRepairMessage('build', 'error TS2322: Type mismatch');
    expect(msg).toContain('TypeScript or bundler errors');
  });
});
