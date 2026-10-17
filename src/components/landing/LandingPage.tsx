/* LandingPage.tsx */
import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  Check,
  ClipboardList,
  Database,
  Globe2,
  Package,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import SiteNavbar from '../SiteNavbar';
import LandingFooter from './LandingFooter';
import { HOME_FAQS } from '../../seo/content';
import './landing-tokens.css';
import './LandingPage.css';
import '../PublicPage.css';

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Content ─────────────────────────────────────────────────────────────── */

const IDEAS = [
  {
    id: 'inventory',
    label: 'Inventory',
    summary: 'Know what is in stock and what needs ordering.',
    domain: 'cornercafe.brainhalf.com',
    icon: Package,
    prompt: 'Build an inventory tool for my shop with products, stock counts, and low-stock alerts.',
    preview: [
      { label: 'Coffee beans', value: '24 in stock', tone: 'ok' },
      { label: 'Oat milk', value: 'Low stock', tone: 'warn' },
      { label: 'Paper cups', value: '12 in stock', tone: 'ok' },
    ],
  },
  {
    id: 'booking',
    label: 'Bookings',
    summary: 'Let customers pick a free slot, with no double bookings.',
    domain: 'thursdaysalon.brainhalf.com',
    icon: CalendarCheck,
    prompt: 'Build an appointment booking app for my salon where customers pick a free time slot.',
    preview: [
      { label: '10:00', value: 'Booked', tone: 'mute' },
      { label: '11:00', value: 'Free', tone: 'ok' },
      { label: '14:00', value: 'Booked', tone: 'mute' },
    ],
  },
  {
    id: 'crm',
    label: 'Follow-ups',
    summary: 'Keep each customer and their next step together.',
    domain: 'valleyharvest.brainhalf.com',
    icon: Users,
    prompt: 'Build a simple customer list to track enquiries, notes, and who to follow up with this week.',
    preview: [
      { label: 'Olive Studio', value: 'Send quote', tone: 'warn' },
      { label: 'Northside Café', value: 'Call Friday', tone: 'mute' },
      { label: 'Paper House', value: 'Won', tone: 'ok' },
    ],
  },
  {
    id: 'tasks',
    label: 'Task board',
    summary: 'Turn the week into a clear list of what is done.',
    domain: 'atelierboutique.brainhalf.com',
    icon: ClipboardList,
    prompt: 'Build a clean weekly task board for my shop with To do and Done columns.',
    preview: [
      { label: 'Count the stockroom', value: 'To do', tone: 'mute' },
      { label: 'Call Friday customers', value: 'To do', tone: 'mute' },
      { label: 'Prepare café delivery', value: 'Done', tone: 'ok' },
    ],
  },
] as const;

const TICKER = [
  'Stock & inventory',
  'Bookings',
  'Customer follow-ups',
  'Team task boards',
  'Private records',
  'Client portals',
  'Low-stock alerts',
  'Sign-in & roles',
  'Edit by chatting',
];

const STEPS = [
  {
    title: 'Describe it in plain words',
    text: 'One job is enough to start: stock, bookings, or customer follow-ups. Write it the way you would explain it to a person.',
    receipt: 'Booking calendar · Reminders · Own database',
  },
  {
    title: 'Refine it by chatting',
    text: 'Try things out and ask for changes in plain language. Screens, saved information, and sign-in update together.',
    receipt: '+ Price list added. Want to change any prices?',
  },
  {
    title: 'Share it with the world',
    text: 'We check that everything works before anything goes live, and tell you in plain words if something needs fixing.',
    receipt: 'yourshop.brainhalf.com · Live',
  },
];

