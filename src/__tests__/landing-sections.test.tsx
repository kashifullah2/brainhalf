import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { InteractiveDemo } from '../components/landing/InteractiveDemo';
import { BentoGrid } from '../components/landing/BentoGrid';
import { HowItWorks } from '../components/landing/HowItWorks';
import { TrustSection } from '../components/landing/TrustSection';
import { FaqSection } from '../components/landing/FaqSection';
import { FinalCta } from '../components/landing/FinalCta';
import { GalleryRow } from '../components/GalleryRow';
import { HOME_FAQS } from '../seo/content';

const render = (element: React.ReactElement) => renderToString(element);

describe('InteractiveDemo', () => {
  it('renders four tabs with the tablist pattern and a sample-data panel', () => {
    const html = render(<InteractiveDemo onUseIdea={() => {}} />);
    expect(html).toContain('role="tablist"');
    for (const name of ['Inventory tool', 'Booking app', 'Simple CRM', 'Task manager']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('Sample data');
    // The idea card offers to fill the hero prompt.
    expect(html).toContain('Use this idea');
    // Owner photos carry dimensions (no layout shift) and lazy loading.
    expect(html).toContain('width="1920"');
    expect(html).toContain('loading="lazy"');
  });

  it('keeps tab and panel wired with accessible names', () => {
    const html = render(<InteractiveDemo onUseIdea={() => {}} />);
    expect(html).toContain('aria-controls="demo-panel"');
    expect(html).toContain('aria-selected="true"');
  });
});

describe('BentoGrid', () => {
  it('renders six tiles with the expected headings', () => {
    const html = render(<BentoGrid />);
    for (const heading of ['Describe it', 'Live preview', 'Edit by chatting', 'Your own database', 'Customer sign-in', 'Your own web address']) {
      expect(html).toContain(heading);
    }
    expect(html.match(/bento-tile span-/g)).toHaveLength(6);
  });
});

describe('HowItWorks', () => {
  it('renders three steps with one sticky visual region', () => {
    const html = render(<HowItWorks />);
    expect(html.match(/hiw-step[ "]|hiw-step$/g)).not.toBeNull();
    for (const title of ['Describe it in plain words', 'Refine it by chatting', 'Share it with the world']) {
      expect(html).toContain(title);
    }
    expect(html).toContain('hiw-sticky');
  });
});

describe('TrustSection', () => {
  it('states owner-facing benefits with no fabricated statistics', () => {
    const html = render(<TrustSection />);
    for (const heading of ['Your data stays yours', 'Checked before it goes live', 'Your own address']) {
      expect(html).toContain(heading);
    }
    expect(html).not.toMatch(/\d+%|\d+x faster|\d+,?\d+ (customers|users|apps)/i);
    expect(html).toContain('Real stories from business owners will appear here');
  });
});

describe('FaqSection', () => {
  it('renders one native disclosure per FAQ, keeps ids, and drops the updated-date line', () => {
    const html = render(<FaqSection />);
    expect(html.match(/<details/g)).toHaveLength(HOME_FAQS.length);
    expect(html).not.toContain('Updated');
    for (const faq of HOME_FAQS) {
      expect(html).toContain(`id="${faq.id}"`);
      expect(html).toContain(faq.question);
    }
  });
});

describe('FinalCta', () => {
  it('has a single button and a fully-specified brain mark', () => {
    const html = render(<FinalCta onStartBuilding={() => {}} />);
    expect(html.match(/Start building/g)).toHaveLength(1);
    expect(html).toContain('class="final-cta-mark"');
    expect(html).toContain('width="512"');
    expect(html).toContain('height="512"');
  });
});

describe('GalleryRow', () => {
  it('renders the gallery section with a loading state before apps arrive', () => {
    const html = render(<GalleryRow />);
    expect(html).toContain('Built by people like you.');
    expect(html).toContain('gallery-row-skeleton');
  });
});
