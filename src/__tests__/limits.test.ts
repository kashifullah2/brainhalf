/**
 * NOW-04: quota constants are centralized in src/lib/limits.ts.
 *
 * Guards the product contract (values) and the wiring (every creation path
 * references the shared constants instead of re-declaring raw literals, so
 * a quota check can never again compare against the wrong number silently).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AI_CONCURRENT_GENERATIONS,
  AI_DAILY_MODEL_CALLS,
  AI_DAILY_OUTPUT_TOKENS,
  AI_GENERATION_LEASE_MS,
  MAX_HOSTED_APP_SPACES,
  MAX_PROJECT_ROWS_PER_USER,
  MAX_PROJECTS_PER_USER,
} from '../lib/limits';
import { AI_ALLOWANCE } from '../lib/ai-budget';
import { HOSTED_APP_LIMIT } from '../lib/hosted-limit';
import { PILOT_LIMITS } from '../runtime/types';

const readSrc = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
// Strip block comments and full-line comments so the audit sees code, not prose.
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('centralized product limits', () => {
  it('exports the fixed product contract values', () => {
    expect(MAX_PROJECTS_PER_USER).toBe(50);
    expect(MAX_PROJECT_ROWS_PER_USER).toBe(200);
    expect(MAX_HOSTED_APP_SPACES).toBe(10);
    expect(AI_DAILY_MODEL_CALLS).toBe(200);
    expect(AI_DAILY_OUTPUT_TOKENS).toBe(10_000_000);
    expect(AI_CONCURRENT_GENERATIONS).toBe(4);
    expect(AI_GENERATION_LEASE_MS).toBe(15 * 60_000);
  });

  it('AI_ALLOWANCE is built from the shared constants', () => {
    expect(AI_ALLOWANCE).toEqual({
      dailyCalls: AI_DAILY_MODEL_CALLS,
      dailyOutputTokens: AI_DAILY_OUTPUT_TOKENS,
      concurrentGenerations: AI_CONCURRENT_GENERATIONS,
      leaseMs: AI_GENERATION_LEASE_MS,
    });
  });

  it('the hosted-app cap is one constant from UI to backend enforcement', () => {
    expect(HOSTED_APP_LIMIT).toBe(MAX_HOSTED_APP_SPACES);
    expect(PILOT_LIMITS.projects).toBe(MAX_HOSTED_APP_SPACES);
  });

  it('registry quota checks reference the shared constants, never raw literals', () => {
    const registry = codeOnly(readSrc('../registry.ts'));
    // Both creation paths (claim and remix) check the live-project cap…
    expect(registry.match(/live >= MAX_PROJECTS_PER_USER/g)).toHaveLength(2);
    // …and the claim path checks the lifetime-rows cap.
    expect(registry).toContain('total >= MAX_PROJECT_ROWS_PER_USER');
    // No raw numeric comparison against a live/total count anywhere.
    expect(registry).not.toMatch(/(live|total)\s*>=\s*\d/);
  });

  it('ai-budget, hosted-limit, and runtime types source their numbers from limits.ts', () => {
    const aiBudget = codeOnly(readSrc('../lib/ai-budget.ts'));
    expect(aiBudget).toContain("from './limits'");
    const allowance = aiBudget.match(/export const AI_ALLOWANCE = \{([^}]*)\}/);
    expect(allowance).toBeTruthy();
    expect(allowance![1]).not.toMatch(/\d/); // every value is a named constant

    const hostedLimit = codeOnly(readSrc('../lib/hosted-limit.ts'));
    expect(hostedLimit).toContain("from './limits'");
    expect(hostedLimit).toContain('HOSTED_APP_LIMIT = MAX_HOSTED_APP_SPACES');

    const runtimeTypes = codeOnly(readSrc('../runtime/types.ts'));
    expect(runtimeTypes).toContain("from '../lib/limits'");
    expect(runtimeTypes).toContain('projects: MAX_HOSTED_APP_SPACES');
  });
});
