import React, { useState } from 'react';
import { Check, ChevronDown, Package, Plus, Globe2, LayoutGrid, Users, MoveUpRight } from 'lucide-react';
import './LandingShowcase.css';
import { BUSINESS_APPS } from '../lib/business-apps';

const EXAMPLES = [
  { ...BUSINESS_APPS[0], icon: Package },
  { ...BUSINESS_APPS[3], icon: LayoutGrid },
  { ...BUSINESS_APPS[2], icon: Users },
] as const;

function InventoryPreview() {
  const [restocked, setRestocked] = useState(false);
  return <div className="sample-inventory">
    <div className="sample-nav"><span className="sample-brand"><Package size={18} /> field & shelf</span><span>My shop <span className="sample-avatar">FS</span></span></div>
    <div className="sample-stock-content">
      <span className="sample-overline">A CLEAR VIEW OF YOUR STOCK</span><h3>Ready for the day.</h3>
      <div className="sample-stock-summary"><div><strong>{restocked ? '59' : '39'}</strong><span>items on hand</span></div><div><strong>{restocked ? '0' : '1'}</strong><span>needs a top-up</span></div><span className="sample-stock-saved"><Check size={12} /> Sample workspace</span></div>
      <table className="sample-stock-table"><caption>Stock at a glance</caption><thead><tr><th>Product</th><th>On hand</th><th>Status</th></tr></thead><tbody>
        <tr><td><strong>Everyday notebook</strong><small>ST-001 · Stationery</small></td><td>24</td><td><span>In stock</span></td></tr>
        <tr><td><strong>Ceramic cup</strong><small>HM-014 · Homeware</small></td><td>{restocked ? '23' : '3'}</td><td><span className={restocked ? '' : 'stock-low'}>{restocked ? 'In stock' : 'Low stock'}</span></td></tr>
        <tr><td><strong>Linen tote</strong><small>AC-008 · Accessories</small></td><td>12</td><td><span>In stock</span></td></tr>
      </tbody></table>
      <div className="sample-stock-action"><p aria-live="polite">{restocked ? 'Ceramic cups updated to 23. That’s one less thing to remember.' : 'Ceramic cups are running low. Try updating the stock.'}</p><button type="button" onClick={() => setRestocked(value => !value)}>{restocked ? 'Reset demo' : 'Add 20 cups'}<Plus size={12} /></button></div>
    </div>
  </div>;
}

function BoardPreview() {
  return (
    <div className="sample-board">
      <div className="sample-nav"><span className="sample-brand"><LayoutGrid size={17} /> goodwork</span><span className="sample-avatar">AL</span></div>
      <div className="sample-board-content">
        <span className="sample-overline">WORKSPACE / THIS WEEK</span>
        <h3>A clear plan for the week.</h3>
        <div className="sample-board-toolbar"><span>Board view <ChevronDown size={11} /></span><span><span className="sample-person">A</span><span className="sample-person second">M</span><Plus size={14} /></span></div>
        <div className="sample-columns">
          {[
            { title: 'To do', cards: [['Inventory', 'Count the stockroom', 'Monday'], ['Customers', 'Call Friday customers', 'Tuesday']] },
            { title: 'In progress', cards: [['Delivery', 'Prepare café delivery', 'Today'], ['Pricing', 'Update the price list', 'Tomorrow']] },
            { title: 'Done', cards: [['Suppliers', 'Confirm supplier order', 'Complete'], ['Customers', 'Reply to enquiries', 'Complete']] },
          ].map((column, index) => (
            <div className="sample-column" key={column.title}><div className="sample-column-heading"><i className={`sample-status status-${index}`} />{column.title}<span>2</span></div>{column.cards.map(([tag, title, date]) => <div className="sample-task" key={title}><span className={`sample-task-tag tag-${index}`}>{tag}</span><strong>{title}</strong><span className="sample-task-bottom">{date}<span className="sample-person">{index === 1 ? 'M' : 'A'}</span></span></div>)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CrmPreview() {
  return <div className="sample-crm"><div className="sample-nav"><span className="sample-brand"><Users size={18} /> good company</span><span className="sample-avatar">AL</span></div><div className="sample-stock-content"><span className="sample-overline">CUSTOMERS / FOLLOW-UPS</span><h3>Keep the conversation going.</h3><p className="sample-crm-intro">Three people. One clear next step for each.</p><table className="sample-stock-table"><caption>Your customer list</caption><thead><tr><th>Customer</th><th>Next step</th><th>Stage</th></tr></thead><tbody><tr><td><strong>Olive Studio</strong><small>Design supplies</small></td><td>Send quote</td><td><span className="stock-low">New</span></td></tr><tr><td><strong>Northside Café</strong><small>Weekly delivery</small></td><td>Call Friday</td><td><span>Contacted</span></td></tr><tr><td><strong>Paper House</strong><small>Monthly order</small></td><td>Prepare order</td><td><span>Won</span></td></tr></tbody></table><p className="sample-crm-intro">Customer details and notes, together in a private workspace.</p></div></div>;
}

export default function LandingShowcase({ onUsePrompt }: { onUsePrompt: (prompt: string) => void }) {
  const [selected, setSelected] = useState(0);
  const example = EXAMPLES[selected];
  return (
    <section className="studio-showcase" id="examples" aria-label="Explore example apps">
      <div className="studio-showcase-toolbar">
        <div className="studio-example-tabs" role="tablist" aria-label="Example app designs">
          {EXAMPLES.map((item, index) => <button key={item.id} id={`example-tab-${item.id}`} type="button" role="tab" aria-selected={selected === index} aria-controls="example-panel" tabIndex={selected === index ? 0 : -1} onClick={() => setSelected(index)} onKeyDown={event => {
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % EXAMPLES.length;
            else if (event.key === 'ArrowLeft') next = (index + EXAMPLES.length - 1) % EXAMPLES.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = EXAMPLES.length - 1;
            else return;
            event.preventDefault();
            setSelected(next);
            document.getElementById(`example-tab-${EXAMPLES[next].id}`)?.focus();
          }}><item.icon size={13} />{item.label}</button>)}
        </div>
      </div>
      <div className="studio-showcase-stage">
        <div className="studio-browser">
          <div className="studio-browser-bar"><span className="studio-browser-dots" aria-hidden="true"><i /><i /><i /></span><span><Globe2 size={11} aria-hidden="true" /> {example.label}</span><span className="studio-browser-preview">Example preview</span></div>
          <div role="tabpanel" id="example-panel" aria-labelledby={`example-tab-${example.id}`} tabIndex={0}>
            <div className="studio-example-content" aria-label={`${example.label} design concept with illustrative sample data`}>
              {selected === 0 ? <InventoryPreview /> : selected === 1 ? <BoardPreview /> : <CrmPreview />}
            </div>
          </div>
        </div>
      </div>
      <div className="studio-example-brief">
        <div><span className="studio-example-brief-label">IT STARTS WITH AN IDEA LIKE THIS</span><p>“{example.prompt}”</p></div>
        <button className="studio-example-note" onClick={() => onUsePrompt(example.prompt)} type="button">Use this idea <MoveUpRight size={14} /></button>
      </div>
      <p className="studio-example-caption">Interactive example with sample data. Your business records stay in your own app.</p>
    </section>
  );
}
