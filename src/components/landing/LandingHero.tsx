import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  Check,
  ClipboardList,
  CornerDownLeft,
  Globe2,
  Layers,
  Package,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import './LandingHero.css';

interface LandingHeroProps {
  promptText: string;
  onPromptTextChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  creatingProject: boolean;
  onPromptSubmit: (e?: React.FormEvent) => void;
  onPromptKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocusComposer: (event?: React.MouseEvent<HTMLAnchorElement>) => void;
}

const TYPING_PROMPTS = [
  'A crop tracker for my wheat farm, with harvest reminders…',
  'A booking app for my salon, with automated SMS reminders…',
  'An inventory tool for my boutique, with low-stock alerts…',
  'A lightweight client portal to track enquiries and invoices…',
];

const STATIC_PLACEHOLDER = 'Describe your business tool in plain words…';

const STARTER_IDEAS = [
  {
    id: 'inventory',
    code: '01',
    label: 'Inventory tracker',
    tag: 'Retail & Ops',
    icon: Package,
    prompt: 'Build an inventory tool for my shop with products, stock counts, and low-stock alerts.',
  },
  {
    id: 'booking',
    code: '02',
    label: 'Booking studio',
    tag: 'Services',
    icon: CalendarCheck,
    prompt: 'Build an appointment booking app for my salon where customers pick a free time slot.',
  },
  {
    id: 'crm',
    code: '03',
    label: 'Client follow-ups',
    tag: 'Sales CRM',
    icon: Users,
    prompt: 'Build a simple customer list to track enquiries, notes, and who to follow up with this week.',
  },
  {
    id: 'tasks',
    code: '04',
    label: 'Team workflow board',
    tag: 'Internal Tool',
    icon: ClipboardList,
    prompt: 'Build a clean weekly task board for my shop with To do, Doing, and Done columns.',
  },
] as const;

export function tiltForCursor(px: number, py: number): { tiltX: string; tiltY: string } {
  const clamp4 = (v: number) => Math.max(-4, Math.min(4, v));
  return {
    tiltX: `${clamp4(-py * 8).toFixed(2)}deg`,
    tiltY: `${clamp4(px * 8).toFixed(2)}deg`,
  };
}

function useTypingPlaceholder(active: boolean): string {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!active) {
      setTyped('');
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(TYPING_PROMPTS[0]);
      return;
    }
    let promptIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let timer = 0;
    const tick = () => {
      const current = TYPING_PROMPTS[promptIndex];
      if (!deleting) {
        charIndex += 1;
        setTyped(current.slice(0, charIndex));
        if (charIndex >= current.length) {
          deleting = true;
          timer = window.setTimeout(tick, 2100);
          return;
        }
        timer = window.setTimeout(tick, 28 + Math.random() * 40);
      } else {
        charIndex = Math.max(0, charIndex - 4);
        setTyped(current.slice(0, charIndex));
        if (charIndex === 0) {
          deleting = false;
          promptIndex = (promptIndex + 1) % TYPING_PROMPTS.length;
          timer = window.setTimeout(tick, 450);
          return;
        }
        timer = window.setTimeout(tick, 15);
      }
    };
    timer = window.setTimeout(tick, 600);
    return () => window.clearTimeout(timer);
  }, [active]);
  return typed;
}

