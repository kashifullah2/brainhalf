import React, { useCallback } from 'react';
import { Check, Globe2, Lock, MessageCircle, PenLine, Sparkles } from 'lucide-react';
import './BentoGrid.css';

function useSpotlight() {
  return useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tile = event.currentTarget;
    const rect = tile.getBoundingClientRect();
    tile.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    tile.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }, []);
}

/* Small coded visuals — each tile shows a miniature of the real thing, not just an icon. */

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

const TILES = [
  {
    id: 'describe',
    span: 'span-4',
    kicker: 'Start',
    title: 'Describe it',
    text: 'One sentence about the job to be done. No wireframes, no jargon, no technical plan needed.',
    visual: <DescribeVisual />,
    icon: PenLine,
  },
  {
    id: 'preview',
    span: 'span-2',
    kicker: 'Watch',
    title: 'Live preview',
    text: 'See your app take shape as it is built, and click through it any time.',
    visual: <PreviewVisual />,
    icon: Sparkles,
  },
  {
    id: 'chat',
    span: 'span-2',
    kicker: 'Refine',
    title: 'Edit by chatting',
    text: 'Ask for changes in plain words. Screens, data and sign-in update together.',
    visual: <ChatVisual />,
    icon: MessageCircle,
  },
  {
    id: 'database',
    span: 'span-2',
    kicker: 'Included',
    title: 'Your own database',
    text: 'Every app saves its records properly — not in a spreadsheet, not in memory.',
    visual: <DatabaseVisual />,
    icon: Check,
  },
  {
    id: 'signin',
    span: 'span-2',
    kicker: 'Included',
    title: 'Customer sign-in',
    text: 'Customers sign in with Google or email. Their records stay private to them.',
    visual: <SignInVisual />,
    icon: Lock,
  },
  {
    id: 'address',
    span: 'span-6',
    kicker: 'Launch',
    title: 'Your own web address',
    text: 'We check that everything works before anything goes live — and tell you in plain words if something needs fixing. Then your app gets an address you can share with customers.',
    visual: <AddressVisual />,
    icon: Globe2,
  },
];

export const BentoGrid: React.FC = () => {
  const spotlight = useSpotlight();
  return (
    <section className="bento-section" aria-labelledby="bento-heading">
      <div className="landing-section-intro">
        <p className="landing-kicker">Everything included</p>
        <h2 id="bento-heading">One workspace, start to share.</h2>
        <p className="landing-section-lede">The whole journey lives in one place — nothing to stitch together, nothing to install.</p>
      </div>
      <div className="bento-grid">
        {TILES.map((tile, i) => {
          const Icon = tile.icon;
          return (
            <article
              key={tile.id}
              className={`bento-tile ${tile.span}`}
              onMouseMove={spotlight}
              style={{ ['--tile-i' as string]: i }}
            >
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
};

export default BentoGrid;
