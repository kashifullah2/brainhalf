import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  CalendarCheck,
  Check,
  ChevronRight,
  ClipboardList,
  Database,
  Globe2,
  Lock,
  MessageCircle,
  Package,
  PenLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react';
import SiteNavbar from '../SiteNavbar';
import LandingFooter from './LandingFooter';
import GalleryRow from '../GalleryRow';
import { BUSINESS_APPS } from '../../lib/business-apps';
import { HOME_FAQS } from '../../seo/content';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import './landing-tokens.css';
import './LandingPage.css';
import '../PublicPage.css';

// ─── Hero ─────────────────────────────────────────────────────────────────────

const TYPING_PROMPTS = [
  'A crop tracker for my wheat farm, with harvest reminders…',
  'A booking app for my salon, with customer reminders…',
  'An inventory tool for my shop, with low-stock alerts…',
  'A simple CRM to track my customers and follow-ups…',
];

const STATIC_PLACEHOLDER = 'Describe your app in plain words…';

const STARTER_IDEAS = [
  { id: 'inventory', label: 'Inventory tracker', icon: Package, prompt: 'Build an inventory tool for my shop with products, stock counts, and low-stock alerts.' },
  { id: 'booking', label: 'Booking app', icon: CalendarCheck, prompt: 'Build an appointment booking app for my salon where customers pick a free time slot.' },
  { id: 'crm', label: 'Customer follow-ups', icon: Users, prompt: 'Build a simple customer list to track enquiries, notes, and who to follow up with this week.' },
  { id: 'tasks', label: 'Team task board', icon: ClipboardList, prompt: 'Build a clean weekly task board for my shop with To do, Doing, and Done columns.' },
] as const;

function tiltForCursor(px: number, py: number) {
  const clamp4 = (v: number) => Math.max(-4, Math.min(4, v));
  return { tiltX: `${clamp4(-py * 8).toFixed(2)}deg`, tiltY: `${clamp4(px * 8).toFixed(2)}deg` };
}

function useTypingPlaceholder(active: boolean): string {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!active) { setTyped(''); return; }
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(TYPING_PROMPTS[0]); return;
    }
    let promptIndex = 0, charIndex = 0, deleting = false, timer = 0;
    const tick = () => {
      const current = TYPING_PROMPTS[promptIndex];
      if (!deleting) {
        charIndex += 1;
        setTyped(current.slice(0, charIndex));
        if (charIndex >= current.length) { deleting = true; timer = window.setTimeout(tick, 2000); return; }
        timer = window.setTimeout(tick, 32 + Math.random() * 46);
      } else {
        charIndex = Math.max(0, charIndex - 4);
        setTyped(current.slice(0, charIndex));
        if (charIndex === 0) { deleting = false; promptIndex = (promptIndex + 1) % TYPING_PROMPTS.length; timer = window.setTimeout(tick, 500); return; }
        timer = window.setTimeout(tick, 16);
      }
    };
    timer = window.setTimeout(tick, 700);
    return () => window.clearTimeout(timer);
  }, [active]);
  return typed;
}

interface HeroProps {
  promptText: string;
  onPromptTextChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  creatingProject: boolean;
  onPromptSubmit: (e?: React.FormEvent) => void;
  onPromptKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocusComposer: (event?: React.MouseEvent<HTMLAnchorElement>) => void;
  onPickIdea: (prompt: string) => void;
}

