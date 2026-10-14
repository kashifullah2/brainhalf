import React, { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  Check,
  ChevronRight,
  ClipboardList,
  Package,
  Plus,
  Users,
} from 'lucide-react';
import { BUSINESS_APPS } from '../../lib/business-apps';
import './InteractiveDemo.css';

interface InteractiveDemoProps {
  onUseIdea: (prompt: string) => void;
}

const TAB_ORDER = ['inventory', 'booking', 'crm', 'tasks'] as const;

const TAB_META: Record<string, { icon: typeof Package; ownerPhoto?: string; ownerCaption: string; business: string }> = {
  inventory: {
    icon: Package,
    ownerPhoto: '/images/landing/demo-inventory-owner.webp',
    ownerCaption: 'A café owner checking stock',
    business: 'Inventory tool',
  },
  booking: {
    icon: CalendarCheck,
    ownerCaption: 'A salon keeping its day in order',
    business: 'Booking app',
  },
  crm: {
    icon: Users,
    ownerPhoto: '/images/landing/demo-crm-owner.webp',
    ownerCaption: 'A farmer keeping customers close',
    business: 'Simple CRM',
  },
  tasks: {
    icon: ClipboardList,
    ownerPhoto: '/images/landing/demo-tasks-owner.webp',
    ownerCaption: 'A boutique owner planning the day',
    business: 'Task manager',
  },
};

const DEMO_APPS = TAB_ORDER.map(id => BUSINESS_APPS.find(app => app.id === id)!).filter(Boolean);

/* ---------------------------------- sample UIs ---------------------------------- */

function SampleBadge() {
  return <span className="demo-sample-badge">Sample data</span>;
}

function InventorySample() {
  const [restocked, setRestocked] = useState(false);
  return (
    <div className="demo-sample">
      <div className="demo-sample-head">
        <strong><Package size={15} aria-hidden="true" /> Corner Café stockroom</strong>
        <SampleBadge />
      </div>
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
        <button type="button" onClick={() => setRestocked(value => !value)}>
          {restocked ? 'Reset demo' : 'Add 20 cartons'}<Plus size={13} aria-hidden="true" />
        </button>
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
    if (mine === slot) { setMine(null); return; }
    setMine(slot);
  };
  return (
    <div className="demo-sample">
      <div className="demo-sample-head">
        <strong><CalendarCheck size={15} aria-hidden="true" /> Thursday at the salon</strong>
        <SampleBadge />
      </div>
      <p className="demo-sample-sub">Tap a free slot to book it. Booked times stay blocked, so nothing gets double-booked.</p>
      <ul className="demo-slots" aria-label="Appointment slots">
        {DAY_SLOTS.map(slot => {
          const taken = booked.includes(slot);
          const isMine = mine === slot;
          return (
            <li key={slot}>
              <button
                type="button"
                className={`demo-slot${taken ? ' is-taken' : ''}${isMine ? ' is-mine' : ''}`}
                disabled={taken}
                aria-pressed={isMine}
                aria-label={taken ? `${slot}, booked` : isMine ? `${slot}, your booking. Activate to cancel` : `${slot}, free. Activate to book`}
                onClick={() => toggle(slot)}
              >
                <span>{slot}</span>
                <small>{taken ? 'Booked' : isMine ? 'Your cut' : 'Free'}</small>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="demo-sample-note" aria-live="polite">
        {mine ? `Booked for ${mine}. In your app this would save to your database.` : 'No booking yet — pick a free slot above.'}
      </p>
    </div>
  );
}

function CrmSample() {
  const [stages, setStages] = useState<Record<string, number>>({ 'Olive Studio': 0, 'Northside Café': 1, 'Paper House': 2 });
  const stageNames = ['New', 'Contacted', 'Won'];
  const advance = (name: string) =>
    setStages(current => ({ ...current, [name]: Math.min(2, (current[name] ?? 0) + 1) }));
  return (
    <div className="demo-sample">
      <div className="demo-sample-head">
        <strong><Users size={15} aria-hidden="true" /> People to follow up with</strong>
        <SampleBadge />
      </div>
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
              <td>
                {stages[row.name] < 2 && (
                  <button type="button" className="demo-mini-btn" onClick={() => advance(row.name)} aria-label={`Move ${row.name} to ${stageNames[stages[row.name] + 1]}`}>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                )}
              </td>
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
  const columns: { title: string; items: string[] }[] = [
    { title: 'To do', items: ['Count the stockroom', 'Call Friday customers'] },
    { title: 'Doing', items: ['Prepare café delivery'] },
    { title: 'Done', items: ['Confirm supplier order', ...done] },
  ];
  const complete = (item: string) => setDone(current => (current.includes(item) ? current : [...current, item]));
  return (
    <div className="demo-sample">
      <div className="demo-sample-head">
        <strong><ClipboardList size={15} aria-hidden="true" /> This week at the boutique</strong>
        <SampleBadge />
      </div>
      <div className="demo-board">
        {columns.map(column => (
          <div className="demo-column" key={column.title}>
            <p className="demo-column-title">{column.title}</p>
            <ul>
              {column.items.map(item => {
                const finished = done.includes(item);
                const actionable = !finished && column.title !== 'Done';
                return (
                  <li key={item} className={finished ? 'is-done' : ''}>
                    {actionable ? (
                      <button type="button" onClick={() => complete(item)} aria-label={`Mark “${item}” as done`}>
                        <span className="demo-check" aria-hidden="true">{finished ? <Check size={12} /> : null}</span>
                        {item}
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

/* ---------------------------------- component ---------------------------------- */

export const InteractiveDemo: React.FC<InteractiveDemoProps> = ({ onUseIdea }) => {
  const [selected, setSelected] = useState(0);
  const app = DEMO_APPS[selected];
  const meta = TAB_META[app.id];

  const selectTab = (index: number) => setSelected(index);

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
        <p className="landing-section-lede">
          These are the kinds of working tools people build. Click through them — every button does something.
        </p>
      </div>

      <div className="demo-tabs" role="tablist" aria-label="Example apps you can try">
        {DEMO_APPS.map((item, index) => {
          const Icon = TAB_META[item.id].icon;
          const isSelected = selected === index;
          return (
            <button
              key={item.id}
              id={`demo-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls="demo-panel"
              tabIndex={isSelected ? 0 : -1}
              className={isSelected ? 'is-selected' : ''}
              onClick={() => selectTab(index)}
              onKeyDown={event => onTabKeyDown(event, index)}
            >
              <Icon size={15} aria-hidden="true" />
              {TAB_META[item.id].business}
            </button>
          );
        })}
      </div>

      <div
        className="demo-panel"
        role="tabpanel"
        id="demo-panel"
        aria-labelledby={`demo-tab-${app.id}`}
        tabIndex={0}
      >
        <div className="demo-idea">
          {meta.ownerPhoto && (
            <figure className="demo-owner">
              <img
                src={meta.ownerPhoto}
                alt={meta.ownerCaption}
                width={1920}
                height={1280}
                loading="lazy"
              />
              <figcaption>{meta.ownerCaption}</figcaption>
            </figure>
          )}
          <p className="demo-idea-label">It starts with an idea like this</p>
          <blockquote className="demo-prompt">“{app.prompt}”</blockquote>
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
            <a href="#start-building" onClick={event => { event.preventDefault(); onUseIdea(app.prompt); }}>
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
};

export default InteractiveDemo;