export const LandingHero: React.FC<LandingHeroProps> = ({
  promptText,
  onPromptTextChange,
  textareaRef,
  creatingProject,
  onPromptSubmit,
  onPromptKeyDown,
  onFocusComposer,
}) => {
  const [composerFocused, setComposerFocused] = useState(false);
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null);
  const [tilt, setTilt] = useState<{ tiltX: string; tiltY: string }>({
    tiltX: '0.00deg',
    tiltY: '0.00deg',
  });

  const typedPlaceholder = useTypingPlaceholder(promptText === '' && !composerFocused);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [promptText, textareaRef]);

  const handleStageMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt(tiltForCursor(px, py));
  };

  const handleStageMouseLeave = () => {
    setTilt({ tiltX: '0.00deg', tiltY: '0.00deg' });
  };

  const handlePickIdea = (id: string, prompt: string) => {
    setActiveIdeaId(id);
    onPromptTextChange(prompt);
    textareaRef.current?.focus();
  };

  return (
    <section className="landing-hero-redesign" aria-labelledby="hero-heading">
      {/* Architectural Background Grid & Ambient Glow */}
      <div className="hero-ambient-canvas" aria-hidden="true">
        <div className="hero-grid-pattern" />
        <div className="hero-glow-orb hero-glow-orb-primary" />
        <div className="hero-glow-orb hero-glow-orb-warm" />
      </div>

      <div className="hero-inner">
        {/* Editorial Kicker & Spec Pill */}
        <div className="hero-copy">
          <div className="hero-kicker-group">
            <span className="hero-kicker-badge">
              <Sparkles size={12} aria-hidden="true" />
              <span>STUDIO 2.0</span>
            </span>
            <p className="hero-kicker">Software for your business, in plain words</p>
          </div>

          <h1 id="hero-heading">
            Describe it.{' '}
            <span className="hero-gradient-text">
              We’ll architect it.
              <svg
                className="hero-headline-scribble"
                viewBox="0 0 280 18"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3 13.5C72 4.5 188 2.5 277 11.5"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h1>

          <p className="hero-sub">
            Tell BrainHalf what your business needs to run smoother. Watch a real, full-stack
            application assemble itself in seconds—test every button, customize the flow, and launch
            on your own domain.
          </p>
        </div>

        {/* Tactile Command Console Composer */}
        <div className="hero-composer-shell">
          <div className="hero-composer-chrome" aria-hidden="true">
            <div className="hero-composer-status">
              <span className="status-pulse-dot" />
              <span className="status-mono-label">PROMPT COMPILER // READY</span>
            </div>
            <div className="hero-composer-specs">
              <span>UI + DATABASE + HOSTING</span>
            </div>
          </div>

          <form
            className="landing-prompt-box hero-prompt"
            id="start-building"
            onSubmit={onPromptSubmit}
          >
            <label htmlFor="app-idea" className="landing-input-label">
              Describe your app
            </label>
            <textarea
              id="app-idea"
              ref={textareaRef}
              className="landing-prompt-textarea"
              placeholder={typedPlaceholder || STATIC_PLACEHOLDER}
              aria-describedby="prompt-help"
              value={promptText}
              onChange={event => {
                setActiveIdeaId(null);
                onPromptTextChange(event.target.value);
              }}
              onKeyDown={onPromptKeyDown}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              rows={3}
            />

            <div className="landing-prompt-actions">
              <div className="landing-prompt-meta" id="prompt-help">
                <span className="meta-badge">
                  <Check size={13} aria-hidden="true" /> Free to start
                </span>
                <span className="meta-divider" aria-hidden="true">/</span>
                <span className="meta-badge">No code required</span>
              </div>

              <div className="landing-prompt-submit-group">
                <kbd className="hero-kbd-hint" aria-hidden="true">
                  <CornerDownLeft size={11} /> Enter
                </kbd>
                <button
                  type="submit"
                  className="landing-submit-btn"
                  disabled={!promptText.trim() || creatingProject}
                  title="Start building (Enter)"
                >
                  <span>{creatingProject ? 'Assembling…' : 'Build my app'}</span>
                  <span className="submit-btn-icon-wrap">
                    <ArrowRight size={15} aria-hidden="true" />
                  </span>
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Blueprint Starter Deck */}
        <div className="hero-starters" role="group" aria-label="Example app blueprints">
          <span className="hero-starters-label">LOAD BLUEPRINT:</span>
          <div className="hero-starters-list">
            {STARTER_IDEAS.map(item => {
              const Icon = item.icon;
              const isSelected = activeIdeaId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`hero-starter-pill ${isSelected ? 'is-active' : ''}`}
                  onClick={() => handlePickIdea(item.id, item.prompt)}
                >
                  <span className="starter-pill-code">{item.code}</span>
                  <Icon size={13} aria-hidden="true" />
                  <span className="starter-pill-title">{item.label}</span>
                  <span className="starter-pill-tag">{item.tag}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Secondary Action Bar */}
        <div className="hero-cta-row">
          <a
            href="#start-building"
            className="hero-cta-primary"
            onClick={onFocusComposer}
          >
            <Zap size={14} aria-hidden="true" />
            <span>Open blank canvas</span>
          </a>
          <a href="#examples" className="hero-cta-secondary">
            <Layers size={14} aria-hidden="true" />
            <span>Explore live examples</span>
          </a>
        </div>

        {/* 3D Architectural Product Stage */}
        <div
          className="hero-stage"
          onMouseMove={handleStageMouseMove}
          onMouseLeave={handleStageMouseLeave}
          style={{
            ['--tilt-x' as string]: tilt.tiltX,
            ['--tilt-y' as string]: tilt.tiltY,
          }}
        >
          {/* Floating Outcome Card 1 */}
          <div className="hero-chip hero-chip-inventory" aria-hidden="true">
            <div className="hero-chip-header">
              <span className="chip-mono-tag">LIVE MUTATION // 01</span>
              <span className="chip-live-dot" />
            </div>
            <div className="hero-chip-content">
              <span className="hero-chip-icon">
                <Package size={16} />
              </span>
              <div className="hero-chip-body">
                <strong>Corner Café Stockroom</strong>
                <span>Oat milk updated → 23 cartons</span>
              </div>
            </div>
          </div>

          {/* Floating Outcome Card 2 */}
          <div className="hero-chip hero-chip-bookings" aria-hidden="true">
            <div className="hero-chip-header">
              <span className="chip-mono-tag">WEBHOOK // 02</span>
              <span className="chip-status-pill">Confirmed</span>
            </div>
            <div className="hero-chip-content">
              <span className="hero-chip-icon hero-chip-icon-warm">
                <CalendarCheck size={16} />
              </span>
              <div className="hero-chip-body">
                <strong>Thursday at the Salon</strong>
                <span>11:00 AM slot booked by Sara K.</span>
              </div>
            </div>
          </div>

          {/* Main Product Frame */}
          <figure className="hero-shot">
            <div className="hero-shot-chrome" aria-hidden="true">
              <div className="hero-shot-left">
                <div className="hero-shot-dots">
                  <i />
                  <i />
                  <i />
                </div>
                <span className="hero-shot-workspace-tag">WORKSPACE // V2</span>
              </div>

              <div className="hero-shot-address">
                <Globe2 size={12} />
                <span>yourshop.brainhalf.com</span>
                <span className="address-ssl-tag">SSL</span>
              </div>

              <div className="hero-shot-right">
                <span className="hero-shot-badge">
                  <span className="badge-pulse" /> Ready to share
                </span>
              </div>
            </div>

            <div className="hero-shot-viewport">
              <img
                src="/images/landing-workspace.png"
                alt="BrainHalf workspace showing a plain-words conversation next to a live working business app"
                width={1600}
                height={1000}
                loading="eager"
              />
            </div>

            {/* Bottom Studio Telemetry Strip */}
            <figcaption className="hero-shot-telemetry" aria-hidden="true">
              <div className="telemetry-item">
                <span className="telemetry-label">ENGINE</span>
                <span className="telemetry-value">Plain-English to Full-Stack</span>
              </div>
              <div className="telemetry-item">
                <span className="telemetry-label">DATABASE</span>
                <span className="telemetry-value">Auto-provisioned & Persistent</span>
              </div>
              <div className="telemetry-item">
                <span className="telemetry-label">DEPLOYMENT</span>
                <span className="telemetry-value">Instant Custom Subdomain</span>
              </div>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
};

export default LandingHero;
