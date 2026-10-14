import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  Check,
  Database,
  Globe2,
  Layers,
  Lock,
  Package,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wand2,
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
  'A booking app for my salon, with customer reminders…',
  'An inventory tool for my shop, with low-stock alerts…',
  'A simple CRM to track my customers and follow-ups…',
];

const STATIC_PLACEHOLDER = 'Describe your app in plain words…';

const QUICK_BLUEPRINTS = [
  {
    id: 'inventory',
    label: 'Inventory & Low-Stock Alerts',
    tag: 'D1 Database',
    prompt: 'Build an inventory tracker for my shop with SKU, current stock, reorder threshold, and one-click restock actions saved in a database.',
  },
  {
    id: 'booking',
    label: 'Client Booking Studio',
    tag: 'Calendar + Auth',
    prompt: 'Build an appointment booking app for my salon where clients pick open time slots, avoid double-bookings, and view their upcoming visits.',
  },
  {
    id: 'crm',
    label: 'Sales Pipeline & CRM',
    tag: 'Kanban + Notes',
    prompt: 'Build a clean customer CRM with lead stages (New, Contacted, Won), follow-up reminders, deal value tracking, and private account login.',
  },
  {
    id: 'finance',
    label: 'Finance & Cashflow OS',
    tag: 'Analytics + API',
    prompt: 'Build a business finance and expense tracker with monthly budgets, category breakdowns, recurring bills, and real-time net cashflow charts.',
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
          timer = window.setTimeout(tick, 2000);
          return;
        }
        timer = window.setTimeout(tick, 32 + Math.random() * 46);
      } else {
        charIndex = Math.max(0, charIndex - 4);
        setTyped(current.slice(0, charIndex));
        if (charIndex === 0) {
          deleting = false;
          promptIndex = (promptIndex + 1) % TYPING_PROMPTS.length;
          timer = window.setTimeout(tick, 500);
          return;
        }
        timer = window.setTimeout(tick, 16);
      }
    };
    timer = window.setTimeout(tick, 700);
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
  const [tilt, setTilt] = useState<{ tiltX: string; tiltY: string }>({ tiltX: '0.00deg', tiltY: '0.00deg' });
  const [activeBlueprint, setActiveBlueprint] = useState<string | null>(null);

  // The placeholder only performs while the composer is empty and unfocused.
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

  const handleSelectBlueprint = (id: string, prompt: string) => {
    setActiveBlueprint(id);
    onPromptTextChange(prompt);
    textareaRef.current?.focus();
  };

  return (
    <section className="landing-hero-redesign" aria-labelledby="hero-heading">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-grid-mesh" aria-hidden="true" />

      <div className="hero-inner">
        <div className="hero-badge-row">
          <span className="hero-eyebrow-pill">
            <span className="hero-live-dot" aria-hidden="true" />
            <span>AI Full-Stack Studio &middot; React 19 + Cloudflare Workers + D1</span>
          </span>
        </div>

        <h1 id="hero-heading">
          Describe it.<br />
          <span className="hero-gradient-text">We'll build it.</span>
        </h1>

        <p className="hero-sub">
          Turn a plain-English idea into a real, full-stack web application with its own database, user sign-in, and live web address — ready in minutes.
        </p>

        <div className="hero-cta-row">
          <a
            href="#start-building"
            className="hero-cta-primary"
            onClick={onFocusComposer}
          >
            <span>Start building</span>
            <ArrowRight size={16} aria-hidden="true" />
          </a>
          <a href="#examples" className="hero-cta-secondary">
            <span>See examples</span>
          </a>
        </div>

        <form
          className="landing-prompt-box hero-prompt"
          id="start-building"
          onSubmit={onPromptSubmit}
        >
          <div className="hero-prompt-topbar" aria-hidden="true">
            <div className="hero-prompt-topbar-left">
              <span className="hero-prompt-mode-pill is-active">
                <Wand2 size={12} /> Full-Stack App
              </span>
              <span className="hero-prompt-mode-pill">
                <Database size={12} /> Auto-D1 Schema
              </span>
              <span className="hero-prompt-mode-pill">
                <Lock size={12} /> Built-in Auth
              </span>
            </div>
            <span className="hero-prompt-engine-tag">
              <Terminal size={11} /> Live Workspace
            </span>
          </div>

          <label htmlFor="app-idea" className="landing-input-label">Describe your app</label>
          <textarea
            id="app-idea"
            ref={textareaRef}
            className="landing-prompt-textarea"
            placeholder={typedPlaceholder || STATIC_PLACEHOLDER}
            aria-describedby="prompt-help"
            value={promptText}
            onChange={event => {
              setActiveBlueprint(null);
              onPromptTextChange(event.target.value);
            }}
            onKeyDown={onPromptKeyDown}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            rows={3}
          />

          <div className="hero-blueprint-bar" role="group" aria-label="Quick app blueprints">
            <span className="hero-blueprint-label">
              <Sparkles size={11} aria-hidden="true" /> Blueprints:
            </span>
            <div className="hero-blueprint-chips">
              {QUICK_BLUEPRINTS.map(bp => (
                <button
                  key={bp.id}
                  type="button"
                  className={`hero-blueprint-chip${activeBlueprint === bp.id ? ' is-selected' : ''}`}
                  onClick={() => handleSelectBlueprint(bp.id, bp.prompt)}
                >
                  <span>{bp.label}</span>
                  <small>{bp.tag}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="landing-prompt-actions">
            <div className="hero-prompt-meta">
              <span id="prompt-help"><Check size={13} aria-hidden="true" /> Free to start</span>
              <span className="hero-prompt-meta-sep" aria-hidden="true">&middot;</span>
              <span className="hero-prompt-meta-item"><ShieldCheck size={13} aria-hidden="true" /> Private SQLite DB</span>
              <span className="hero-prompt-meta-sep" aria-hidden="true">&middot;</span>
              <span className="hero-prompt-meta-item"><Globe2 size={13} aria-hidden="true" /> Instant URL</span>
            </div>
            <button
              type="submit"
              className="landing-submit-btn"
              disabled={!promptText.trim() || creatingProject}
              title="Start building (Enter)"
            >
              <span>{creatingProject ? 'Creating…' : 'Start building'}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </form>

        <p className="hero-trust">
          Builds in ~2 min &middot; Hosted &amp; secure &middot; <a href="#examples">See examples</a>
        </p>

        {/* Realistic 3D Interactive Studio Showcase */}
        <div
          className="hero-stage"
          onMouseMove={handleStageMouseMove}
          onMouseLeave={handleStageMouseLeave}
          style={{
            ['--tilt-x' as string]: tilt.tiltX,
            ['--tilt-y' as string]: tilt.tiltY,
          }}
        >
          <div className="hero-chip hero-chip-inventory" aria-hidden="true">
            <span className="hero-chip-icon">
              <Package size={15} />
            </span>
            <div className="hero-chip-body">
              <strong>Live D1 Inventory Sync</strong>
              <span>Oat milk restocked &rarr; 23 cartons</span>
            </div>
            <span className="hero-chip-tag">SQLite</span>
          </div>

          <div className="hero-chip hero-chip-bookings" aria-hidden="true">
            <span className="hero-chip-icon hero-chip-icon-teal">
              <CalendarCheck size={15} />
            </span>
            <div className="hero-chip-body">
              <strong>Booking Confirmed</strong>
              <span>Thu 11:00 AM &middot; Reminder queued</span>
            </div>
            <span className="hero-chip-tag hero-chip-tag-teal">201 OK</span>
          </div>

          <div className="hero-shot">
            <div className="hero-shot-chrome" aria-hidden="true">
              <div className="hero-shot-dots">
                <i />
                <i />
                <i />
              </div>
              <div className="hero-shot-address">
                <Lock size={11} />
                <span>studio.brainhalf.com/workspace/live-app</span>
              </div>
              <div className="hero-shot-status">
                <Layers size={11} />
                <span>Full-Stack Ready</span>
              </div>
            </div>
            <div className="hero-shot-Viewport">
              <img
                src="/images/landing-workspace.png"
                alt="BrainHalf Studio workspace showing the AI builder chat alongside a live application preview"
                width={1600}
                height={1000}
                loading="eager"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingHero;
