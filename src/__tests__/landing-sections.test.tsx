import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ExamplesSection, BentoGrid, HowItWorks, TrustSection, FaqSection, FinalCta } from '../components/landing/LandingPage';
import { GalleryRow } from '../components/GalleryRow';
import { HOME_FAQS } from '../seo/content';

const render = (element: React.ReactElement) => renderToString(element);

describe('ExamplesSection', () => {
  it('renders four example cards with Use this idea buttons', () => {
    const html = render(<ExamplesSection onUseIdea={() => {}} />);
    expect(html).toContain('example-card');
    expect(html).toContain('Use this idea');
    for (const name of ['Inventory', 'Bookings', 'Follow-ups', 'Task board']) {
      expect(html).toContain(name);
    }
  });
});

describe('BentoGrid', () => {
  it('renders six features with the expected headings', () => {
    const html = render(<BentoGrid />);
    for (const heading of ['Describe it', 'Live preview', 'Edit by chatting', 'Your own database', 'Customer sign-in', 'Your own web address']) {
      expect(html).toContain(heading);
    }
  });
});

describe('HowItWorks', () => {
  it('renders three steps', () => {
    const html = render(<HowItWorks />);
    for (const title of ['Describe it in plain words', 'Refine it by chatting', 'Share it with the world']) {
      expect(html).toContain(title);
    }
    expect(html).toContain('step-num');
  });
});

describe('TrustSection', () => {
  it('states owner-facing benefits with no fabricated statistics', () => {
    const html = render(<TrustSection />);
    for (const heading of ['Your data stays yours', 'Checked before it goes live', 'Your own address']) {
      expect(html).toContain(heading);
    }
    expect(html).not.toMatch(/\d+%|\d+x faster|\d+,?\d+ (customers|users|apps)/i);
  });
});

describe('FaqSection', () => {
  it('renders one native disclosure per FAQ with ids', () => {
    const html = render(<FaqSection />);
    expect(html.match(/<details/g)).toHaveLength(HOME_FAQS.length);
    for (const faq of HOME_FAQS) {
      expect(html).toContain(`id="${faq.id}"`);
      expect(html).toContain(faq.question);
    }
  });
});

describe('FinalCta', () => {
  it('has a Start building button', () => {
    const html = render(<FinalCta onStartBuilding={() => {}} />);
    expect(html).toContain('Start building');
  });
});

describe('GalleryRow', () => {
  it('renders the gallery section with a loading state before apps arrive', () => {
    const html = render(<GalleryRow />);
    expect(html).toContain('Built by people like you.');
    expect(html).toContain('gallery-row-skeleton');
  });
});
