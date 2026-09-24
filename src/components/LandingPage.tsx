import { BUSINESS_APPS } from '../lib/business-apps';
import ThemeToggle from './ThemeToggle';
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Code2,
  Monitor,
  MessageCircle,
  Plus,
  ArrowUpRight,
  LogOut,
  BarChart3,
  LayoutGrid,
  ShoppingCart,
  MessageSquare,
  Check,
} from 'lucide-react';
import { BrainHalfLogo } from './BrainHalfLogo';
import LandingFooter from './LandingFooter';
import LandingShowcase from './LandingShowcase';
import { HOME_FAQS, HOME_MODIFIED, formatContentDate } from '../seo/content';
import './LandingPage.css';
import './PublicPage.css';

interface LandingPageProps {
  onOpenProject: (projectId: string) => void;
  onSubmitInitialPrompt: (prompt: string) => void;
  creatingProject?: boolean;
  currentUser?: { email?: string; name?: string } | null;
  onLogout?: () => void | Promise<void>;
  onLoginRequest?: (mode?: 'login' | 'signup') => void;
  onOpenDashboard?: () => void;
}

const SUGGESTIONS = BUSINESS_APPS;

const HOW_IT_WORKS = [
  { step: '01', title: 'Put your idea into words', detail: 'Describe one job: tracking stock, booking appointments, or following up with customers.' },
  { step: '02', title: 'Watch it take shape', detail: 'Try adding a record and saving changes. Ask for anything that makes the job easier.' },
  { step: '03', title: 'Publish when it works', detail: 'Click Publish to build, check and host your supported app. Your existing usage limits apply.' },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  onSubmitInitialPrompt,
  creatingProject = false,
  currentUser,
  onLogout,
  onLoginRequest,
  onOpenDashboard,
}) => {
  const [promptText, setPromptText] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);

  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [promptText]);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showUserMenu) {
        setShowUserMenu(false);
        userMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showUserMenu]);

  const handlePromptSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (creatingProject) return;
    const trimmed = promptText.trim();
    if (!trimmed) return;
    onSubmitInitialPrompt(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      handlePromptSubmit();
    }
  };

  const focusComposer = (event?: React.MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault();
    textareaRef.current?.focus({ preventScroll: true });
    textareaRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'center',
    });
  };

  const handleExamplePrompt = (prompt: string) => {
    setPromptText(prompt);
    focusComposer();
  };

  const userInitial = (currentUser?.name || currentUser?.email || 'U')
    .trim()[0]
    .toUpperCase();

  return (
    <div className="landing-container">
      <a className="studio-skip-link" href="#main-content">Skip to content</a>

      {/* Nav */}
      <header className="landing-header">
        <div className="landing-header-left">
          <button
            type="button"
            className="landing-brand-group"
            onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}
            aria-label="BrainHalf home"
          >
            <div className="landing-brand-logo">
              <BrainHalfLogo size={27} strokeWidth={1.6} color="currentColor" />
            </div>
            <span className="landing-brand-text">BrainHalf</span>
            <span className="landing-brand-descriptor">Tools for your business</span>
          </button>

        </div>

        <nav className="studio-navigation" aria-label="Main navigation"><a href="#examples">Examples</a><a href="#how-it-works">How it works</a><a href="#questions">FAQs</a></nav>

        <div className="landing-header-right">
          {currentUser && <button className="landing-get-started-btn" onClick={onOpenDashboard}>Dashboard <ArrowRight size={14} /></button>}
          <ThemeToggle />
          {currentUser ? (
            <div className="landing-user-menu-anchor" ref={userMenuRef}>
              <button
                ref={userMenuButtonRef}
                type="button"
                className="landing-user-menu-trigger"
                onClick={() => setShowUserMenu(prev => !prev)}
                title={currentUser?.email || 'User Profile'}
                aria-label="User profile and menu"
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
              >
                <span className="landing-user-avatar" aria-hidden="true">{userInitial}</span>
                <span className="landing-user-menu-email">{currentUser?.email || 'user@brainhalf.com'}</span>
                <ChevronDown size={13} className="landing-user-menu-chevron" aria-hidden="true" />
              </button>

              {showUserMenu && (
                <div className="landing-user-dropdown" role="menu" aria-label="User menu">
                  <div className="landing-user-dropdown-info" role="presentation">
                    <p className="user-email">{currentUser?.email || 'user@brainhalf.com'}</p>
                  </div>
                  <hr className="landing-dropdown-divider" />
                  {onLogout && (
                    <button
                      type="button"
                      className="landing-dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setShowUserMenu(false);
                        onLogout();
                      }}
                    >
                      <LogOut size={14} />
                      <span>Sign out</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="landing-auth-buttons">
              <button
                type="button"
                className="landing-signin-btn"
                onClick={() => onLoginRequest?.('login')}
              >
                Sign in
              </button>
              <button
                type="button"
                className="landing-get-started-btn"
                onClick={() => onLoginRequest?.('signup')}
              >
                <span>Get Started</span>
                <ArrowRight size={13} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <main className="landing-main-content" id="main-content" tabIndex={-1}>
        <section className="landing-hero-shell" aria-labelledby="hero-heading">
          <div className="landing-hero-copy">
            <p className="landing-hero-eyebrow"><span aria-hidden="true" /> AI app builder for small businesses</p>
            <h1 id="hero-heading" aria-label="Build the tools your business needs.">Less busywork.<br /><span>Your own tools.</span></h1>
            <p className="landing-hero-description">Track stock, manage bookings, or keep customers organised. Describe the tool your business needs, try it, and publish it from one workspace.</p>
            <form className="landing-prompt-box" id="start-building" onSubmit={handlePromptSubmit}>
              <label htmlFor="app-idea" className="landing-input-label">Describe your app</label>
              <textarea
                id="app-idea"
                ref={textareaRef}
                className="landing-prompt-textarea"
                placeholder="I run a small business and need a tool to track…"
                aria-describedby="prompt-help"
                value={promptText}
                onChange={event => setPromptText(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
              />
              <div className="landing-prompt-actions">
                <span><MessageCircle size={14} aria-hidden="true" /> Start with a simple idea</span>
                <button
                  type="submit"
                  className="landing-submit-btn"
                  disabled={!promptText.trim() || creatingProject}
                  title="Create app from prompt (Enter)"
                  aria-label="Create app from prompt"
                >
                  <span>{creatingProject ? 'Creating project…' : 'Build my app'}</span><ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            </form>
            <p className="landing-prompt-help" id="prompt-help"><span><Check size={14} aria-hidden="true" /> Free to start</span><span><Check size={14} aria-hidden="true" /> No coding required</span></p>
            <p className="landing-starter-link">Need a starting point? <a href="#possibilities">Explore app ideas <ArrowRight size={13} aria-hidden="true" /></a></p>
          </div>
          <LandingShowcase onUsePrompt={handleExamplePrompt} />
        </section>

        <div className="studio-promise-strip" aria-label="What you can do with BrainHalf">
          <span>YOUR IDEA, FROM<br />FIRST WORD TO FIRST VERSION.</span>
          <div><MessageCircle size={16} /> Build by conversation</div>
          <div><Monitor size={16} /> See every change</div>
          <div><Code2 size={16} /> Keep your source code</div>
        </div>

        <section className="studio-ideas-section" id="possibilities" aria-labelledby="ideas-heading">
          <div className="studio-section-intro">
            <div><p className="studio-section-label">A LITTLE INSPIRATION</p><h2 id="ideas-heading">What will you make first?</h2></div>
            <p>Pick an idea to fill in your first prompt.<br />Change anything before you build.</p>
          </div>
          <div className="studio-idea-list">
            {SUGGESTIONS.map((suggestion, index) => {
              const Icon = [ShoppingCart, LayoutGrid, BarChart3, Check, MessageSquare][index];
              return <button key={suggestion.label} type="button" className={`studio-idea-card idea-tone-${index}`} onClick={() => handleExamplePrompt(suggestion.prompt)}>
                <span className="studio-idea-icon"><Icon size={25} strokeWidth={1.5} /></span>
                <strong>{suggestion.label}</strong><span>{suggestion.detail}</span><ArrowUpRight className="studio-idea-arrow" size={18} />
              </button>;
            })}
          </div>
        </section>

        <section className="studio-workflow-section" id="how-it-works" aria-labelledby="workflow-heading">
          <div className="studio-workflow-intro"><p className="studio-section-label">THE WAY FROM IDEA TO APP</p><h2 id="workflow-heading">Less setup.<br />More possibility.</h2><p>BrainHalf is your AI building partner. You set the direction, make the decisions, and stay close to what you’re creating.</p><a href="#start-building" onClick={focusComposer}>Let’s make something <ArrowRight size={16} /></a></div>
          <ol className="landing-how-it-works" aria-label="How it works" role="list">
            {HOW_IT_WORKS.map(item => <li key={item.step} className="landing-how-card"><span className="landing-how-step" aria-hidden="true">{item.step}</span><div><h3 className="landing-how-title">{item.title}</h3><p className="landing-how-detail">{item.detail}</p></div></li>)}
          </ol>
        </section>

        <section className="studio-faq-section" id="questions" aria-labelledby="faq-heading">
          <div><p className="studio-section-label">GOOD TO KNOW</p><h2 id="faq-heading">Before you begin.</h2><p className="studio-content-updated">Product information updated<br /><time dateTime={HOME_MODIFIED}>{formatContentDate(HOME_MODIFIED)}</time></p></div>
          <div className="studio-faq-list">
            {HOME_FAQS.map((faq, index) => <details key={faq.id} id={faq.id} open={index === 0}><summary><h3>{faq.question}<Plus size={17} aria-hidden="true" /></h3></summary><p>{faq.answer}</p></details>)}
          </div>
        </section>
        <section className="studio-resource-section" aria-labelledby="resources-heading">
          <p className="studio-section-label">FROM A CLEAR BRIEF TO A WORKING PROJECT</p>
          <h2 id="resources-heading">Get more from your AI app builder.</h2>
          <div className="studio-resource-links">
            <a href="/guides/build-an-app-with-ai">How to build an app with AI <ArrowUpRight size={17} /></a>
            <a href="/use-cases/ai-dashboard-builder">Build a custom dashboard <ArrowUpRight size={17} /></a>
            <a href="/use-cases/ai-website-builder">Create a website with AI <ArrowUpRight size={17} /></a>
            <a href="/use-cases/ai-inventory-app-builder">Plan an inventory app <ArrowUpRight size={17} /></a>
            <a href="/guides/ai-appointment-app-example">See a tested appointment-app example <ArrowUpRight size={17} /></a>
            <a href="/guides/full-stack-apps">Add saved data and sign-in <ArrowUpRight size={17} /></a>
          </div>
        </section>
        <section className="studio-closing" aria-labelledby="closing-heading"><div><p className="studio-section-label">YOU’VE ALREADY GOT THE FIRST INGREDIENT.</p><h2 id="closing-heading">Give that idea<br />somewhere to go.</h2><p>Start with a sentence. See where it takes you.</p></div><a href="#start-building" className="studio-closing-link" onClick={focusComposer}>Let’s build your app <ArrowUpRight size={18} /></a><div className="studio-closing-mark" aria-hidden="true"><BrainHalfLogo size={240} color="currentColor" /></div></section>
      </main>

      <LandingFooter />

    </div>
  );
};

export default LandingPage;
