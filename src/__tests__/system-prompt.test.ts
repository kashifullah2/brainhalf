import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../lib/system-prompt';

/**
 * buildSystemPrompt was inlined in ChatAgent and is now a pure module function.
 * The prompt is the product's behaviour contract with the model, so this pins
 * the invariants a prompt edit must not silently break: the file/edit tag
 * grammar the message parser depends on, the router rule the preview harness
 * depends on, and the planner switch.
 */
describe('7.3 extracted system prompt', () => {
  it('teaches the file and edit tag grammar the message parser implements', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('<file path="/src/App.tsx">');
    expect(prompt).toContain('<edit path="/path/to/file">');
    expect(prompt).toContain('<search>');
    expect(prompt).toContain('<replace>');
    expect(prompt).toContain('<delete path="/src/obsolete.jsx" />');
    // The parser is exact about this; a fence-wrapped <file> block is skipped
    // and the generated app comes out empty.
    expect(prompt).toContain('Do NOT wrap <file> or <edit> tags in markdown code fences');
  });

  it('requires standalone routing without nesting routers in the preview', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('exported code works without the preview harness');
    expect(prompt).toContain('Do not nest routers');
  });

  it('forbids invented compiler settings and requires shared types in src/types.ts', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('cite only compiler options that are actually present');
    expect(prompt).toContain('never invent settings such as verbatimModuleSyntax');
    expect(prompt).toContain('extract those types to /src/types.ts');
  });

  it('appends the planner block only in planner mode', () => {
    const coding = buildSystemPrompt({ filesContext: 'FILES', plannerMode: false });
    const planning = buildSystemPrompt({ filesContext: 'FILES', plannerMode: true });

    expect(coding).not.toContain('PLANNER MODE ACTIVE');
    expect(planning).toContain('PLANNER MODE ACTIVE');
    expect(planning).toContain('Do NOT write code or file blocks');

    // The files context is always last: it is the largest payload and the part
    // the model should be reasoning about.
    expect(coding.endsWith('FILES\n')).toBe(true);
    expect(planning.endsWith('FILES\n')).toBe(true);
  });

  it('never tells the model a secret is safe to echo back', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('NEVER output, echo, or summarise the contents of .env files');
  });

  it('requires batching independent file writes into one tool round', () => {
    // Parallel write_file calls in a single step skip a full model roundtrip
    // per file — the single biggest generation-latency lever we control.
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('parallel write_file calls in ONE tool round');
    expect(prompt).toContain('App.tsx before components');
  });

  it('teaches plain-language communication for non-technical users', () => {
    // Non-technical users bounce on raw errors ("ERESOLVE peerDependencies");
    // the agent must lead with what a failure means for their app.
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('PLAIN-LANGUAGE COMMUNICATION');
    expect(prompt).toContain('everyday words first');
    expect(prompt).toContain('what it means for their app in one plain sentence');
  });

  it('B4: forbids file changes in the same response as a deletion confirmation request', () => {
    // QA: "delete all files" asked for confirmation AND rewrote 11 files.
    // The confirmation turn must emit zero file operations.
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('B4 RULE');
    expect(prompt).toContain('ENTIRE response must be a plain-text confirmation request');
    expect(prompt).toContain('Emit ZERO <file>, <edit>, and <delete> blocks');
  });

  it('B5: requires plain-text answers to non-change questions without touching files', () => {
    // QA: haiku/recursion prompts regenerated the whole project.
    // Pure Q&A turns must leave files byte-for-byte identical.
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(prompt).toContain('PLAIN-TEXT QUESTIONS');
    expect(prompt).toContain('answer in plain chat text ONLY');
    expect(prompt).toContain('byte-for-byte identical');
  });

  it('B5: adds an explicit QUESTION MODE block when questionMode is set', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, questionMode: true });
    expect(prompt).toContain('QUESTION MODE ACTIVE');
    expect(prompt).toContain('Do NOT emit <file>, <edit>, or <delete> blocks');
    const normal = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(normal).not.toContain('QUESTION MODE ACTIVE');
  });

  it('B4: adds an explicit DESTRUCTIVE REQUEST block when destructiveMode is set', () => {
    const prompt = buildSystemPrompt({ filesContext: '', plannerMode: false, destructiveMode: true });
    expect(prompt).toContain('DESTRUCTIVE REQUEST MODE ACTIVE');
    expect(prompt).toContain('ENTIRE response must be');
    expect(prompt).toContain('a plain-text confirmation request');
    const normal = buildSystemPrompt({ filesContext: '', plannerMode: false });
    expect(normal).not.toContain('DESTRUCTIVE REQUEST MODE ACTIVE');
  });
});