const FEATURES = [
  { title: 'Describe it', text: 'One sentence about the job. No wireframes, no technical plan.', spec: 'Input: plain words' },
  { title: 'Live preview', text: 'Watch the app take shape as it is built, and click through it any time.', spec: 'Preview: instant' },
  { title: 'Edit by chatting', text: 'Ask for changes in plain words. Screens, data, and sign-in update together.', spec: 'Changes: in conversation' },
  { title: 'Your own database', text: 'Records are saved properly. Not in a spreadsheet, and not in memory.', spec: 'Storage: private database' },
  { title: 'Customer sign-in', text: 'Customers sign in with Google or email. Their records stay private to them.', spec: 'Access: role-based' },
  { title: 'Your own web address', text: 'Checked before it goes live, then shared at an address your customers can visit.', spec: 'Domain: yourshop.brainhalf.com' },
];

const TRUST = [
  {
    icon: Database,
    title: 'Your data stays yours',
    text: "Records live in your app's own database, private to your sign-in. Nothing is shared, sold, or mixed with anyone else's.",
  },
  {
    icon: ShieldCheck,
    title: 'Checked before it goes live',
    text: 'Every app is verified before it can be published. If something needs fixing, you get plain words, not an error code.',
  },
  {
    icon: Globe2,
    title: 'Your own address',
    text: 'Take it offline any time. Your data stays put.',
  },
];

const HERO_STATS: [string, string][] = [
  ['Minutes', 'from idea to working app'],
  ['Zero', 'code required'],
  ['Built in', 'database, sign-in, and hosting'],
];

/* ── Shared pieces ───────────────────────────────────────────────────────── */

