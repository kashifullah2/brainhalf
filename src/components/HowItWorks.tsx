import React, { useEffect, useRef, useState } from 'react';
import { Check, Globe2, MessageCircle, PenLine, ShieldCheck } from 'lucide-react';
import './HowItWorks.css';

const STEPS = [
  {
    id: 'describe',
    icon: PenLine,
    title: 'Describe it in plain words',
    detail:
      'One job is enough to start: tracking stock, taking bookings, or following up with customers. Write it the way you would explain it to a person.',
    visualLabel: 'Your sentence becomes a plan',
  },
  {
    id: 'refine',
    icon: MessageCircle,
    title: 'Refine it by chatting',
    detail:
      'Click through your app, try things out, and ask for changes in plain language. The screens, the saved information, and sign-in all update together.',
    visualLabel: 'Changes happen in plain words',
  },
  {
    id: 'share',
    icon: Globe2,
    title: 'Share it with the world',
    detail:
      'We check that everything works before anything goes live — and tell you in plain words if something needs fixing. Then your app gets its own web address to share with customers.',
    visualLabel: 'Checked, then live at your address',
  },
];

function StepVisual({ id, active }: { id: string; active: boolean }) {
  return (
    <div className={`hiw-visual${active ? ' is-active' : ''}`} aria-hidden={!active}>
      {id === 'describe' && (
        <div className="hiw-card">
          <p className="hiw-visual-label">Your sentence becomes a plan</p>
          <div className="hiw-prompt"><PenLine size={14} aria-hidden="true" /><span>A booking page for my barbershop, with reminders</span></div>
          <div className="hiw-plan">
            <span><Check size={13} aria-hidden="true" /> Booking calendar</span>
            <span><Check size={13} aria-hidden="true" /> Customer reminders</span>
            <span><Check size={13} aria-hidden="true" /> Your own database</span>
          </div>
        </div>
      )}
      {id === 'refine' && (
        <div className="hiw-card">
          <p className="hiw-visual-label">Changes happen in plain words</p>
          <div className="hiw-chat hiw-chat-user">Add a price list to the booking page</div>
          <div className="hiw-chat hiw-chat-ai"><Check size={13} aria-hidden="true" /> Price list added — want to change any prices?</div>
          <div className="hiw-mini-page" aria-hidden="true">
            <span className="hiw-mini-row" /><span className="hiw-mini-row" /><span className="hiw-mini-row hiw-mini-new">Price list</span>
          </div>
        </div>
      )}
      {id === 'share' && (
        <div className="hiw-card">
          <p className="hiw-visual-label">Checked, then live at your address</p>
          <div className="hiw-checks">
            <span><ShieldCheck size={14} aria-hidden="true" /> Everything works</span>
            <span><Check size={13} aria-hidden="true" /> Sign-in keeps records private</span>
          </div>
          <div className="hiw-url"><Globe2 size={14} aria-hidden="true" /><strong>yourshop</strong>.brainhalf.com</div>
        </div>
      )}
    </div>
  );
}

export const HowItWorks: React.FC = () => {
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = stepRefs.current.indexOf(entry.target as HTMLLIElement);
            if (index >= 0) setActiveStep(index);
          }
        }
      },
      { rootMargin: '-40% 0px -40% 0px', threshold: 0 }
    );
    stepRefs.current.forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  return (
    <section className="hiw-section" id="how-it-works" aria-labelledby="hiw-heading">
      <div className="landing-section-intro">
        <p className="landing-kicker">How it works</p>
        <h2 id="hiw-heading">Describe. Refine. Share.</h2>
        <p className="landing-section-lede">You set the direction and make the decisions. BrainHalf does the building.</p>
      </div>

      <div className="hiw-layout">
        <ol className="hiw-steps" aria-label="How it works">
          <span className="hiw-line" aria-hidden="true">
            <span className="hiw-line-fill" style={{ transform: `scaleY(${activeStep / (STEPS.length - 1)})` }} />
          </span>
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            const active = index === activeStep;
            const done = index < activeStep;
            return (
              <li
                key={step.id}
                ref={el => { stepRefs.current[index] = el; }}
                className={`hiw-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                aria-current={active ? 'step' : undefined}
              >
                <span className="hiw-dot" aria-hidden="true">
                  {done ? <Check size={14} /> : <Icon size={15} />}
                </span>
                <div className="hiw-step-body">
                  <p className="hiw-step-num">Step {index + 1}</p>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="hiw-sticky" aria-live="polite">
          <p className="hiw-sticky-label">{STEPS[activeStep].visualLabel}</p>
          <div className="hiw-visual-stack">
            {STEPS.map((step, index) => (
              <StepVisual key={step.id} id={step.id} active={index === activeStep} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
