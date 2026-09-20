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
    expect(html).toContain('Explore Starter Templates');
    expect(html).toContain('Engineered for Autonomous Development');
    expect(html).toContain('Next-Gen Autonomous AI Studio');
    expect(html).toContain('Claude 3.7 • Kimi K3 • DeepSeek');
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
    // Top-bar auth buttons are replaced with user avatar
    expect(html).not.toContain('landing-auth-buttons');
  });

  it('renders prompt idea suggestions and starter templates in the landing page', () => {
    const html = renderToString(
      React.createElement(LandingPage, {
        onOpenProject: vi.fn(),
        onSubmitInitialPrompt: vi.fn(),
        currentUser: null,
      })
    );

    expect(html).toContain('📊 SaaS Analytics Dashboard');
    expect(html).toContain('🪙 Crypto &amp; DeFi Tracker');
    expect(html).toContain('📋 Kanban Workspace');
    expect(html).toContain('Crypto Portfolio &amp; DeFi Tracker');
    expect(html).toContain('Modern SaaS Analytics Platform');
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
    expect(html).toContain('Create your studio account');
    expect(html).toContain('aria-label="Close"');
  });

  it('renders LoginScreen in login mode when initialMode is login', () => {
    const html = renderToString(
      React.createElement(LoginScreen, {
        onAuthenticated: vi.fn(),
        initialMode: 'login',
      })
    );

    expect(html).toContain('Sign in to your studio');
    expect(html).toContain('Sign in');
  });
});

