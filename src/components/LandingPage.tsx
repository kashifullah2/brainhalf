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
  Tractor,
} from 'lucide-react';
import SiteNavbar from './SiteNavbar';
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

const NAV_LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#examples', label: 'Examples' },
  { href: '#questions', label: 'FAQs' },
  { href: '/gallery', label: 'Gallery' },
];

const IDEA_ICONS = [ShoppingCart, Tractor, LayoutGrid, BarChart3];

const AUDIENCES =
  'retail shops, cafés & restaurants, farms, clinics, warehouses, schools, freelancers, and nonprofits';

const HOW_IT_WORKS = [
  {
    title: 'Describe it in plain words',
    detail:
      'One job is enough to start: tracking stock, taking bookings, or following up with customers. Write it the way you would explain it to a person.',
  },
  {
    title: 'Refine it by chatting',
    detail:
      'Click through your app, try things out, and ask for changes in plain language. The screens, the saved information, and sign-in all update together.',
  },
  {
    title: 'Share it with the world',
    detail:
      'We check that everything works before anything goes live — and tell you in plain words if something needs fixing. Then your app gets its own web address to share with customers.',
  },
];

const INCLUDED = [
  'Screens and saved information, built together',
  'Checked before it goes live',
  'Customer sign-in with Google or email',
  'Your own web address',
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [promptText]);

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

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return (
    <div className="landing-container">
      <a className="studio-skip-link" href="#main-content">Skip to content</a>

      <SiteNavbar
        links={NAV_LINKS}
        currentUser={currentUser ?? null}
        onLogout={onLogout}
        onOpenDashboard={onOpenDashboard}
        onAuthRequest={onLoginRequest}
        onBrandClick={scrollToTop}
      />

      {/* Hero */}
      <main className="landing-main-content" id="main-content" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="hero-heading">
          <div className="landing-hero-copy">
            <p className="landing-hero-eyebrow">
              <Check size={13} aria-hidden="true" /> AI app builder for small businesses
            </p>
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

        {/* Examples — real apps, and who they're for */}
        <section className="landing-examples" id="examples" aria-labelledby="examples-heading">
          <div className="landing-section-intro">
            <p className="landing-kicker">What you get</p>
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
          <p className="landing-audience-line">
            Made for {AUDIENCES}. If you run it on spreadsheets and memory, it can be software.
          </p>
        </section>

        {/* How it works — steps and everything included */}
        <section className="landing-workflow" id="how-it-works" aria-labelledby="workflow-heading">
          <div className="landing-section-intro">
            <p className="landing-kicker">How it works</p>
            <h2 id="workflow-heading">Describe. Refine. Share.</h2>
            <p className="landing-section-lede">You set the direction and make the decisions. BrainHalf does the building.</p>
          </div>
          <ol className="landing-steps" aria-label="How it works" role="list">
            {HOW_IT_WORKS.map((item, index) => (
              <li key={item.title} className="landing-step">
                <span className="landing-step-num" aria-hidden="true">{index + 1}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <ul className="landing-included" aria-label="Included with every app">
            {INCLUDED.map(item => (
              <li key={item}><Check size={15} aria-hidden="true" />{item}</li>
            ))}
          </ul>
          <a href="#start-building" className="landing-text-cta" onClick={focusComposer}>
            Start with your first sentence <ArrowRight size={16} aria-hidden="true" />
          </a>
        </section>

        {/* FAQ */}
        <section className="studio-faq-section" id="questions" aria-labelledby="faq-heading">
          <div>
            <p className="landing-kicker">Questions</p>
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
        <section className="landing-closing" aria-labelledby="closing-heading">
          <div>
            <p className="landing-kicker landing-kicker-on-dark">Start free</p>
            <h2 id="closing-heading">Your business,<br />running on software you described.</h2>
            <p>Start with a sentence. See where it takes you.</p>
          </div>
          <a href="#start-building" className="landing-closing-link" onClick={focusComposer}>Build your app <ArrowUpRight size={18} /></a>
        </section>
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingPage;
