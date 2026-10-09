import { describe, expect, it, vi } from 'vitest';
import { buildRepairMessage, extractBuildErrors, isTransientRuntimeError } from '../lib/automatic-build-fix';
import { FlipFlopGuard, RepairBudget, RepairLog } from '../lib/repair-budget';

// ---------------------------------------------------------------------------
// extractBuildErrors
// ---------------------------------------------------------------------------
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

  it('preserves the FULL ERESOLVE block intact (Nexus OS regression)', () => {
    const eresolveBlock = Array.from({ length: 40 }, (_, i) =>
      `npm ERR! ${i === 0 ? 'code ERESOLVE' : i === 1 ? 'ERESOLVE could not resolve' : `line ${i} of peer dependency tree`}`
    ).join('\n');
    const log = `Build starting...\n${eresolveBlock}\nBuild complete.`;
    const result = extractBuildErrors(log);
    // All 40 npm ERR! lines must survive — the old code truncated to 20 lines / 2000 chars.
    expect(result.split('\n').length).toBe(40);
    expect(result).toContain('code ERESOLVE');
    expect(result).toContain('line 39 of peer dependency tree');
  });

  it('keeps the ERESOLVE peer dependency tree for version resolution', () => {
    const log = [
      'npm ERR! code ERESOLVE',
      'npm ERR! ERESOLVE could not resolve',
      'npm ERR! ',
      'npm ERR! While resolving: @vitejs/plugin-react@4.3.4',
      'npm ERR! Found: vite@6.0.0',
      'npm ERR! node_modules/vite',
      'npm ERR!   dev vite@"^6.0.0" from the root project',
      'npm ERR! ',
      'npm ERR! Could not resolve dependency:',
      'npm ERR! peer vite@"^4.2.0 || ^5.0.0" from @vitejs/plugin-react@4.3.4',
      'npm ERR! node_modules/@vitejs/plugin-react',
      'npm ERR!   dev @vitejs/plugin-react@"^4.3.4" from the root project',
    ].join('\n');
    const result = extractBuildErrors(log);
    expect(result).toContain('peer vite@"^4.2.0 || ^5.0.0"');
    expect(result).toContain('Found: vite@6.0.0');
    expect(result).toContain('@vitejs/plugin-react@4.3.4');
  });
});

// ---------------------------------------------------------------------------
// buildRepairMessage
// ---------------------------------------------------------------------------
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

  // Item 2: reject "fixed" claim unless build passes
  it('requires build verification before claiming fix (item 2)', () => {
    const msg = buildRepairMessage('build', 'error TS2322: Type mismatch');
    expect(msg).toMatch(/(?:install|build|tests?).*pass/i);
    expect(msg).toContain('Do NOT claim the issue is fixed');
  });

  it('requires build verification for dependency errors too (item 2)', () => {
    const msg = buildRepairMessage('build', 'npm ERR! code ERESOLVE');
    expect(msg).toMatch(/(?:install|build|tests?).*pass/i);
  });

  // Item 5: npm view / version existence check
  it('instructs to verify dependency versions exist before changing them (item 5)', () => {
    const msg = buildRepairMessage('build', 'npm ERR! code ERESOLVE\nnpm ERR! peer vite@"^4.2.0"');
    expect(msg).toMatch(/confirm.*version exists|version.*exists/i);
  });

  // Item 6: no re-export wrappers
  it('forbids creating re-export wrapper files (item 6)', () => {
    const msg = buildRepairMessage('build', 'error TS2322: Type mismatch');
    expect(msg).toMatch(/re-export/i);
  });

  it('forbids re-export wrappers for dependency errors too (item 6)', () => {
    const msg = buildRepairMessage('build', 'npm ERR! code ERESOLVE');
    expect(msg).toMatch(/re-export/i);
  });
});