function ScrollProgress() {
  const fillRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${max > 0 ? el.scrollTop / max : 0})`;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div className="lp-progress" aria-hidden="true">
      <span className="lp-progress-fill" ref={fillRef} />
    </div>
  );
}

function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: React.ReactNode; lede?: string }) {
  return (
    <header className="sec-head">
      <p className="kicker">{eyebrow}</p>
      <h2>{title}</h2>
      {lede && <p className="sec-lede">{lede}</p>}
    </header>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

interface HeroProps {
  promptText: string;
  onPromptTextChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  creatingProject: boolean;
  onPromptSubmit: (e?: React.FormEvent) => void;
  onPromptKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPickIdea: (prompt: string) => void;
  showHint?: boolean;
}

function LandingHero({
  promptText,
  onPromptTextChange,
  textareaRef,
  creatingProject,
  onPromptSubmit,
  onPromptKeyDown,
  onPickIdea,
  showHint,
}: HeroProps) {
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [promptText, textareaRef]);

  return (
    <section className="lp-hero" aria-labelledby="hero-heading">
      <div className="hero-copy">
        <p className="kicker is-center">Plain-words software</p>

        <h1 className="hero-title" id="hero-heading">
          <span className="hl">Describe it.</span>
          <span className="hl">
            Watch it <em>get built.</em>
          </span>
        </h1>

        <p className="hero-lede">
          Tell BrainHalf what your business needs to track. Your app takes shape in front of you. Click every
          button, then share it at your own web address.
        </p>

        <form className="composer" id="start-building" onSubmit={onPromptSubmit}>
          <div className="composer-top">
            <label htmlFor="app-idea">01 · Your app idea</label>
            <span>
              <kbd>Enter</kbd> build · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
            </span>
          </div>
          <textarea
            id="app-idea"
            ref={textareaRef}
            className="composer-input"
            placeholder="A booking page for my barbershop, with reminders…"
            aria-describedby="prompt-help"
            value={promptText}
            onChange={e => { onPromptTextChange(e.target.value); }}
            onKeyDown={onPromptKeyDown}
            rows={3}
            maxLength={4000}
          />
          <div className="composer-foot">
            <span id="prompt-help" className="composer-note">
              <Check size={13} aria-hidden="true" /> Free to start · No coding needed
            </span>
            <button type="submit" className="btn-primary" disabled={creatingProject}>
              {creatingProject ? 'Creating…' : 'Start building'}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
          {showHint && !promptText.trim() && (
            <p className="composer-hint">Describe what your app should do — even one sentence is enough.</p>
          )}
        </form>

        <div className="starters" role="group" aria-label="Quick starts">
          <span className="starters-label">Or try</span>
          {IDEAS.map(idea => (
            <button key={idea.id} type="button" className="starter" onClick={() => onPickIdea(idea.prompt)}>
              {idea.label}
            </button>
          ))}
        </div>
      </div>

      <dl className="hero-stats">
        {HERO_STATS.map(([value, label]) => (
          <div key={label}>
            <dt>{value}</dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ── Ticker ──────────────────────────────────────────────────────────────── */

function IdeaMarquee() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="ticker" aria-hidden="true">
      <ul className="ticker-track">
        {items.map((label, i) => (
          <li key={`${label}-${i}`}>{label}</li>
        ))}
      </ul>
    </div>
  );
}

/* ── Examples ────────────────────────────────────────────────────────────── */

function ExamplesSection({ onUseIdea }: { onUseIdea: (prompt: string) => void }) {
  return (
    <section className="lp-section" id="examples" aria-labelledby="examples-heading">
      <SectionHead
        eyebrow="Examples"
        title={
          <span id="examples-heading">
            Start from <em>a real idea.</em>
          </span>
        }
        lede="Pick one and BrainHalf fills in the first sentence. Edit it, or write your own from scratch."
      />

      <ul className="examples-grid">
        {IDEAS.map(idea => {
          const Icon = idea.icon;
          return (
            <li key={idea.id}>
              <article className="example-card">
                <div className="example-top">
                  <span className="example-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                </div>

                <div className="example-body">
                  <h3>{idea.label}</h3>
                  <span className="example-domain">{idea.domain}</span>
                  <p>{idea.summary}</p>
                </div>

                <ul className="example-preview" aria-label={`${idea.label} sample data`}>
                  {idea.preview.map(row => (
                    <li key={row.label}>
                      <span>{row.label}</span>
                      <span className={`pill is-${row.tone}`}>{row.value}</span>
                    </li>
                  ))}
                </ul>

                <div className="example-foot">
                  <span className="example-note">Sample data</span>
                  <button
                    type="button"
                    className="example-use"
                    aria-label={`Use the ${idea.label} idea`}
                    onClick={() => onUseIdea(idea.prompt)}
                  >
                    Use this idea <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <p className="examples-note">
        Made for shops, cafés, farms, clinics, warehouses, schools, freelancers, and nonprofits.
      </p>
    </section>
  );
}

/* ── How it works ────────────────────────────────────────────────────────── */

function HowItWorks() {
  return (
    <section className="lp-section" id="how-it-works" aria-labelledby="hiw-heading">
      <SectionHead
        eyebrow="How it works"
        title={
          <span id="hiw-heading">
            Three steps. <em>No code.</em>
          </span>
        }
        lede="You set the direction and make the decisions. BrainHalf does the building."
      />
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li className="step" key={step.title}>
            <span className="step-num" aria-hidden="true">
              0{i + 1}
            </span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
            <div className="step-receipt">{step.receipt}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── Features ────────────────────────────────────────────────────────────── */

function BentoGrid() {
  return (
    <section className="lp-section" aria-labelledby="features-heading">
      <SectionHead
        eyebrow="Everything included"
        title={
          <span id="features-heading">
            One workspace, <em>start to share.</em>
          </span>
        }
        lede="The whole journey lives in one place. Nothing to stitch together, nothing to install."
      />
      <div className="features">
        {FEATURES.map((f, i) => (
          <article className="feature" key={f.title}>
            <span className="feature-idx">{String(i + 1).padStart(2, '0')}</span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
            <span className="feature-spec">{f.spec}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ── Trust ───────────────────────────────────────────────────────────────── */

function TrustSection() {
  return (
    <section className="lp-section" aria-labelledby="trust-heading">
      <div className="trust">
        <h2 id="trust-heading" className="trust-quote">
          Software you can&apos;t trust is worse than none. <em>Here is what you can count on.</em>
        </h2>
        <ul className="trust-list">
          {TRUST.map(item => {
            const Icon = item.icon;
            return (
              <li key={item.title}>
                <Icon size={20} aria-hidden="true" />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ── FAQ ─────────────────────────────────────────────────────────────────── */

function FaqSection() {
  return (
    <section className="lp-section faq" id="questions" aria-labelledby="faq-heading">
      <div>
        <p className="kicker">Questions</p>
        <h2 id="faq-heading">
          Before you <em>begin.</em>
        </h2>
        <p className="sec-lede">Straight answers, no sales talk.</p>
        <a className="faq-help" href="mailto:support@brainhalf.com">
          Still unsure? Ask us directly <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </div>
      <div>
        {HOME_FAQS.map((faq, i) => (
          <details key={faq.id} id={faq.id} open={i === 0}>
            <summary>
              <h3>{faq.question}</h3>
              <span className="faq-icon" aria-hidden="true">
                <Plus size={14} />
              </span>
            </summary>
            <div className="faq-a">
              <p>{faq.answer}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ── Closing CTA ─────────────────────────────────────────────────────────── */

function FinalCta({ onStartBuilding }: { onStartBuilding: (event?: React.MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <section className="cta" aria-labelledby="final-cta-heading">
      <p className="kicker is-light">Start free</p>
      <h2 id="final-cta-heading">
        Your business, running on software <em>you described.</em>
      </h2>
      <p>Start with a sentence. See where it takes you.</p>
      <div className="cta-actions">
        <a href="#start-building" className="btn-accent" onClick={onStartBuilding}>
          Start building <ArrowRight size={16} aria-hidden="true" />
        </a>
        <a href="/gallery" className="btn-outline-dark">
          Browse the gallery <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

interface LandingPageProps {
  onOpenProject?: (projectId: string) => void;
  onSubmitInitialPrompt: (prompt: string) => void;
  creatingProject?: boolean;
  currentUser?: { email?: string; name?: string } | null;
  onLogout?: () => void | Promise<void>;
  onLoginRequest?: (mode?: 'login' | 'signup') => void;
  onOpenDashboard?: () => void;
}

const NAV_LINKS = [
  { href: '#examples', label: 'Examples' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#questions', label: 'FAQ' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/pricing', label: 'Pricing' },
];

export {
  LandingHero,
  ExamplesSection,
  HowItWorks,
  BentoGrid,
  TrustSection,
  FaqSection,
  FinalCta,
  IdeaMarquee,
  ScrollProgress,
};

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
    document.body.classList.add('is-landing');
    return () => { document.body.classList.remove('is-landing'); };
  }, []);

  const [showHint, setShowHint] = useState(false);

  const handlePromptSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (creatingProject) return;
    const trimmed = promptText.trim();
    if (!trimmed) {
      textareaRef.current?.focus();
      setShowHint(true);
      return;
    }
    setShowHint(false);
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
      behavior: prefersReduced() ? 'auto' : 'smooth',
      block: 'center',
    });
  };

  const handleExamplePrompt = (prompt: string) => {
    setPromptText(prompt);
    focusComposer();
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' });
  };

  return (
    <div className="landing-container">
      <a className="studio-skip-link" href="#main-content">
        Skip to content
      </a>

      <ScrollProgress />

      <SiteNavbar
        links={NAV_LINKS}
        currentUser={currentUser ?? null}
        onLogout={onLogout}
        onOpenDashboard={onOpenDashboard}
        onAuthRequest={onLoginRequest}
        onBrandClick={scrollToTop}
      />

      <main className="landing-main-content" id="main-content" tabIndex={-1}>
        <LandingHero
          promptText={promptText}
          onPromptTextChange={setPromptText}
          textareaRef={textareaRef}
          creatingProject={creatingProject}
          onPromptSubmit={handlePromptSubmit}
          onPromptKeyDown={handleKeyDown}
          onPickIdea={handleExamplePrompt}
          showHint={showHint}
        />

        <IdeaMarquee />
        <ExamplesSection onUseIdea={handleExamplePrompt} />
        <HowItWorks />
        <BentoGrid />
        <TrustSection />
        <FaqSection />
        <FinalCta onStartBuilding={focusComposer} />
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingPage;
