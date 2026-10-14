import React from 'react';
import { ArrowRight } from 'lucide-react';
import './FinalCta.css';

interface FinalCtaProps {
  onStartBuilding: (event?: React.MouseEvent<HTMLAnchorElement>) => void;
}

export const FinalCta: React.FC<FinalCtaProps> = ({ onStartBuilding }) => (
  <section className="final-cta-section" aria-labelledby="final-cta-heading">
    <div className="final-cta-card">
      <img
        className="final-cta-mark"
        src="/android-chrome-512x512.png"
        alt=""
        aria-hidden="true"
        width={512}
        height={512}
        loading="lazy"
      />
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

export default FinalCta;
