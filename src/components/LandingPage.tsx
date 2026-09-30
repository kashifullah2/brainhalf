import { BUSINESS_APPS } from '../lib/business-apps';
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowRight,
  Plus,
  ArrowUpRight,
  BarChart3,
  LayoutGrid,
  ShoppingCart,
  Check,
  Layers,
  Rocket,
  Globe,
  KeyRound,
  Menu,
  X,
  Tractor,
} from 'lucide-react';
import { BrainHalfLogo } from './BrainHalfLogo';
import LandingFooter from './LandingFooter';
import LandingShowcase from './LandingShowcase';
import SiteHeaderActions from './SiteHeaderActions';
import { shouldCloseMenuOnPointerDown } from './MobileNav';
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

const IDEA_ICONS = [ShoppingCart, Tractor, LayoutGrid, BarChart3];

const AUDIENCES = [
  'Retail shops',
  'Cafés & restaurants',
  'Farms',
  'Clinics',
  'Warehouses',
  'Schools',
  'Freelancers',
  'Nonprofits',
];

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Describe it in plain words',
    detail: 'One job is enough to start: tracking stock, taking bookings, or following up with customers. Write it the way you would explain it to a person.',
  },
  {
    step: '02',
    title: 'Refine it by chatting',
    detail: 'Click through your app, try things out, and ask for changes in plain language. The screens, the data, and the logic all update together.',
  },
  {
    step: '03',
    title: 'Share it with the world',
    detail: 'We check that everything works, then your app gets its own web address to share with customers.',
  },
];

