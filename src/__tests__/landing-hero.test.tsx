import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import LandingHero, { tiltForCursor } from '../components/landing/LandingHero';

function renderHero(overrides: Record<string, unknown> = {}) {
  const textareaRef = { current: null };
  return renderToString(
    React.createElement(LandingHero, {
      promptText: '',
      onPromptTextChange: vi.fn(),
      textareaRef,
      creatingProject: false,
      onPromptSubmit: vi.fn(),
      onPromptKeyDown: vi.fn(),
      onFocusComposer: vi.fn(),
      ...overrides,
    })
  );
}

describe('LandingHero redesign', () => {
  it('renders the headline with gradient text and key links', () => {
    const html = renderHero();
    expect(html).toContain('id="hero-heading"');
    expect(html).toContain('hero-gradient-text');
    expect(html).toContain('build it.');
    expect(html).toContain('Start building');
    expect(html).toContain('See examples');
    expect(html).toContain('href="#examples"');
  });

  it('keeps the composer hooks the new-project flow depends on', () => {
    const html = renderHero();
    // Same form id, textarea id, class names and label as before the redesign.
    expect(html).toContain('id="start-building"');
    expect(html).toContain('id="app-idea"');
    expect(html).toContain('landing-prompt-box');
    expect(html).toContain('landing-prompt-textarea');
    expect(html).toContain('landing-submit-btn');
    expect(html).toContain('Describe your app');
  });

  it('disables the submit button while the prompt is empty', () => {
    const html = renderHero();
    expect(html).toMatch(/<button[^>]*landing-submit-btn[^>]*disabled/);
  });

  it('caps cursor tilt at 4 degrees', () => {
    const extreme = tiltForCursor(10, -10);
    expect(extreme.tiltX).toBe('4.00deg');
    expect(extreme.tiltY).toBe('4.00deg');
    const extremeNeg = tiltForCursor(-10, 10);
    expect(extremeNeg.tiltX).toBe('-4.00deg');
    expect(extremeNeg.tiltY).toBe('-4.00deg');
    const gentle = tiltForCursor(0.25, -0.125);
    expect(gentle.tiltX).toBe('1.00deg');
    expect(gentle.tiltY).toBe('2.00deg');
    const centered = tiltForCursor(0, 0);
    expect(centered.tiltX).toBe('0.00deg');
    expect(centered.tiltY).toBe('0.00deg');
  });
});
