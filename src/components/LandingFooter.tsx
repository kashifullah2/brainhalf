import React from 'react';
import BrainHalfLogo from './BrainHalfLogo';

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'AI app builder', href: '/' },
      { label: 'Gallery', href: '/gallery' },
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

  return (
    <footer className="landing-footer" aria-label="Landing footer">
      <div className="landing-footer-grid">
        <div className="landing-footer-brand-col">
          <a className="landing-footer-brand" href="/" aria-label="BrainHalf home"><BrainHalfLogo size={26} />BrainHalf</a>
          <p className="landing-footer-tagline">Describe your idea, watch it become a working app, and publish it — all from one workspace. Free to start, no coding required.</p>
        </div>
        {COLUMNS.map(column => (
          <nav key={column.title} className="landing-footer-col" aria-label={column.title}>
            <p className="landing-footer-heading">{column.title}</p>
            {column.links.map(link => <a key={link.href} className="landing-footer-link" href={link.href}>{link.label}</a>)}
          </nav>
        ))}
      </div>
      <div className="landing-footer-bottom">
        <span className="landing-footer-copy">© {year} BrainHalf. A little thought goes a long way.</span>
        <div className="landing-footer-legal">
          <a className="landing-footer-link" href="/privacy">Privacy</a>
          <a className="landing-footer-link" href="/terms">Usage guidelines</a>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
