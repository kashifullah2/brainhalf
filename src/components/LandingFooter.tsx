import React from 'react';
import BrainHalfLogo from './BrainHalfLogo';

export const LandingFooter: React.FC = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="landing-footer" aria-label="Landing footer">
      <div className="landing-footer-left">
        <span className="landing-footer-brand" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><BrainHalfLogo size={24} />BrainHalf</span>
        <span className="landing-footer-copy">© {year} BrainHalf. A little thought goes a long way.</span>
      </div>
      <nav className="landing-footer-nav" aria-label="Footer links">
        <a className="landing-footer-link" href="/about">About</a>
        <a className="landing-footer-link" href="/contact">Contact</a>
        <a className="landing-footer-link" href="mailto:support@brainhalf.com">Support</a>
        <a className="landing-footer-link" href="/guides/build-an-app-with-ai">Build guide</a>
        <a className="landing-footer-link" href="/guides/full-stack-apps">Full-stack guide</a>
        <a className="landing-footer-link" href="/free-ai-app-builder">Free AI app builder</a>
        <a className="landing-footer-link" href="/privacy">Privacy</a>
        <a className="landing-footer-link" href="/terms">Usage guidelines</a>
      </nav>
    </footer>
  );
};

export default LandingFooter;