function LandingHero({ promptText, onPromptTextChange, textareaRef, creatingProject, onPromptSubmit, onPromptKeyDown, onPickIdea }: HeroProps) {
  const [composerFocused, setComposerFocused] = useState(false);
  const [tilt, setTilt] = useState({ tiltX: '0.00deg', tiltY: '0.00deg' });
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

  return (
    <section className="landing-hero-redesign" aria-labelledby="hero-heading">
      <div className="hero-inner">
        <div className="hero-copy">
          <p className="hero-kicker">Software for your business, in plain words</p>
          <h1 id="hero-heading">Describe it.{' '}<span className="hero-gradient-text">We'll build it.</span></h1>
          <p className="hero-sub">Tell BrainHalf what your business needs to keep track of. Watch your app take shape, try every button, and share it with customers at your own web address.</p>
        </div>

        <form className="landing-prompt-box hero-prompt" id="start-building" onSubmit={onPromptSubmit}>
          <label htmlFor="app-idea" className="landing-input-label">Describe your app</label>
          <textarea
            id="app-idea" ref={textareaRef} className="landing-prompt-textarea"
            placeholder={typedPlaceholder || STATIC_PLACEHOLDER} aria-describedby="prompt-help"
            value={promptText} onChange={e => onPromptTextChange(e.target.value)}
            onKeyDown={onPromptKeyDown} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} rows={3}
          />
          <div className="landing-prompt-actions">
            <span id="prompt-help"><Check size={14} aria-hidden="true" /> Free to start &middot; No coding needed</span>
            <button type="submit" className="landing-submit-btn" disabled={!promptText.trim() || creatingProject} title="Start building (Enter)">
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
                <button key={item.id} type="button" className="hero-starter-pill" onClick={() => onPickIdea(item.prompt)}>
                  <Icon size={13} aria-hidden="true" /><span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="hero-stats" aria-label="Product highlights">
          {[
            { value: 'Minutes', label: 'from idea to working app' },
            { value: 'Zero', label: 'code required' },
            { value: 'Built-in', label: 'database, sign-in & hosting' },
          ].map(stat => (
            <div className="hero-stat" key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>
          ))}
        </div>

        <div className="hero-stage" onMouseMove={handleStageMouseMove} onMouseLeave={() => setTilt({ tiltX: '0.00deg', tiltY: '0.00deg' })}
          style={{ ['--tilt-x' as string]: tilt.tiltX, ['--tilt-y' as string]: tilt.tiltY }}>
          <div className="hero-chip hero-chip-inventory" aria-hidden="true">
            <span className="hero-chip-icon"><Package size={15} /></span>
            <div className="hero-chip-body"><strong>Corner Café stockroom</strong><span>Oat milk updated to 23 cartons</span></div>
          </div>
          <div className="hero-chip hero-chip-bookings" aria-hidden="true">
            <span className="hero-chip-icon hero-chip-icon-warm"><CalendarCheck size={15} /></span>
            <div className="hero-chip-body"><strong>Thursday at the salon</strong><span>11:00 AM appointment booked</span></div>
          </div>
          <figure className="hero-shot">
            <div className="hero-shot-chrome" aria-hidden="true">
              <div className="hero-shot-dots"><i /><i /><i /></div>
              <div className="hero-shot-address"><Globe2 size={12} /><span>yourshop.brainhalf.com</span></div>
              <span className="hero-shot-badge">Ready to share</span>
            </div>
            <img src="/images/landing-workspace.png" alt="BrainHalf workspace showing a plain-words conversation next to a live working business app" width={1600} height={1000} loading="eager" />
          </figure>
        </div>
      </div>
    </section>
  );
}

// ─── Interactive Demo ─────────────────────────────────────────────────────────

const TAB_ORDER = ['inventory', 'booking', 'crm', 'tasks'] as const;

const TAB_META: Record<string, { icon: typeof Package; ownerPhoto?: string; ownerCaption: string; business: string }> = {
  inventory: { icon: Package, ownerPhoto: '/images/landing/demo-inventory-owner.webp', ownerCaption: 'A café owner checking stock', business: 'Inventory tool' },
  booking: { icon: CalendarCheck, ownerCaption: 'A salon keeping its day in order', business: 'Booking app' },
  crm: { icon: Users, ownerPhoto: '/images/landing/demo-crm-owner.webp', ownerCaption: 'A farmer keeping customers close', business: 'Simple CRM' },
  tasks: { icon: ClipboardList, ownerPhoto: '/images/landing/demo-tasks-owner.webp', ownerCaption: 'A boutique owner planning the day', business: 'Task manager' },
};

const DEMO_APPS = TAB_ORDER.map(id => BUSINESS_APPS.find(app => app.id === id)!).filter(Boolean);

function SampleBadge() { return <span className="demo-sample-badge">Sample data</span>; }

