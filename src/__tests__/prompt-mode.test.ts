import { describe, expect, it } from 'vitest';
import { shouldAutoPlannerMode, isQuestionPrompt, isDestructivePrompt, isAmbiguousPrompt } from '../lib/prompt-mode';
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

describe('B5: question prompt detection', () => {
  it('detects plain-text questions that must not touch files', () => {
    // QA: these regenerated the entire project. They must be chat-only.
    expect(isQuestionPrompt('Write a haiku about the sea.')).toBe(true);
    expect(isQuestionPrompt('Explain recursion simply.')).toBe(true);
    expect(isQuestionPrompt('What is the capital of France?')).toBe(true);
    expect(isQuestionPrompt('How does photosynthesis work?')).toBe(true);
    expect(isQuestionPrompt('Tell me a joke')).toBe(true);
    expect(isQuestionPrompt('Why is the sky blue?')).toBe(true);
  });

  it('does not hijack build requests as questions', () => {
    // False positives here would silently refuse to build.
    expect(isQuestionPrompt('Build a landing page for my bakery')).toBe(false);
    expect(isQuestionPrompt('Add a dark mode toggle to settings')).toBe(false);
    expect(isQuestionPrompt('Create a todo app')).toBe(false);
    expect(isQuestionPrompt('Fix the login bug')).toBe(false);
    expect(isQuestionPrompt('Write a blog post component for my site')).toBe(false);
    expect(isQuestionPrompt('build a minimal HTML button')).toBe(false);
    expect(isQuestionPrompt('Delete all files in this project')).toBe(false);
  });
});

describe('B4: destructive prompt detection', () => {
  it('detects wipe-the-project requests', () => {
    expect(isDestructivePrompt('Delete all files in this project')).toBe(true);
    expect(isDestructivePrompt('Remove every file')).toBe(true);
    expect(isDestructivePrompt('Wipe the entire codebase')).toBe(true);
    expect(isDestructivePrompt('Clear all files and start over')).toBe(true);
  });

  it('does not flag targeted edits as destructive', () => {
    expect(isDestructivePrompt('Delete the old logo file')).toBe(false);
    expect(isDestructivePrompt('Remove the contact page')).toBe(false);
    expect(isDestructivePrompt('Write a haiku about the sea.')).toBe(false);
    expect(isDestructivePrompt('Build a landing page')).toBe(false);
  });
});

describe('isAmbiguousPrompt', () => {
  it('flags vague build requests with no target', () => {
    expect(isAmbiguousPrompt('make something cool')).toBe(true);
    expect(isAmbiguousPrompt('build me anything')).toBe(true);
    expect(isAmbiguousPrompt('surprise me')).toBe(true);
    // "do something fun" is safely handled as a question (text answer, no
    // build), so it must not reach ambiguous mode either.
    expect(isAmbiguousPrompt('do something fun')).toBe(false);
    expect(isQuestionPrompt('do something fun')).toBe(true);
  });

  it('does not flag concrete builds', () => {
    expect(isAmbiguousPrompt('build a landing page for my bakery')).toBe(false);
    expect(isAmbiguousPrompt('make a todo app')).toBe(false);
    expect(isAmbiguousPrompt('add a dark mode toggle')).toBe(false);
  });

  it('does not flag questions, chat, or destructive prompts', () => {
    expect(isAmbiguousPrompt('write a haiku about the sea')).toBe(false);
    expect(isAmbiguousPrompt('hello')).toBe(false);
    expect(isAmbiguousPrompt('delete all files')).toBe(false);
  });
});
