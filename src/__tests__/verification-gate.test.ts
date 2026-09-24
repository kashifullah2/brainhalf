import { describe, expect, it } from 'vitest';
import manifest from '../../package.json';

describe('Deployment verification gate', () => {
  it('runs the full verification chain before deploying', () => {
    expect(manifest.scripts['verify:release']).toBe('node scripts/verify-release.mjs');
    expect(manifest.scripts.verify.split(' && ')).toEqual([
      'npm run typecheck', 'npm test', 'npm run lint', 'npm run build',
    ]);
    expect(manifest.scripts.deploy).toBe('node scripts/deploy.mjs');
    expect(manifest.scripts.test).toContain('node --test scripts/__tests__/*.test.mjs');
    expect(manifest.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
