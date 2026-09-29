import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import LandingPage from '../components/LandingPage';
import LoginScreen from '../components/LoginScreen';

describe('Unauthenticated Landing Page & Get Started flow', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => { mockStorage[key] = val; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
    });
  });

  it('renders "Get Started" and "Sign in" buttons when currentUser is null', () => {
    const onLoginRequest = vi.fn();
    const html = renderToString(
      React.createElement(LandingPage, {
        onOpenProject: vi.fn(),
        onSubmitInitialPrompt: vi.fn(),
        currentUser: null,
        onLoginRequest,
      })
    );

    expect(html).toContain('Get Started');
    expect(html).toContain('Sign in');
    expect(html).toContain('From a sentence');
    expect(html).toContain('Start building');
  });

  it('renders user avatar and email when currentUser is logged in', () => {
    const html = renderToString(
      React.createElement(LandingPage, {
        onOpenProject: vi.fn(),
        onSubmitInitialPrompt: vi.fn(),
        currentUser: { email: 'dev@brainhalf.com', name: 'Alice' },
      })
    );

    expect(html).toContain('landing-user-avatar');
    expect(html).toContain('A');
    expect(html).toContain('Dashboard');
    expect(html).not.toContain('Recent projects');
    // Top-bar auth buttons are replaced with user avatar
    expect(html).not.toContain('class="landing-auth-buttons"');
  });

  it('renders the current prompt idea suggestions', () => {
    const html = renderToString(
      React.createElement(LandingPage, {
        onOpenProject: vi.fn(),
        onSubmitInitialPrompt: vi.fn(),
        currentUser: null,
      })
    );

    expect(html).toContain('Inventory tool');
    expect(html).toContain('Booking app');
    expect(html).toContain('Task manager');
    expect(html).toContain('Simple CRM');
  });

  it('allows landing page content to scroll so the footer remains visible', () => {
    const html = renderToString(
      React.createElement(LandingPage, {
        onOpenProject: vi.fn(),
        onSubmitInitialPrompt: vi.fn(),
        currentUser: null,
      })
    );

    expect(html).toContain('class="landing-container"');
    expect(html).toContain('landing-footer');
  });

  it('renders LoginScreen in modal mode with signup mode for Get Started', () => {
    const onClose = vi.fn();
    const html = renderToString(
      React.createElement(LoginScreen, {
        onAuthenticated: vi.fn(),
        onClose,
        initialMode: 'signup',
      })
    );

    expect(html).toContain('Create account');
    expect(html).toContain('Start building for free');
    expect(html).toContain('aria-label="Close"');
  });

  it('renders LoginScreen in login mode when initialMode is login', () => {
    const html = renderToString(
      React.createElement(LoginScreen, {
        onAuthenticated: vi.fn(),
        initialMode: 'login',
      })
    );

    expect(html).toContain('Sign in to continue building');
    expect(html).toContain('Sign in');
  });
});