const FEATURES = [
  {
    icon: Layers,
    title: 'Screens and saved information, together',
    detail: 'Everything is built from your description, so buttons actually save and load your information.',
  },
  {
    icon: Rocket,
    title: 'Checked before it goes live',
    detail: 'Before your app is shared, we check that it works. If something is wrong, nothing is shared until it is fixed — and we tell you what happened in plain words.',
  },
  {
    icon: KeyRound,
    title: 'Sign-in for your customers',
    detail: 'Let people sign in with Google or email. Each person only sees their own information.',
  },
  {
    icon: Globe,
    title: 'Your own web address',
    detail: 'Your app gets its own address on the web to share with customers. Already have a website name? You can use that too.',
  },
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
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

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
      const target = e.target as Node;
      const insideMenu = mobileMenuRef.current?.contains(target) ?? false;
      const insideToggle = mobileMenuButtonRef.current?.contains(target) ?? false;
      if (shouldCloseMenuOnPointerDown(insideMenu, insideToggle)) {
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
          <a href="#how-it-works">How it works</a>
          <a href="#examples">Examples</a>
          <a href="#features">Features</a>
          <a href="#questions">FAQs</a>
          <a href="/gallery">Gallery</a>
        </nav>

        <div className="landing-header-right">
          <button
            type="button"
            ref={mobileMenuButtonRef}
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
            <a href="#how-it-works" onClick={() => setShowMobileMenu(false)}>How it works</a>
            <a href="#examples" onClick={() => setShowMobileMenu(false)}>Examples</a>
            <a href="#features" onClick={() => setShowMobileMenu(false)}>Features</a>
            <a href="#questions" onClick={() => setShowMobileMenu(false)}>FAQs</a>
            <a href="/gallery">Gallery</a>
            <a href="/guides/build-an-app-with-ai">Build guide</a>
            <a href="/about">About</a>
          </nav>
        </div>
      )}

      {/* Hero */}
      <main className="landing-main-content" id="main-content" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="hero-heading">
          <div className="landing-hero-copy">
            <p className="landing-hero-eyebrow"><Check size={12} aria-hidden="true" /> AI app builder for small businesses</p>
            <h1 id="hero-heading">From a sentence<br />to working software.</h1>
            <p className="landing-hero-description">
              Tell us what your business needs, in your own words. BrainHalf builds the app
              and puts it on the web for you — then refines it with you, in plain words.
              No coding, no technical skills needed.
            </p>
            <form className="landing-prompt-box" id="start-building" onSubmit={handlePromptSubmit}>
              <label htmlFor="app-idea" className="landing-input-label">Describe your app</label>
              <textarea
                id="app-idea"
                ref={textareaRef}
                className="landing-prompt-textarea"
                placeholder="A crop tracker for my wheat farm, with harvest reminders…"
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
          <figure className="landing-hero-shot">
            <div className="landing-browser-frame">
              <div className="landing-browser-bar" aria-hidden="true">
                <span className="landing-browser-dots"><i /><i /><i /></span>
                <span className="landing-browser-url">The BrainHalf workspace</span>
              </div>
              <img
                src="/images/landing-workspace.png"
                alt="The BrainHalf workspace: a chat with the AI builder on the left and the app being built on the right"
                width={1440}
                height={684}
              />
            </div>
            <figcaption>The real workspace — describe on the left, watch your app take shape on the right.</figcaption>
          </figure>
        </section>

        {/* Who it's for */}
        <section className="landing-audience" aria-labelledby="audience-heading">
          <p className="studio-section-label">Made for real businesses</p>
          <h2 id="audience-heading">If you run it on spreadsheets and memory, it can be software.</h2>
          <ul className="landing-audience-list" aria-label="Businesses BrainHalf is built for">
            {AUDIENCES.map(audience => <li key={audience}>{audience}</li>)}
          </ul>
        </section>

        {/* How it works */}
        <section className="landing-workflow" id="how-it-works" aria-labelledby="workflow-heading">
          <div className="landing-section-intro">
            <p className="studio-section-label">How it works</p>
            <h2 id="workflow-heading">Describe. Refine. Publish.</h2>
            <p className="landing-section-lede">You set the direction and make the decisions. BrainHalf does the building.</p>
          </div>
          <ol className="landing-steps" aria-label="How it works" role="list">
            {HOW_IT_WORKS.map(item => (
              <li key={item.step} className="landing-step">
                <span className="landing-step-number" aria-hidden="true">{item.step}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <a href="#start-building" className="landing-text-cta" onClick={focusComposer}>
            Start with your first sentence <ArrowRight size={16} aria-hidden="true" />
          </a>
        </section>

        {/* Examples */}
        <section className="landing-examples" id="examples" aria-labelledby="examples-heading">
          <div className="landing-section-intro">
            <p className="studio-section-label">What you get</p>
            <h2 id="examples-heading">Real apps, not mockups.</h2>
            <p className="landing-section-lede">These are the kinds of working tools people build. Click through them — every button does something.</p>
          </div>
          <LandingShowcase />
          <div className="landing-idea-row" aria-label="More starting ideas">
            {BUSINESS_APPS.slice(0, 4).map((suggestion, index) => {
              const Icon = IDEA_ICONS[index] ?? ShoppingCart;
              return (
                <button key={suggestion.label} type="button" className="landing-idea-chip" onClick={() => handleExamplePrompt(suggestion.prompt)}>
                  <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span><strong>{suggestion.label}</strong><small>{suggestion.detail}</small></span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <p className="landing-idea-hint">Pick one to fill in your first prompt — change anything before you build.</p>
        </section>

        {/* Features */}
        <section className="landing-features" id="features" aria-labelledby="features-heading">
          <div className="landing-section-intro">
            <p className="studio-section-label">Included</p>
            <h2 id="features-heading">Everything your app needs, built in.</h2>
            <p className="landing-section-lede">No plugins to wire up, no servers to rent, no database to configure. It is all part of the workspace.</p>
          </div>
          <ul className="landing-feature-grid" role="list">
            {FEATURES.map(feature => (
              <li key={feature.title} className="landing-feature-card">
                <span className="landing-feature-icon"><feature.icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
                <h3>{feature.title}</h3>
                <p>{feature.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* FAQ */}
        <section className="studio-faq-section" id="questions" aria-labelledby="faq-heading">
          <div>
            <p className="studio-section-label">Questions</p>
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

        {/* Closing */}
        <section className="studio-closing" aria-labelledby="closing-heading">
          <div>
            <h2 id="closing-heading">Your business,<br />running on software you described.</h2>
            <p>Start with a sentence. See where it takes you.</p>
          </div>
          <a href="#start-building" className="studio-closing-link" onClick={focusComposer}>Build your app <ArrowUpRight size={18} /></a>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingPage;
