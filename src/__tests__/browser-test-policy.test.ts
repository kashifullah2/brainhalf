import { describe, expect, it } from 'vitest';
import { LOCAL_BROWSER_SPECS, requireLiveTestOptIn } from '../../tests/browser-policy';
import manifest from '../../package.json';

describe('Browser test safety policy', () => {
  it('keeps the default browser suite restricted to reviewed local fixtures', () => {
    expect(LOCAL_BROWSER_SPECS).toContain('**/project-console.spec.ts');
    expect(LOCAL_BROWSER_SPECS).toContain('**/workspace-clarity.spec.ts');
    expect(LOCAL_BROWSER_SPECS).toContain('**/agent-tools.spec.ts');
    expect(LOCAL_BROWSER_SPECS).toContain('**/recent-projects.spec.ts');
    expect(LOCAL_BROWSER_SPECS).toContain('**/managed-runtime.spec.ts');
    expect(LOCAL_BROWSER_SPECS).toContain('**/critical-remediation.spec.ts');
    expect(LOCAL_BROWSER_SPECS).toContain('**/ai-ide-e2e-001-lifecycle.spec.ts');
    expect(LOCAL_BROWSER_SPECS).not.toContain('**/*.spec.ts');
    expect(LOCAL_BROWSER_SPECS).not.toContain('**/chaos-concurrent-mutation.spec.ts');
  });

  it.each([undefined, '', '0', 'true', 'yes'])('rejects absent or ambiguous live permission: %s', value => {
    expect(() => requireLiveTestOptIn({ BRAINHALF_ALLOW_LIVE_TESTS: value })).toThrow('mutate production');
  });

  it('requires explicit opt-in for every live npm command', () => {
    expect(() => requireLiveTestOptIn({ BRAINHALF_ALLOW_LIVE_TESTS: '1' })).not.toThrow();
    for (const script of [manifest.scripts['test:e2e:live'], manifest.scripts['test:all-models'], manifest.scripts.benchmark]) {
      expect(script).toContain('--config playwright.live.config.ts');
    }
  });
});
