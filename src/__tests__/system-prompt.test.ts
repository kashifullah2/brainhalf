import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildSystemPromptParts, resolvePromptMode } from '../lib/system-prompt';

describe('system prompt', () => {
  it('teaches the file and edit tag grammar the message parser implements', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('<file path="/src/components/Header.tsx">');
    expect(prompt).toContain('<edit path="/path/to/file">');
    expect(prompt).toContain('<search>');
    expect(prompt).toContain('<replace>');
    expect(prompt).toContain('<delete path="/src/obsolete.tsx" />');
  });

  it('requires standalone routing without nesting routers in the preview', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('Never nest routers');
  });

  it('never tells the model a secret is safe to echo back', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('Never output, echo or summarize the contents of .env files');
  });

  it('appends the planner block only in planner mode', () => {
    const coding = buildSystemPrompt({ filesContext: 'FILES', plannerMode: false });
    const planning = buildSystemPrompt({ filesContext: 'FILES', plannerMode: true });
    expect(coding).not.toContain('ACTIVE MODE: PLANNING');
    expect(planning).toContain('ACTIVE MODE: PLANNING');
    expect(planning).toContain('Write no code');
  });

  it('adds ACTIVE MODE: QUESTION when questionMode is set', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, questionMode: true });
    expect(prompt).toContain('ACTIVE MODE: QUESTION');
    expect(prompt).toContain('byte-for-byte identical');
    const normal = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(normal).not.toContain('ACTIVE MODE: QUESTION');
  });

  it('adds ACTIVE MODE: DESTRUCTIVE REQUEST when destructiveMode is set', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, destructiveMode: true });
    expect(prompt).toContain('ACTIVE MODE: DESTRUCTIVE REQUEST');
    expect(prompt).toContain('confirmation request');
    const normal = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(normal).not.toContain('ACTIVE MODE: DESTRUCTIVE REQUEST');
  });

  it('adds ACTIVE MODE: AMBIGUOUS REQUEST when ambiguousMode is set', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, ambiguousMode: true });
    expect(prompt).toContain('ACTIVE MODE: AMBIGUOUS REQUEST');
    const normal = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(normal).not.toContain('ACTIVE MODE: AMBIGUOUS REQUEST');
  });

  it('appends ACTIVE MODE: INCREMENTAL EDIT when isIncrementalEdit is true', () => {
    const prompt = buildSystemPrompt({ filesContext: 'FILES', plannerMode: false, isIncrementalEdit: true });
    expect(prompt).toContain('ACTIVE MODE: INCREMENTAL EDIT');
    expect(prompt).toContain('Never regenerate an entire file');
    const normal = buildSystemPrompt({ filesContext: 'FILES', plannerMode: false });
    expect(normal).not.toContain('ACTIVE MODE: INCREMENTAL EDIT');
  });

  it('injects projectMemory and modelHandoff notices when provided', () => {
    const prompt = buildSystemPrompt({
      filesContext: 'FILES',
      plannerMode: false,
      projectMemory: 'Components: Header, Sidebar; Routes: GET /api/stats',
      modelHandoff: 'Switched from model-A to model-B. Maintain continuity.',
    });
    expect(prompt).toContain('PROJECT MEMORY');
    expect(prompt).toContain('Components: Header, Sidebar');
    expect(prompt).toContain('MODEL HANDOFF');
    expect(prompt).toContain('Switched from model-A to model-B');
  });

  it('teaches the brainhalf.verify.json schema for managed targets', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('brainhalf.verify.json');
    expect(prompt).toContain('"version":1');
  });

  it('does not include brainhalf.verify.json guidance in the export backend rules', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, executionTarget: 'export' });
    expect(prompt).not.toContain('brainhalf.verify.json');
  });

  it('teaches plain-language communication for non-technical users', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('everyday words first');
    expect(prompt).toContain('what it means for their app in one plain sentence');
  });

  // ────────────────────────────────────────────────────────────────
  // isFreshBuild / project state detection
  // ────────────────────────────────────────────────────────────────

  it('defaults to EXISTING when isFreshBuild is omitted (safe direction)', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('Project state: EXISTING');
    expect(prompt).not.toContain('Project state: NEW');
  });

  it('shows NEW only when isFreshBuild is explicitly true', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, isFreshBuild: true });
    expect(prompt).toContain('Project state: NEW');
    expect(prompt).not.toContain('Project state: EXISTING');
  });

  it('shows EXISTING when isFreshBuild is explicitly false', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, isFreshBuild: false });
    expect(prompt).toContain('Project state: EXISTING');
    expect(prompt).not.toContain('Project state: NEW');
  });

  it('isIncrementalEdit overrides isFreshBuild: always EXISTING', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, isIncrementalEdit: true, isFreshBuild: true });
    expect(prompt).toContain('Project state: EXISTING');
    expect(prompt).not.toContain('Project state: NEW');
  });

  // ────────────────────────────────────────────────────────────────
  // Prompt safety rules for overwriting unseen files
  // ────────────────────────────────────────────────────────────────

  it('forbids overwriting files not seen in full', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('Never overwrite a file you have not seen in full');
    expect(prompt).toContain('A <file> block is a write, never a read request');
  });

  it('forbids reconstructing truncated files from memory', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('truncated or marked as shortened');
    expect(prompt).toContain('never reconstruct it from memory');
  });

  // ────────────────────────────────────────────────────────────────
  // Cache-stable split
  // ────────────────────────────────────────────────────────────────

  it('staticPart does not change across different isFreshBuild values', () => {
    const fresh = buildSystemPromptParts({ filesContext: '', plannerMode: false, isFreshBuild: true });
    const existing = buildSystemPromptParts({ filesContext: '', plannerMode: false, isFreshBuild: false });
    expect(fresh.staticPart).toBe(existing.staticPart);
  });

  it('staticPart changes when toolsAvailable changes', () => {
    const withTools = buildSystemPromptParts({ filesContext: '', plannerMode: false, toolsAvailable: true });
    const noTools = buildSystemPromptParts({ filesContext: '', plannerMode: false, toolsAvailable: false });
    expect(withTools.staticPart).not.toBe(noTools.staticPart);
  });
});

describe('resolvePromptMode', () => {
  it('destructive wins over everything', () => {
    expect(resolvePromptMode({ plannerMode: true, questionMode: true, destructiveMode: true })).toBe('destructive');
  });

  it('planner wins over question and ambiguous', () => {
    expect(resolvePromptMode({ plannerMode: true, questionMode: true })).toBe('planner');
  });

  it('question wins over ambiguous', () => {
    expect(resolvePromptMode({ plannerMode: false, questionMode: true, ambiguousMode: true })).toBe('question');
  });

  it('falls back to build', () => {
    expect(resolvePromptMode({ plannerMode: false })).toBe('build');
  });
});