function InventorySample() {
  const [restocked, setRestocked] = useState(false);
  return (
    <div className="demo-sample">
      <div className="demo-sample-head"><strong><Package size={15} aria-hidden="true" /> Corner Café stockroom</strong><SampleBadge /></div>
      <div className="demo-stock-summary">
        <div><strong>{restocked ? '59' : '39'}</strong><span>items on hand</span></div>
        <div><strong>{restocked ? '0' : '1'}</strong><span>needs a top-up</span></div>
      </div>
      <table className="demo-table">
        <caption className="demo-visually-hidden">Stock at a glance</caption>
        <thead><tr><th scope="col">Product</th><th scope="col">On hand</th><th scope="col">Status</th></tr></thead>
        <tbody>
          <tr><td><strong>Coffee beans</strong><small>CB-101 · 1kg bags</small></td><td>24</td><td><span className="demo-pill">In stock</span></td></tr>
          <tr><td><strong>Oat milk</strong><small>DM-014 · cartons</small></td><td>{restocked ? '23' : '3'}</td><td><span className={restocked ? 'demo-pill' : 'demo-pill demo-pill-warn'}>{restocked ? 'In stock' : 'Low stock'}</span></td></tr>
          <tr><td><strong>Paper cups</strong><small>PK-008 · sleeves</small></td><td>12</td><td><span className="demo-pill">In stock</span></td></tr>
        </tbody>
      </table>
      <div className="demo-sample-action">
        <p aria-live="polite">{restocked ? 'Oat milk updated to 23. One less thing to remember.' : 'Oat milk is running low. Try updating the stock.'}</p>
        <button type="button" onClick={() => setRestocked(v => !v)}>{restocked ? 'Reset demo' : 'Add 20 cartons'}<Plus size={13} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

const DAY_SLOTS = ['9:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00'];

function BookingSample() {
  const [booked, setBooked] = useState<string[]>(['10:00', '14:00']);
  const [mine, setMine] = useState<string | null>(null);
  const toggle = (slot: string) => {
    if (booked.includes(slot)) return;
    setMine(mine === slot ? null : slot);
  };
  return (
    <div className="demo-sample">
      <div className="demo-sample-head"><strong><CalendarCheck size={15} aria-hidden="true" /> Thursday at the salon</strong><SampleBadge /></div>
      <p className="demo-sample-sub">Tap a free slot to book it. Booked times stay blocked, so nothing gets double-booked.</p>
      <ul className="demo-slots" aria-label="Appointment slots">
        {DAY_SLOTS.map(slot => {
          const taken = booked.includes(slot), isMine = mine === slot;
          return (
            <li key={slot}>
              <button type="button" className={`demo-slot${taken ? ' is-taken' : ''}${isMine ? ' is-mine' : ''}`}
                disabled={taken} aria-pressed={isMine}
                aria-label={taken ? `${slot}, booked` : isMine ? `${slot}, your booking. Activate to cancel` : `${slot}, free. Activate to book`}
                onClick={() => toggle(slot)}>
                <span>{slot}</span><small>{taken ? 'Booked' : isMine ? 'Your cut' : 'Free'}</small>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="demo-sample-note" aria-live="polite">{mine ? `Booked for ${mine}. In your app this would save to your database.` : 'No booking yet — pick a free slot above.'}</p>
    </div>
  );
}

function CrmSample() {
  const [stages, setStages] = useState<Record<string, number>>({ 'Olive Studio': 0, 'Northside Café': 1, 'Paper House': 2 });
  const stageNames = ['New', 'Contacted', 'Won'];
  const advance = (name: string) => setStages(cur => ({ ...cur, [name]: Math.min(2, (cur[name] ?? 0) + 1) }));
  return (
    <div className="demo-sample">
      <div className="demo-sample-head"><strong><Users size={15} aria-hidden="true" /> People to follow up with</strong><SampleBadge /></div>
      <table className="demo-table">
        <caption className="demo-visually-hidden">Customer follow-ups</caption>
        <thead><tr><th scope="col">Customer</th><th scope="col" className="demo-col-step">Next step</th><th scope="col">Stage</th><th scope="col"><span className="demo-visually-hidden">Move forward</span></th></tr></thead>
        <tbody>
          {[
            { name: 'Olive Studio', detail: 'Design supplies', next: 'Send quote' },
            { name: 'Northside Café', detail: 'Weekly delivery', next: 'Call Friday' },
            { name: 'Paper House', detail: 'Monthly order', next: 'Prepare order' },
          ].map(row => (
            <tr key={row.name}>
              <td><strong>{row.name}</strong><small>{row.detail}</small></td>
              <td className="demo-col-step">{row.next}</td>
              <td><span className={`demo-pill${stages[row.name] === 0 ? ' demo-pill-warn' : ''}`}>{stageNames[stages[row.name]]}</span></td>
              <td>{stages[row.name] < 2 && <button type="button" className="demo-mini-btn" onClick={() => advance(row.name)} aria-label={`Move ${row.name} to ${stageNames[stages[row.name] + 1]}`}><ChevronRight size={14} aria-hidden="true" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="demo-sample-note">Customer details and notes stay together in your own private workspace.</p>
    </div>
  );
}

function TasksSample() {
  const [done, setDone] = useState<string[]>(['Reply to enquiries']);
  const columns = [
    { title: 'To do', items: ['Count the stockroom', 'Call Friday customers'] },
    { title: 'Doing', items: ['Prepare café delivery'] },
    { title: 'Done', items: ['Confirm supplier order', ...done] },
  ];
  const complete = (item: string) => setDone(cur => cur.includes(item) ? cur : [...cur, item]);
  return (
    <div className="demo-sample">
      <div className="demo-sample-head"><strong><ClipboardList size={15} aria-hidden="true" /> This week at the boutique</strong><SampleBadge /></div>
      <div className="demo-board">
        {columns.map(col => (
          <div className="demo-column" key={col.title}>
            <p className="demo-column-title">{col.title}</p>
            <ul>
              {col.items.map(item => {
                const finished = done.includes(item), actionable = !finished && col.title !== 'Done';
                return (
                  <li key={item} className={finished ? 'is-done' : ''}>
                    {actionable ? (
                      <button type="button" onClick={() => complete(item)} aria-label={`Mark "${item}" as done`}>
                        <span className="demo-check" aria-hidden="true">{finished ? <Check size={12} /> : null}</span>{item}
                      </button>
                    ) : (
                      <span className="demo-task-static"><span className="demo-check is-checked" aria-hidden="true"><Check size={12} /></span>{item}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <p className="demo-sample-note" aria-live="polite">Tap a task to mark it done — the board updates straight away.</p>
    </div>
  );
}

function SampleApp({ id }: { id: string }) {
  switch (id) {
    case 'inventory': return <InventorySample />;
    case 'booking': return <BookingSample />;
    case 'crm': return <CrmSample />;
    default: return <TasksSample />;
  }
}

function InteractiveDemo({ onUseIdea }: { onUseIdea: (prompt: string) => void }) {
  const [selected, setSelected] = useState(0);
  const app = DEMO_APPS[selected];
  const meta = TAB_META[app.id];

  const onTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % DEMO_APPS.length;
    else if (event.key === 'ArrowLeft') next = (index + DEMO_APPS.length - 1) % DEMO_APPS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = DEMO_APPS.length - 1;
    else return;
    event.preventDefault();
    setSelected(next);
    document.getElementById(`demo-tab-${DEMO_APPS[next].id}`)?.focus();
  };

  return (
    <section className="demo-section" id="examples" aria-labelledby="demo-heading">
      <div className="landing-section-intro">
        <p className="landing-kicker">Try it right here</p>
        <h2 id="demo-heading">Real apps, not mockups.</h2>
        <p className="landing-section-lede">These are the kinds of working tools people build. Click through them — every button does something.</p>
      </div>

      <div className="demo-tabs" role="tablist" aria-label="Example apps you can try">
        {DEMO_APPS.map((item, index) => {
          const Icon = TAB_META[item.id].icon;
          const isSelected = selected === index;
          return (
            <button key={item.id} id={`demo-tab-${item.id}`} type="button" role="tab"
              aria-selected={isSelected} aria-controls="demo-panel" tabIndex={isSelected ? 0 : -1}
              className={isSelected ? 'is-selected' : ''} onClick={() => setSelected(index)} onKeyDown={e => onTabKeyDown(e, index)}>
              <Icon size={15} aria-hidden="true" />{TAB_META[item.id].business}
            </button>
          );
        })}
      </div>

      <div className="demo-panel" role="tabpanel" id="demo-panel" aria-labelledby={`demo-tab-${app.id}`} tabIndex={0}>
        <div className="demo-idea">
          {meta.ownerPhoto && (
            <figure className="demo-owner">
              <img src={meta.ownerPhoto} alt={meta.ownerCaption} width={1920} height={1280} loading="lazy" />
              <figcaption>{meta.ownerCaption}</figcaption>
            </figure>
          )}
          <p className="demo-idea-label">It starts with an idea like this</p>
          <blockquote className="demo-prompt">"{app.prompt}"</blockquote>
          <button type="button" className="demo-use-idea" onClick={() => onUseIdea(app.prompt)} aria-label={`Use this idea: ${meta.business}`}>
            Use this idea <ArrowRight size={15} aria-hidden="true" />
          </button>
          <p className="demo-idea-hint">Fills in your first prompt above — change anything before you build.</p>
        </div>

        <div className="demo-stage">
          <div className="demo-browser" aria-label={`${meta.business} interactive example with sample data`}>
            <div className="demo-browser-bar" aria-hidden="true">
              <span className="demo-browser-dots"><i /><i /><i /></span>
              <span className="demo-browser-url">{meta.business} · example preview</span>
            </div>
            <SampleApp id={app.id} />
          </div>
          <p className="demo-caption">
            Interactive example with sample data. Your own business records stay in your own app.
            <a href="#start-building" onClick={e => { e.preventDefault(); onUseIdea(app.prompt); }}>
              Start from this idea <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </p>
        </div>
      </div>

      <p className="landing-audience-line">
        Made for retail shops, cafés &amp; restaurants, farms, clinics, warehouses, schools, freelancers, and nonprofits.
        If you run it on spreadsheets and memory, it can be software.
      </p>
    </section>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────

const HOW_STEPS = [
  { id: 'describe', icon: PenLine, title: 'Describe it in plain words', detail: 'One job is enough to start: tracking stock, taking bookings, or following up with customers. Write it the way you would explain it to a person.', visualLabel: 'Your sentence becomes a plan' },
  { id: 'refine', icon: MessageCircle, title: 'Refine it by chatting', detail: 'Click through your app, try things out, and ask for changes in plain language. The screens, the saved information, and sign-in all update together.', visualLabel: 'Changes happen in plain words' },
  { id: 'share', icon: Globe2, title: 'Share it with the world', detail: 'We check that everything works before anything goes live — and tell you in plain words if something needs fixing. Then your app gets its own web address to share with customers.', visualLabel: 'Checked, then live at your address' },
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

function HowItWorks() {
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
            <span className="hiw-line-fill" style={{ transform: `scaleY(${activeStep / (HOW_STEPS.length - 1)})` }} />
          </span>
          {HOW_STEPS.map((step, index) => {
            const Icon = step.icon;
            const active = index === activeStep, done = index < activeStep;
            return (
              <li key={step.id} ref={el => { stepRefs.current[index] = el; }}
                className={`hiw-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                aria-current={active ? 'step' : undefined}>
                <span className="hiw-dot" aria-hidden="true">{done ? <Check size={14} /> : <Icon size={15} />}</span>
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
          <p className="hiw-sticky-label">{HOW_STEPS[activeStep].visualLabel}</p>
          <div className="hiw-visual-stack">
            {HOW_STEPS.map((step, index) => <StepVisual key={step.id} id={step.id} active={index === activeStep} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Bento Grid ───────────────────────────────────────────────────────────────

function useSpotlight() {
  return useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tile = event.currentTarget;
    const rect = tile.getBoundingClientRect();
    tile.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    tile.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }, []);
}

function DescribeVisual() {
  return (
    <div className="bento-visual" aria-hidden="true">
      <div className="bv-prompt"><PenLine size={13} /><span>A booking page for my barbershop…</span><i className="bv-caret" /></div>
      <div className="bv-arrow">↓</div>
      <div className="bv-app"><Sparkles size={13} /><span>Your app, taking shape</span></div>
    </div>
  );
}

function PreviewVisual() {
  return (
    <div className="bento-visual" aria-hidden="true">
      <div className="bv-browser">
        <div className="bv-bar"><i /><i /><i /></div>
        <div className="bv-page">
          <span className="bv-block bv-w60" /><span className="bv-block bv-w40" />
          <span className="bv-block bv-w80" /><span className="bv-btn" />
        </div>
      </div>
    </div>
  );
}

function ChatVisual() {
  return (
    <div className="bento-visual" aria-hidden="true">
      <div className="bv-chat bv-chat-user">Make the prices bigger</div>
      <div className="bv-chat bv-chat-ai"><Check size={12} /> Done — prices are larger now</div>
    </div>
  );
}

function DatabaseVisual() {
  return (
    <div className="bento-visual" aria-hidden="true">
      <div className="bv-db">
        <div className="bv-db-row bv-db-head"><span>Customer</span><span>Due</span></div>
        <div className="bv-db-row"><span>Amara's Bakery</span><span>$120</span></div>
        <div className="bv-db-row"><span>City Florist</span><span>$85</span></div>
        <div className="bv-db-row"><span>North Garage</span><span>$210</span></div>
      </div>
    </div>
  );
}

function SignInVisual() {
  return (
    <div className="bento-visual" aria-hidden="true">
      <div className="bv-signin">
        <span className="bv-signin-title">Welcome back</span>
        <span className="bv-google">G&nbsp; Continue with Google</span>
        <span className="bv-email">you@yourshop.com</span>
      </div>
    </div>
  );
}

function AddressVisual() {
  return (
    <div className="bento-visual bento-visual-wide" aria-hidden="true">
      <div className="bv-url"><Lock size={13} /><span>yourshop</span>.brainhalf.com</div>
      <div className="bv-url-note">Share it anywhere — it just works</div>
    </div>
  );
}

const BENTO_TILES = [
  { id: 'describe', span: 'span-4', kicker: 'Start', title: 'Describe it', text: 'One sentence about the job to be done. No wireframes, no jargon, no technical plan needed.', visual: <DescribeVisual />, icon: PenLine },
  { id: 'preview', span: 'span-2', kicker: 'Watch', title: 'Live preview', text: 'See your app take shape as it is built, and click through it any time.', visual: <PreviewVisual />, icon: Sparkles },
  { id: 'chat', span: 'span-2', kicker: 'Refine', title: 'Edit by chatting', text: 'Ask for changes in plain words. Screens, data and sign-in update together.', visual: <ChatVisual />, icon: MessageCircle },
  { id: 'database', span: 'span-2', kicker: 'Included', title: 'Your own database', text: 'Every app saves its records properly — not in a spreadsheet, not in memory.', visual: <DatabaseVisual />, icon: Check },
  { id: 'signin', span: 'span-2', kicker: 'Included', title: 'Customer sign-in', text: 'Customers sign in with Google or email. Their records stay private to them.', visual: <SignInVisual />, icon: Lock },
  { id: 'address', span: 'span-6', kicker: 'Launch', title: 'Your own web address', text: 'We check that everything works before anything goes live — and tell you in plain words if something needs fixing. Then your app gets an address you can share with customers.', visual: <AddressVisual />, icon: Globe2 },
];

function BentoGrid() {
  const spotlight = useSpotlight();
  return (
    <section className="bento-section" aria-labelledby="bento-heading">
      <div className="landing-section-intro">
        <p className="landing-kicker">Everything included</p>
        <h2 id="bento-heading">One workspace, start to share.</h2>
        <p className="landing-section-lede">The whole journey lives in one place — nothing to stitch together, nothing to install.</p>
      </div>
      <div className="bento-grid">
        {BENTO_TILES.map((tile, i) => {
          const Icon = tile.icon;
          return (
            <article key={tile.id} className={`bento-tile ${tile.span}`} onMouseMove={spotlight} style={{ ['--tile-i' as string]: i }}>
              <div className="bento-tile-top">
                <span className="bento-kicker">{tile.kicker}</span>
                <Icon size={16} aria-hidden="true" className="bento-icon" />
              </div>
              <h3>{tile.title}</h3>
              <p>{tile.text}</p>
              {tile.visual}
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ─── Trust Section ────────────────────────────────────────────────────────────

const TRUST_BENEFITS = [
  { icon: Database, title: 'Your data stays yours', text: "Your business records live in your own app's database, private to your sign-in. Nothing is shared, sold, or mixed with anyone else's." },
  { icon: ShieldCheck, title: 'Checked before it goes live', text: 'Every app is verified to work before it can be published. If something needs fixing, you get told in plain words — not an error code.' },
  { icon: Globe2, title: 'Your own address', text: 'Published apps get their own web address to share with customers. Take it offline any time; your data stays put.' },
];

const TRUST_FACTS = [
  { value: 'Minutes', label: 'to a working app' },
  { value: 'No code', label: 'ever required' },
  { value: 'One place', label: 'for everything' },
  { value: 'Always', label: 'private & secure' },
];

function TrustSection() {
  return (
    <section className="trust-section" aria-labelledby="trust-heading">
      <div className="landing-section-intro">
        <p className="landing-kicker">Built on trust</p>
        <h2 id="trust-heading">Serious about your business.</h2>
        <p className="landing-section-lede">Software you can't trust is worse than no software. Here is what you can count on.</p>
      </div>
      <ul className="trust-benefits">
        {TRUST_BENEFITS.map(benefit => {
          const Icon = benefit.icon;
          return (
            <li key={benefit.title} className="trust-benefit">
              <span className="trust-benefit-icon"><Icon size={20} aria-hidden="true" /></span>
              <h3>{benefit.title}</h3>
              <p>{benefit.text}</p>
            </li>
          );
        })}
      </ul>
      <div className="trust-facts" aria-label="Key facts">
        <div className="trust-facts-inner">
          <div className="trust-facts-label"><Zap size={15} aria-hidden="true" /><span>Why owners choose BrainHalf</span></div>
          <div className="trust-facts-grid">
            {TRUST_FACTS.map(fact => (
              <div className="trust-fact" key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ Section ──────────────────────────────────────────────────────────────

function FaqSection() {
  return (
    <section className="faq-section" id="questions" aria-labelledby="faq-heading">
      <div className="faq-intro">
        <p className="landing-kicker">Questions</p>
        <h2 id="faq-heading">Before you begin.</h2>
        <p className="landing-section-lede">Straight answers, no sales talk.</p>
      </div>
      <div className="studio-faq-list">
        {HOME_FAQS.map((faq, index) => (
          <details key={faq.id} id={faq.id} open={index === 0} className="faq-item">
            <summary className="faq-summary">
              <h3>{faq.question}</h3>
              <Plus size={17} aria-hidden="true" className="faq-icon" />
            </summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function FinalCta({ onStartBuilding }: { onStartBuilding: (event?: React.MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <section className="final-cta-section" aria-labelledby="final-cta-heading">
      <div className="final-cta-card">
        <img className="final-cta-mark" src="/android-chrome-512x512.png" alt="" aria-hidden="true" width={512} height={512} loading="lazy" />
        <div className="final-cta-content">
          <p className="landing-kicker landing-kicker-on-dark">Start free</p>
          <h2 id="final-cta-heading">Your business,<br />running on software you described.</h2>
          <p>Start with a sentence. See where it takes you.</p>
          <a href="#start-building" className="final-cta-button" onClick={onStartBuilding}>
            Start building <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
  { href: '#examples', label: 'Examples' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#questions', label: 'FAQs' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/pricing', label: 'Pricing' },
];

export { tiltForCursor, LandingHero, InteractiveDemo, HowItWorks, BentoGrid, TrustSection, FaqSection, FinalCta };

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

  useScrollReveal();

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

      <main className="landing-main-content" id="main-content" tabIndex={-1}>
        <LandingHero
          promptText={promptText}
          onPromptTextChange={setPromptText}
          textareaRef={textareaRef}
          creatingProject={creatingProject}
          onPromptSubmit={handlePromptSubmit}
          onPromptKeyDown={handleKeyDown}
          onFocusComposer={focusComposer}
          onPickIdea={handleExamplePrompt}
        />

        <div data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <InteractiveDemo onUseIdea={handleExamplePrompt} />
        </div>

        <div data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <GalleryRow onUseIdea={handleExamplePrompt} />
        </div>

        <div data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <HowItWorks />
        </div>

        <div data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <BentoGrid />
        </div>

        <div data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <TrustSection />
        </div>

        <div data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <FaqSection />
        </div>

        <div data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <FinalCta onStartBuilding={focusComposer} />
        </div>
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingPage;
