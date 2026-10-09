import React, { useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
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
}) => {
  const [composerFocused, setComposerFocused] = useState(false);

  // The placeholder only performs while the composer is empty and unfocused.
  const typedPlaceholder = useTypingPlaceholder(promptText === '' && !composerFocused);

  useEffect(() => {
    const input = textareaRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [promptText, textareaRef]);

  return (
    <section className="landing-hero-redesign" aria-labelledby="hero-heading">
      <div className="hero-glow" aria-hidden="true" />

      <div className="hero-inner">
        <h1 id="hero-heading">
          Describe it.<br />
          <span className="hero-gradient-text">We'll build it.</span>
        </h1>
        <p className="hero-sub">
          Turn a sentence into a working web app — no coding, no waiting.
        </p>

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
            rows={2}
          />
          <div className="landing-prompt-actions">
            <span id="prompt-help"><Check size={13} aria-hidden="true" /> Free to start</span>
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

        <p className="hero-trust">
          Builds in ~2 min &middot; Hosted &amp; secure &middot; <a href="#examples">See examples</a>
        </p>
      </div>
    </section>
  );
};

export default LandingHero;
