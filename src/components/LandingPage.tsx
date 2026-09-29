import { BUSINESS_APPS } from '../lib/business-apps';
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowRight,
  Plus,
  ArrowUpRight,
  BarChart3,
  LayoutGrid,
  ShoppingCart,
  MessageSquare,
  Check,
  Zap,
  Menu,
  X,
} from 'lucide-react';
import { BrainHalfLogo } from './BrainHalfLogo';
import LandingFooter from './LandingFooter';
import LandingShowcase from './LandingShowcase';
import SiteHeaderActions from './SiteHeaderActions';
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

const IDEA_ICONS = [ShoppingCart, LayoutGrid, BarChart3, MessageSquare];

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
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [promptText]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showMobileMenu) setShowMobileMenu(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showMobileMenu]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setShowMobileMenu(false);
      }
    };
    if (showMobileMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMobileMenu]);

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

  return (
    <div className="landing-container">
      <a className="studio-skip-link" href="#main-content">Skip to content</a>

      {/* Nav */}
      <header className="landing-header">
        <div className="landing-header-left">
          <button
            type="button"
            className="landing-brand-group"
            onClick={() => { setShowMobileMenu(false); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}
            aria-label="BrainHalf home"
          >
            <div className="landing-brand-logo">
              <BrainHalfLogo size={27} strokeWidth={1.6} color="currentColor" />
            </div>
            <span className="landing-brand-text">BrainHalf</span>
          </button>
        </div>

        <nav className="studio-navigation" aria-label="Main navigation">
          <a href="#possibilities">Examples</a>
          <a href="/gallery">Gallery</a>
          <a href="#how-it-works">How it works</a>
          <a href="#questions">FAQs</a>
        </nav>

        <div className="landing-header-right">
          <button
            type="button"
            className="landing-mobile-menu-btn"
            aria-label={showMobileMenu ? 'Close menu' : 'Open menu'}
            aria-expanded={showMobileMenu}
            aria-controls="mobile-nav"
            onClick={() => setShowMobileMenu(prev => !prev)}
          >
            {showMobileMenu ? <X size={20} /> : <Menu size={20} />}
          </button>
          <SiteHeaderActions
            currentUser={currentUser ?? null}
            onLogout={onLogout}
            onOpenDashboard={onOpenDashboard}
            onAuthRequest={onLoginRequest}
          />
        </div>
      </header>

      {/* Mobile nav dropdown */}
      {showMobileMenu && (
        <div className="landing-mobile-nav" id="mobile-nav" ref={mobileMenuRef} role="dialog" aria-label="Navigation menu">
          <nav aria-label="Mobile navigation">
            <a href="#possibilities" onClick={() => setShowMobileMenu(false)}>Examples</a>
            <a href="/gallery">Gallery</a>
            <a href="#how-it-works" onClick={() => setShowMobileMenu(false)}>How it works</a>
            <a href="#questions" onClick={() => setShowMobileMenu(false)}>FAQs</a>
            <a href="/guides/build-an-app-with-ai">Build guide</a>
            <a href="/about">About</a>
          </nav>
        </div>
      )}

      {/* Hero */}
      <main className="landing-main-content" id="main-content" tabIndex={-1}>
        <section className="landing-hero-shell" aria-labelledby="hero-heading">
          <div className="landing-hero-copy">
            <p className="landing-hero-eyebrow"><Zap size={12} aria-hidden="true" /> AI app builder for small businesses</p>
            <h1 id="hero-heading">Build the tools<br /><span>your business needs.</span></h1>
            <p className="landing-hero-description">Describe what you want, watch it come to life, and publish it — all from one workspace. No coding required.</p>
            <form className="landing-prompt-box" id="start-building" onSubmit={handlePromptSubmit}>
              <label htmlFor="app-idea" className="landing-input-label">Describe your app</label>
              <textarea
                id="app-idea"
                ref={textareaRef}
                className="landing-prompt-textarea"
                placeholder="Describe what you need to build…"
                aria-describedby="prompt-help"
                value={promptText}
                onChange={event => setPromptText(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
              />
              <div className="landing-prompt-actions">
                <span id="prompt-help"><Check size={13} aria-hidden="true" /> Free to start &nbsp;·&nbsp; No coding required</span>
                <button
                  type="submit"
                  className="landing-submit-btn"
                  disabled={!promptText.trim() || creatingProject}
                  title="Start building (Enter)"
                >
                  <span>{creatingProject ? 'Creating…' : 'Start building'}</span><ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </form>
          </div>
          <LandingShowcase onUsePrompt={handleExamplePrompt} />
        </section>

        <section className="studio-ideas-section" id="possibilities" aria-labelledby="ideas-heading">
          <div className="studio-section-intro">
            <div><p className="studio-section-label">A LITTLE INSPIRATION</p><h2 id="ideas-heading">What will you make first?</h2></div>
            <p>Pick an idea to fill in your first prompt.<br />{' '}Change anything before you build.</p>
          </div>
          <div className="studio-idea-list">
            {BUSINESS_APPS.slice(0, 4).map((suggestion, index) => {
              const Icon = IDEA_ICONS[index] ?? ShoppingCart;
              return (
                <button key={suggestion.label} type="button" className={`studio-idea-card idea-tone-${index}`} onClick={() => handleExamplePrompt(suggestion.prompt)}>
                  <span className="studio-idea-icon"><Icon size={24} strokeWidth={1.5} /></span>
                  <strong>{suggestion.label}</strong>
                  <span>{suggestion.detail}</span>
                  <ArrowUpRight className="studio-idea-arrow" size={18} />
                </button>
              );
            })}
          </div>
        </section>

        <section className="studio-workflow-section" id="how-it-works" aria-labelledby="workflow-heading">
          <div className="studio-workflow-intro">
            <p className="studio-section-label">THE WAY FROM IDEA TO APP</p>
            <h2 id="workflow-heading">Describe.<br />Refine. Publish.</h2>
            <p>You set the direction, make the decisions, and stay close to what you're creating.</p>
            <a href="#start-building" onClick={focusComposer}>Start building <ArrowRight size={16} /></a>
          </div>
          <ol className="landing-how-it-works" aria-label="How it works" role="list">
            {HOW_IT_WORKS.map(item => (
              <li key={item.step} className="landing-how-card">
                <span className="landing-how-step" aria-hidden="true">{item.step}</span>
                <div><h3 className="landing-how-title">{item.title}</h3><p className="landing-how-detail">{item.detail}</p></div>
              </li>
            ))}
          </ol>
          <a href="/guides/build-an-app-with-ai" className="landing-guide-link">How to build an app with AI</a>
        </section>

        <section className="studio-proof-section" aria-labelledby="proof-heading">
          <div className="studio-proof-intro">
            <p className="studio-section-label">THE NETWORK UNDER YOUR APP</p>
            <h2 id="proof-heading">Fast for everyone who opens it.</h2>
            <p>Published apps run on Cloudflare's global edge network, the same infrastructure BrainHalf itself is served from.</p>
          </div>
          <div className="studio-proof-grid">
            <div className="studio-proof-stat">
              <strong>~50 ms</strong>
              <span>from 95% of the world's Internet-connected population</span>
            </div>
            <div className="studio-proof-stat">
              <strong>300+</strong>
              <span>cities serving your published app, close to every visitor</span>
            </div>
            <div className="studio-proof-stat">
              <strong>1</strong>
              <span>isolated database per app — your records are never mixed with another project's</span>
            </div>
          </div>
          <p className="studio-proof-source">Network figures: <a href="https://www.cloudflare.com/network/" target="_blank" rel="noopener noreferrer">Cloudflare's global network <ArrowUpRight size={12} aria-hidden="true" /></a></p>
        </section>

        <section className="studio-faq-section" id="questions" aria-labelledby="faq-heading">
          <div>
            <p className="studio-section-label">GOOD TO KNOW</p>
            <h2 id="faq-heading">Before you begin.</h2>
            <p className="studio-content-updated">Updated <time dateTime={HOME_MODIFIED}>{formatContentDate(HOME_MODIFIED)}</time></p>
          </div>
          <div className="studio-faq-list">
            {HOME_FAQS.map((faq, index) => (
              <details key={faq.id} id={faq.id} open={index === 0}>
                <summary><h3>{faq.question}<Plus size={17} aria-hidden="true" /></h3></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <nav className="landing-usecase-links" aria-label="Build guides by use case">
          <span>Start from a guide</span>
          <a href="/use-cases/ai-inventory-app-builder">Inventory apps</a>
          <a href="/use-cases/book-inventory-app-builder">Book inventory</a>
          <a href="/use-cases/warehouse-inventory-app-builder">Warehouse stock control</a>
          <a href="/use-cases/equipment-asset-inventory-app-builder">Equipment &amp; assets</a>
          <a href="/use-cases/personal-inventory-app-builder">Personal inventory</a>
          <a href="/use-cases/ai-dashboard-builder">Dashboards</a>
          <a href="/use-cases/customer-dashboard-builder">Customer portals</a>
          <a href="/use-cases/ai-website-builder">Websites</a>
        </nav>

        <section className="studio-closing" aria-labelledby="closing-heading">
          <div>
            <p className="studio-section-label">READY WHEN YOU ARE</p>
            <h2 id="closing-heading">Give your idea<br />a real home.</h2>
            <p>Start with a sentence. See where it takes you.</p>
          </div>
          <a href="#start-building" className="studio-closing-link" onClick={focusComposer}>Build your app <ArrowUpRight size={18} /></a>
          <div className="studio-closing-mark" aria-hidden="true"><BrainHalfLogo size={240} color="currentColor" /></div>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingPage;