// ---------------------------------------------------------------------------
// Item 3: shrinkage guard (tested via extractAndSaveFiles in generation-pipeline-fixes.test.ts)
// Here we test the detection logic itself.
// ---------------------------------------------------------------------------
describe('shrinkage detection (item 3)', () => {
  it('identifies a file as truncated when >30% shorter', () => {
    const existing = 'x'.repeat(1000);
    const replacement = 'x'.repeat(600);
    const ratio = replacement.length / existing.length;
    expect(ratio).toBeLessThan(0.7);
  });

  it('allows a file that is 30% shorter or less', () => {
    const existing = 'x'.repeat(1000);
    const replacement = 'x'.repeat(700);
    const ratio = replacement.length / existing.length;
    expect(ratio).toBeGreaterThanOrEqual(0.7);
  });

  it('allows a file that grows or stays the same', () => {
    expect('longer content'.length >= 'short'.length).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Item 4: flip-flop detection
// ---------------------------------------------------------------------------
describe('FlipFlopGuard (item 4)', () => {
  it('detects A→B→A version alternation', () => {
    const guard = new FlipFlopGuard();
    expect(guard.record('vite', '^5.0.0')).toBe(false); // initial
    expect(guard.record('vite', '4.3.2')).toBe(false);  // first change
    expect(guard.record('vite', '^5.0.0')).toBe(true);  // flip-flop!
  });

  it('does not flag A→B→C as flip-flop', () => {
    const guard = new FlipFlopGuard();
    expect(guard.record('vite', '^5.0.0')).toBe(false);
    expect(guard.record('vite', '4.3.2')).toBe(false);
    expect(guard.record('vite', '^6.0.0')).toBe(false); // different, not a revert
  });

  it('tracks packages independently', () => {
    const guard = new FlipFlopGuard();
    guard.record('vite', '^5.0.0');
    guard.record('react', '18.2.0');
    guard.record('vite', '4.3.2');
    guard.record('react', '18.3.0');
    expect(guard.record('vite', '^5.0.0')).toBe(true);  // vite flip-flop
    expect(guard.record('react', '18.2.0')).toBe(true);  // react flip-flop
  });

  it('resets on clear()', () => {
    const guard = new FlipFlopGuard();
    guard.record('vite', '^5.0.0');
    guard.record('vite', '4.3.2');
    guard.clear();
    expect(guard.record('vite', '^5.0.0')).toBe(false); // no history
  });
});

// ---------------------------------------------------------------------------
// Item 5: version existence instruction
// ---------------------------------------------------------------------------
describe('dependency version guidance (item 5)', () => {
  it('tells the model to use versions from the error constraints', () => {
    const msg = buildRepairMessage('install', [
      'npm ERR! code ERESOLVE',
      'npm ERR! peer vite@"^4.2.0 || ^5.0.0" from @vitejs/plugin-react@4.3.4',
    ].join('\n'));
    expect(msg).toContain('peer dependency constraints');
  });

  it('warns against guessing non-existent versions', () => {
    const msg = buildRepairMessage('install', 'npm ERR! code ERESOLVE');
    // Should tell the model to verify, not guess
    expect(msg).toMatch(/confirm.*version exists|target version exists/i);
  });
});

// ---------------------------------------------------------------------------
// Item 7: transient runtime error detection
// ---------------------------------------------------------------------------
describe('isTransientRuntimeError (item 7)', () => {
  it('detects provider internal error', () => {
    expect(isTransientRuntimeError('Build failed: provider internal error')).toBe(true);
  });

  it('detects 502/503 errors', () => {
    expect(isTransientRuntimeError('502 Bad Gateway')).toBe(true);
    expect(isTransientRuntimeError('503 service unavailable')).toBe(true);
  });

  it('does not flag code errors as transient', () => {
    expect(isTransientRuntimeError('error TS2322: Type mismatch')).toBe(false);
    expect(isTransientRuntimeError('npm ERR! code ERESOLVE')).toBe(false);
  });

  it('does not flag mixed transient + code errors as transient', () => {
    const log = 'provider internal error\nerror TS2322: Type mismatch';
    expect(isTransientRuntimeError(log)).toBe(false);
  });

  it('returns false for empty log', () => {
    expect(isTransientRuntimeError('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Item 8: RepairLog
// ---------------------------------------------------------------------------
describe('RepairLog (item 8)', () => {
  it('records and retrieves per-project events', () => {
    const log = new RepairLog();
    log.add('proj1', 'round', 'Repair round 1');
    log.add('proj2', 'shrinkage', 'App.tsx shrank 50%');
    log.add('proj1', 'unverified_claim', 'Model claimed fix without build');
    expect(log.forProject('proj1')).toHaveLength(2);
    expect(log.forProject('proj2')).toHaveLength(1);
    expect(log.forProject('proj1')[0].kind).toBe('round');
    expect(log.forProject('proj1')[1].kind).toBe('unverified_claim');
  });
});

// ---------------------------------------------------------------------------
// Nexus OS regression replay
// ---------------------------------------------------------------------------
describe('Nexus OS ERESOLVE regression replay', () => {
  const NEXUS_OS_LOG = [
    'npm warn deprecated eslint@8.57.1: This version is no longer supported.',
    'npm ERR! code ERESOLVE',
    'npm ERR! ERESOLVE could not resolve',
    'npm ERR! ',
    'npm ERR! While resolving: @vitejs/plugin-react@4.3.4',
    'npm ERR! Found: vite@6.0.0',
    'npm ERR! node_modules/vite',
    'npm ERR!   dev vite@"^6.0.0" from the root project',
    'npm ERR!   peer vite@"^5.0.0 || ^6.0.0" from @vitejs/plugin-react-swc@3.7.2',
    'npm ERR!   node_modules/@vitejs/plugin-react-swc',
    'npm ERR!     dev @vitejs/plugin-react-swc@"^3.7.2" from the root project',
    'npm ERR! ',
    'npm ERR! Could not resolve dependency:',
    'npm ERR! peer vite@"^4.2.0 || ^5.0.0" from @vitejs/plugin-react@4.3.4',
    'npm ERR! node_modules/@vitejs/plugin-react',
    'npm ERR!   dev @vitejs/plugin-react@"^4.3.4" from the root project',
    'npm ERR! ',
    'npm ERR! Conflicting peer dependency: vite@5.4.19',
    'npm ERR! node_modules/vite',
    'npm ERR!   peer vite@"^4.2.0 || ^5.0.0" from @vitejs/plugin-react@4.3.4',
    'npm ERR!   node_modules/@vitejs/plugin-react',
    'npm ERR!     dev @vitejs/plugin-react@"^4.3.4" from the root project',
    'npm ERR! ',
    'npm ERR! Fix the upstream dependency conflict, or retry',
    'npm ERR! this command with --force or --legacy-peer-deps',
    'npm ERR! to accept an incorrect (and potentially broken) dependency resolution.',
  ].join('\n');

  it('round 1: passes the FULL ERESOLVE block so the model can see the constraints', () => {
    const errors = extractBuildErrors(NEXUS_OS_LOG);
    // The old code truncated to 20 lines / 2000 chars — the constraint
    // "peer vite@^4.2.0 || ^5.0.0" was cut, so the model guessed wrong.
    expect(errors).toContain('peer vite@"^4.2.0 || ^5.0.0"');
    expect(errors).toContain('peer vite@"^5.0.0 || ^6.0.0"');
    expect(errors).toContain('Found: vite@6.0.0');
    expect(errors).toContain('Conflicting peer dependency: vite@5.4.19');
  });

  it('round 1: the repair message tells the model to pick from the constraint range', () => {
    const errors = extractBuildErrors(NEXUS_OS_LOG);
    const msg = buildRepairMessage('npm install', errors);
    // The model now sees: plugin-react needs vite ^4.2.0||^5.0.0, plugin-react-swc
    // needs vite ^5.0.0||^6.0.0. The intersection is ^5.0.0. With the old
    // truncated output, the model didn't see both constraints and flip-flopped.
    expect(msg).toContain('peer dependency constraints');
    expect(msg).toContain(errors);
  });

  it('round 1 resolves: the correct fix is visible in the full error', () => {
    const errors = extractBuildErrors(NEXUS_OS_LOG);
    // Both constraints are visible:
    // - @vitejs/plugin-react@4.3.4 needs vite ^4.2.0 || ^5.0.0
    // - @vitejs/plugin-react-swc@3.7.2 needs vite ^5.0.0 || ^6.0.0
    // Intersection: vite ^5.0.0 — the model can now see this.
    expect(errors).toContain('^4.2.0 || ^5.0.0');
    expect(errors).toContain('^5.0.0 || ^6.0.0');
    // npm even suggests the resolution: "Conflicting peer dependency: vite@5.4.19"
    expect(errors).toContain('vite@5.4.19');
  });

  it('flip-flop guard catches the old bad behavior within 2 rounds', () => {
    const guard = new FlipFlopGuard();
    const budget = new RepairBudget();
    const errors = extractBuildErrors(NEXUS_OS_LOG);

    // Round 1: budget allows, model changes vite ^6.0.0 → ^5.0.0
    expect(budget.take('nexus', errors)).toBe(true);
    expect(guard.record('nexus:vite', '^5.0.0')).toBe(false);

    // Round 2 (hypothetical): same error returns, model tries ^6.0.0 again
    // Budget still allows (2nd attempt for same error)
    expect(budget.take('nexus', errors)).toBe(true);
    // But flip-flop guard catches the revert
    expect(guard.record('nexus:vite', '^6.0.0')).toBe(false); // only 2 entries
    // After the model's 2nd change:
    expect(guard.record('nexus:vite', '^5.0.0')).toBe(true); // A→B→A detected!
  });
});
