import { describe, expect, it } from 'vitest';
import { shouldAutoPlannerMode } from '../lib/prompt-mode';
import { BUSINESS_APPS, businessValidationPrompt } from '../lib/business-apps';

describe('prompt mode heuristics', () => {
  it('enables planner mode for explicit /plan prompts', () => {
    expect(shouldAutoPlannerMode('/plan build a CRM')).toBe(true);
  });

  it('disables planner mode for explicit /build prompts', () => {
    expect(shouldAutoPlannerMode('/build add login page')).toBe(false);
  });

  it('builds complex multi-step implementation requests rather than silently returning a plan', () => {
    const prompt = `Fix all bugs, then review architecture, then improve UI/UX, and then harden security.\n1. Audit\n2. Plan\n3. Implement`;
    expect(shouldAutoPlannerMode(prompt)).toBe(false);
  });

  it('builds all five detailed business briefs and preserves explicit planning requests', () => {
    for (const app of BUSINESS_APPS) expect(shouldAutoPlannerMode(businessValidationPrompt(app, 'My app'))).toBe(false);
    for (const prompt of ['Please write a plan for my CRM', 'Help me plan an inventory app', 'Review the architecture', '/plan Build a booking app']) expect(shouldAutoPlannerMode(prompt)).toBe(true);
  });

  it('keeps planner mode off for short direct coding prompts', () => {
    expect(shouldAutoPlannerMode('Add a dark mode toggle to settings')).toBe(false);
  });
});
