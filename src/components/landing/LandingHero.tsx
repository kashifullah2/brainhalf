import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  Check,
  ClipboardList,
  Globe2,
  Package,
  Users,
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

const STARTER_IDEAS = [
  {
    id: 'inventory',
    label: 'Inventory tracker',
    icon: Package,
    prompt: 'Build an inventory tool for my shop with products, stock counts, and low-stock alerts.',
  },
  {
    id: 'booking',
    label: 'Booking app',
    icon: CalendarCheck,
    prompt: 'Build an appointment booking app for my salon where customers pick a free time slot.',
  },
  {
    id: 'crm',
    label: 'Customer follow-ups',
    icon: Users,
    prompt: 'Build a simple customer list to track enquiries, notes, and who to follow up with this week.',
  },
  {
    id: 'tasks',
    label: 'Team task board',
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

  const handlePickIdea = (prompt: string) => {
    onPromptTextChange(prompt);
    textareaRef.current?.focus();
  };

  return (
    <section className="landing-hero-redesign" aria-labelledby="hero-heading">
      <div className="hero-inner">
        <div className="hero-copy">
          <p className="hero-kicker">Software for your business, in plain words</p>
          <h1 id="hero-heading">
            Describe it.{' '}
            <span className="hero-gradient-text">We'll build it.</span>
          </h1>
          <p className="hero-sub">
            Tell BrainHalf what your business needs to keep track of. Watch your app take shape, try every button, and share it with customers at your own web address.
          </p>
        </div>

        <form
          className="landing-prompt-box hero-prompt"
          id="start-building"
          onSubmit={onPromptSubmit}
        >
          <label htmlFor="app-idea" className="landing-input-label">Describe your app</label>
          <textarea
            id="app-idea"
            ref={textareaRef}
            className="landing-prompt-textarea"
            placeholder={typedPlaceholder || STATIC_PLACEHOLDER}
            aria-describedby="prompt-help"
            value={promptText}
            onChange={event => onPromptTextChange(event.target.value)}
            onKeyDown={onPromptKeyDown}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            rows={3}
          />
          <div className="landing-prompt-actions">
            <span id="prompt-help">
              <Check size={14} aria-hidden="true" /> Free to start &middot; No coding needed
            </span>
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

        <div className="hero-starters" role="group" aria-label="Example app ideas">
          <span className="hero-starters-label">Try an idea:</span>
          <div className="hero-starters-list">
            {STARTER_IDEAS.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="hero-starter-pill"
                  onClick={() => handlePickIdea(item.prompt)}
                >
                  <Icon size={13} aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="hero-cta-row">
          <a
            href="#start-building"
            className="hero-cta-primary"
            onClick={onFocusComposer}
          >
            <span>Start building</span>
            <ArrowRight size={15} aria-hidden="true" />
          </a>
          <a href="#examples" className="hero-cta-secondary">
            <span>See examples</span>
          </a>
        </div>

        {/* Realistic Product Window Showcase */}
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
              <strong>Corner Café stockroom</strong>
              <span>Oat milk updated to 23 cartons</span>
            </div>
          </div>

          <div className="hero-chip hero-chip-bookings" aria-hidden="true">
            <span className="hero-chip-icon hero-chip-icon-warm">
              <CalendarCheck size={15} />
            </span>
            <div className="hero-chip-body">
              <strong>Thursday at the salon</strong>
              <span>11:00 AM appointment booked</span>
            </div>
          </div>

          <figure className="hero-shot">
            <div className="hero-shot-chrome" aria-hidden="true">
              <div className="hero-shot-dots">
                <i />
                <i />
                <i />
              </div>
              <div className="hero-shot-address">
                <Globe2 size={12} />
                <span>yourshop.brainhalf.com</span>
              </div>
              <span className="hero-shot-badge">Ready to share</span>
            </div>
            <img
              src="/images/landing-workspace.png"
              alt="BrainHalf workspace showing a plain-words conversation next to a live working business app"
              width={1600}
              height={1000}
              loading="eager"
            />
          </figure>
        </div>
      </div>
    </section>
  );
};

export default LandingHero;
