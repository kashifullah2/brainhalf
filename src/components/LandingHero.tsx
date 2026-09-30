import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarCheck, Check, Package, Users } from 'lucide-react';
import './LandingHero.css';

/**
 * The redesigned landing hero: aurora backdrop, gradient headline, glass
 * prompt composer with a typing placeholder, and the real workspace framed
 * as a product shot with floating UI chips, cursor tilt and parallax.
 *
 * The composer is the same form the page has always had — same ids, class
 * names and submit path (onPromptSubmit -> the existing new-project flow).
 * Only the presentation changed.
 */
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

/**
 * Cursor-follow tilt for the product frame, hard-capped at 4 degrees so the
 * motion stays subtle. px/py are -0.5..0.5 cursor offsets from the visual center.
 */
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
  const visualRef = useRef<HTMLDivElement>(null);

  // The placeholder only performs while the composer is empty and unfocused.
  const typedPlaceholder = useTypingPlaceholder(promptText === '' && !composerFocused);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [promptText, textareaRef]);

  const handleVisualMouseMove = (event: React.MouseEvent) => {
    const el = visualRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    const { tiltX, tiltY } = tiltForCursor(px, py);
    el.style.setProperty('--tilt-x', tiltX);
    el.style.setProperty('--tilt-y', tiltY);
    el.style.setProperty('--par-x', `${(px * 16).toFixed(1)}px`);
    el.style.setProperty('--par-y', `${(py * 16).toFixed(1)}px`);
  };

  const handleVisualMouseLeave = () => {
    const el = visualRef.current;
    if (!el) return;
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
    el.style.setProperty('--par-x', '0px');
    el.style.setProperty('--par-y', '0px');
  };

  return (
    <section className="landing-hero-redesign" aria-labelledby="hero-heading">
      <div className="hero-aurora" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-noise" aria-hidden="true" />

      <div className="hero-inner">
        <div className="hero-copy">
          <p className="hero-eyebrow">
            <Check size={13} aria-hidden="true" /> AI app builder for small businesses
          </p>
          <h1 id="hero-heading">
            From a sentence
            <br />
            to <span className="hero-gradient">working software.</span>
          </h1>
          <p className="hero-sub">
            Describe what your business needs in plain words. BrainHalf builds the app,
            checks that it works, and puts it on the web for you. No coding, no
            technical skills needed.
          </p>
          <div className="hero-ctas">
            <a href="#start-building" className="hero-cta-primary" onClick={onFocusComposer}>
              Start building <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a href="#examples" className="hero-cta-secondary">
              See examples
            </a>
          </div>
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

        <div
          className="hero-visual"
          ref={visualRef}
          onMouseMove={handleVisualMouseMove}
          onMouseLeave={handleVisualMouseLeave}
        >
          <div className="hero-frame-tilt">
            <figure className="hero-shot">
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
                  loading="eager"
                />
              </div>
              <figcaption>The real workspace — describe on the left, watch your app take shape on the right.</figcaption>
            </figure>
          </div>

          <div className="hero-chip hero-chip-inventory" style={{ ['--depth' as string]: 1 }} aria-hidden="true">
            <span className="hero-chip-float">
              <Package size={15} aria-hidden="true" />
              <span className="hero-chip-text"><strong>Inventory</strong><small>3 items low on stock</small></span>
            </span>
          </div>
          <div className="hero-chip hero-chip-bookings" style={{ ['--depth' as string]: 1.7 }} aria-hidden="true">
            <span className="hero-chip-float">
              <CalendarCheck size={15} aria-hidden="true" />
              <span className="hero-chip-text"><strong>Bookings</strong><small>5 appointments today</small></span>
            </span>
          </div>
          <div className="hero-chip hero-chip-customers" style={{ ['--depth' as string]: 0.6 }} aria-hidden="true">
            <span className="hero-chip-float">
              <Users size={15} aria-hidden="true" />
              <span className="hero-chip-text"><strong>Customers</strong><small>128 contacts saved</small></span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default LandingHero;
