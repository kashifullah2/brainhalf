/**
 * Speed fixes (Lovable/Bolt-style): verify single-pass default, staged
 * only for huge prompts, and deterministic scaffold injection.
 */
import { describe, expect, it } from 'vitest';
import { shouldUseStagedPipeline } from '../lib/prompt-mode';
import { ensureScaffold, createTypeScriptStarter } from '../lib/project-starters';

const baseOpts = {
  plannerMode: false,
  modes: undefined,
  resumeChain: null,
  isFreshBuild: true,
  fileOutputRetry: false,
};

describe('single-pass default (Fix 3)', () => {
  it('uses single-pass for normal prompts', () => {
    expect(shouldUseStagedPipeline({ ...baseOpts, actualPrompt: 'Build a todo app with a nice UI' })).toBe(false);
  });

  it('uses single-pass for medium prompts', () => {
    const prompt = 'Build a CRM with contacts, deals, and a dashboard. '.repeat(20); // ~180 words
    expect(shouldUseStagedPipeline({ ...baseOpts, actualPrompt: prompt })).toBe(false);
  });

  it('uses staged pipeline for huge prompts (>400 words)', () => {
    const prompt = 'Build a complex app with many features. '.repeat(60); // ~420 words
    expect(shouldUseStagedPipeline({ ...baseOpts, actualPrompt: prompt })).toBe(true);
  });

  it('uses staged pipeline when user asks for phased delivery', () => {
    expect(shouldUseStagedPipeline({ ...baseOpts, actualPrompt: 'Build my app step by step, phase 1 first' })).toBe(true);
  });

  it('never stages in planner/question/destructive modes', () => {
    const huge = 'word '.repeat(500);
    expect(shouldUseStagedPipeline({ ...baseOpts, plannerMode: true, actualPrompt: huge })).toBe(false);
    expect(shouldUseStagedPipeline({ ...baseOpts, modes: { questionMode: true }, actualPrompt: huge })).toBe(false);
  });
});

describe('deterministic scaffold (Fix 2)', () => {
  it('injects boilerplate files the model skipped', () => {
    const files = ensureScaffold({ '/src/App.tsx': 'export default () => null;' });
    expect(files['/src/main.tsx']).toContain('createRoot');
    expect(files['/index.html']).toContain('<!doctype html>');
    expect(files['/tsconfig.json']).toContain('strict');
    expect(files['/vite.config.ts']).toContain('defineConfig');
    expect(files['/src/components/AppBoundary.tsx']).toContain('Component');
  });

  it('does not overwrite model-written files', () => {
    const custom = '/* custom index */';
    const files = ensureScaffold({ '/index.html': custom });
    expect(files['/index.html']).toBe(custom);
  });

  it('does not inject App.tsx or styles.css (model\'s job)', () => {
    const files = ensureScaffold({});
    expect(files['/src/App.tsx']).toBeUndefined();
    expect(files['/src/styles.css']).toBeUndefined();
  });

  it('matches the TypeScript starter content', () => {
    const starter = createTypeScriptStarter();
    const files = ensureScaffold({});
    expect(files['/src/main.tsx']).toBe(starter['/src/main.tsx']);
    expect(files['/index.html']).toBe(starter['/index.html']);
  });
});
