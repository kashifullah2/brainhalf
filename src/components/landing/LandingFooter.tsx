import React from 'react';
import { ArrowUp, Cpu, Database, Globe2, ShieldCheck } from 'lucide-react';
import BrainHalfLogo from '../BrainHalfLogo';

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'AI app builder', href: '/' },
      { label: 'Gallery', href: '/gallery' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'FAQ', href: '/faq' },
      { label: 'Free AI app builder', href: '/free-ai-app-builder' },
      { label: 'About', href: '/about' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Build guide', href: '/guides/build-an-app-with-ai' },
      { label: 'Full-stack guide', href: '/guides/full-stack-apps' },
      { label: 'Contact', href: '/contact' },
      { label: 'Support', href: 'mailto:support@brainhalf.com' },
    ],
  },
  {
    title: 'Use cases',
    links: [
      { label: 'Inventory apps', href: '/use-cases/ai-inventory-app-builder' },
      { label: 'Book inventory', href: '/use-cases/book-inventory-app-builder' },
      { label: 'Dashboards', href: '/use-cases/ai-dashboard-builder' },
      { label: 'Customer portals', href: '/use-cases/customer-dashboard-builder' },
      { label: 'Websites', href: '/use-cases/ai-website-builder' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Usage guidelines', href: '/terms' },
    ],
  },
];

export const LandingFooter: React.FC = () => {
  const year = new Date().getFullYear();

  const scrollToTop = () => {
    if (typeof window === 'undefined') return;
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return (
    <footer className="landing-footer" aria-label="Landing footer">
      <div className="landing-footer-shell">
        <div className="landing-footer-Statusbar">
          <div className="landing-footer-status-pill">
            <span className="landing-footer-status-dot" aria-hidden="true" />
            <span>All studio &amp; edge runtime regions operational</span>
          </div>
          <div className="landing-footer-stack-pills" aria-label="Platform capabilities">
            <span><Cpu size={12} aria-hidden="true" /> React 19 + Vite</span>
            <span><Database size={12} aria-hidden="true" /> Cloudflare D1 SQLite</span>
            <span><ShieldCheck size={12} aria-hidden="true" /> Managed Auth</span>
            <span><Globe2 size={12} aria-hidden="true" /> Global Edge Hosting</span>
          </div>
        </div>

        <div className="landing-footer-grid">
          <div className="landing-footer-brand-col">
            <a className="landing-footer-brand" href="/" aria-label="BrainHalf home">
              <span className="landing-footer-brand-mark">
                <BrainHalfLogo size={24} />
              </span>
              <span>BrainHalf</span>
            </a>
            <p className="landing-footer-tagline">
              Describe your idea, watch it become a working full-stack application with its own database and sign-in, and publish it to your own address from one studio.
            </p>
            <button type="button" className="landing-footer-top-btn" onClick={scrollToTop}>
              <ArrowUp size={13} aria-hidden="true" />
              <span>Back to top</span>
            </button>
          </div>
          {COLUMNS.map(column => (
            <nav key={column.title} className="landing-footer-col" aria-label={column.title}>
              <p className="landing-footer-heading">{column.title}</p>
              {column.links.map(link => (
                <a key={link.href} className="landing-footer-link" href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          ))}
        </div>

        <div className="landing-footer-bottom">
          <span className="landing-footer-copy">© {year} BrainHalf. A little thought goes a long way.</span>
          <div className="landing-footer-legal">
            <a className="landing-footer-link" href="/privacy">Privacy</a>
            <a className="landing-footer-link" href="/terms">Usage guidelines</a>
            <a className="landing-footer-link" href="/contact">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
