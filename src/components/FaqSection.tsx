import React from 'react';
import { Plus } from 'lucide-react';
import { HOME_FAQS } from '../seo/content';
import './FaqSection.css';

/**
 * Accessible FAQ accordion built on native <details>/<summary> so every
 * question opens and closes without JavaScript and with full keyboard
 * support. One consistent icon pattern for all items: a plus that turns
 * into a cross when open.
 */
export const FaqSection: React.FC = () => (
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

export default FaqSection;
