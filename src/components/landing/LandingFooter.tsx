/* LandingFooter.tsx */
import React from 'react';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
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
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <footer className="lp-footer" aria-label="Site footer">
      <div className="footer-shell">
        <div className="footer-top">
          <div>
            <a className="footer-brand" href="/" aria-label="BrainHalf home">
              <BrainHalfLogo size={26} />
              <span>BrainHalf</span>
            </a>
            <p className="footer-tagline">
              Describe your idea, watch it become a working app, and publish it. Free to start, no coding required.
            </p>
            <div className="footer-actions">
              <span className="footer-status">
                <i aria-hidden="true" />
                All systems operational
              </span>
              <button type="button" className="footer-top-btn" onClick={scrollToTop}>
                Back to top&nbsp;↑
              </button>
            </div>
          </div>

          <div className="footer-cols">
            {COLUMNS.map(column => (
              <nav key={column.title} className="footer-col" aria-label={column.title}>
                <p className="footer-heading">{column.title}</p>
                {column.links.map(link => (
                  <a key={link.label} className="footer-link" href={link.href}>
                    {link.label}
                    {link.href.startsWith('mailto:') && <ArrowUpRight size={12} aria-hidden="true" />}
                  </a>
                ))}
              </nav>
            ))}
          </div>
        </div>

        <div className="footer-wordmark" aria-hidden="true">
          BrainHalf
        </div>

        <div className="footer-bottom">
          <span>© {year} BrainHalf. A little thought goes a long way.</span>
          <span className="footer-secure">
            <ShieldCheck size={12} aria-hidden="true" /> Private by default
          </span>
          <span className="footer-legal">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Usage guidelines</a>
            <a href="/contact">Contact</a>
          </span>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
