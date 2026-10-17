import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { LandingHero } from '../components/landing/LandingPage';

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
      onPickIdea: vi.fn(),
      ...overrides,
    })
  );
}

describe('LandingHero', () => {
  it('renders the headline and key elements', () => {
    const html = renderHero();
    expect(html).toContain('id="hero-heading"');
    expect(html).toContain('Describe it.');
    expect(html).toContain('Start building');
  });

  it('keeps the composer hooks the new-project flow depends on', () => {
    const html = renderHero();
    expect(html).toContain('id="start-building"');
    expect(html).toContain('id="app-idea"');
    expect(html).toContain('composer');
    expect(html).toContain('composer-input');
  });

  it('renders starter chips', () => {
    const html = renderHero();
    expect(html).toContain('starters');
    expect(html).toContain('Inventory');
    expect(html).toContain('Bookings');
  });
});
