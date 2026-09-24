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
});
