import React from 'react';
import { Database, Globe2, Quote, ShieldCheck } from 'lucide-react';
import './TrustSection.css';

const BENEFITS = [
  {
    icon: Database,
    title: 'Your data stays yours',
    text: 'Your business records live in your own app’s database, private to your sign-in. Nothing is shared, sold, or mixed with anyone else’s.',
  },
  {
    icon: ShieldCheck,
    title: 'Checked before it goes live',
    text: 'Every app is verified to work before it can be published. If something needs fixing, you get told in plain words — not an error code.',
  },
  {
    icon: Globe2,
    title: 'Your own address',
    text: 'Published apps get their own web address to share with customers. Take it offline any time; your data stays put.',
  },
];

export const TrustSection: React.FC = () => (
  <section className="trust-section" aria-labelledby="trust-heading">
    <div className="landing-section-intro">
      <p className="landing-kicker">Built on trust</p>
      <h2 id="trust-heading">Serious about your business.</h2>
      <p className="landing-section-lede">Software you can’t trust is worse than no software. Here is what you can count on.</p>
    </div>

    <ul className="trust-benefits">
      {BENEFITS.map(benefit => {
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

    <div className="trust-testimonial-slot" aria-label="Testimonials coming soon">
      <Quote size={22} aria-hidden="true" />
      <p><strong>Real stories from business owners will appear here.</strong></p>
      <p>We don’t invent testimonials, logos, or statistics. When owners tell us what BrainHalf did for them, their words go here — with permission.</p>
    </div>
  </section>
);

export default TrustSection;
