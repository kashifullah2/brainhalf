import React from 'react';
import { ArrowRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import { BrainHalfLogo } from './BrainHalfLogo';
import SiteHeaderActions from './SiteHeaderActions';
import MobileNav from './MobileNav';
import LandingFooter from './LandingFooter';
import ContactForm from './ContactForm';
import { findPublicPage, formatContentDate, type PublicPage as PageContent } from '../seo/content';
import './LandingPage.css';
import './PublicPage.css';

const NAV_LINKS = [
  { href: '/', label: 'AI app builder' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/guides/build-an-app-with-ai', label: 'Build guide' },
  { href: '/about', label: 'About' },
];

export default function PublicPage({ page }: { page?: PageContent }) {
  return <div className="landing-container public-page">
    <a href="#main-content" className="studio-skip-link">Skip to content</a>
    <header className="landing-header">
      <a className="landing-brand-group" href="/" aria-label="BrainHalf home"><span className="landing-brand-logo"><BrainHalfLogo size={27} color="currentColor" /></span><span className="landing-brand-text">BrainHalf</span></a>
      <nav className="studio-navigation" aria-label="Main navigation"><a href="/">AI app builder</a><a href="/gallery">Gallery</a><a href="/guides/build-an-app-with-ai">Build guide</a><a href="/about">About</a></nav>
      <div className="landing-header-right"><MobileNav links={NAV_LINKS} /><SiteHeaderActions /></div>
    </header>
    <main className="landing-main-content" id="main-content">
      {page ? <>
        <nav className="public-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><ChevronRight size={13} /><span aria-current="page">{page.category}</span></nav>
        <div className="public-intro"><p className="studio-section-label">{page.category}</p><h1>{page.heading}</h1><p className="public-summary">{page.summary}</p><div className="public-content-meta">{page.path.startsWith('/guides/') && <span>By <a href="/about" rel="author">BrainHalf</a></span>}<span>Updated <time dateTime={page.dateModified}>{formatContentDate(page.dateModified)}</time></span></div></div>
        <div className="public-body">
          <aside className="public-contents"><nav aria-label="On this page"><p>On this page</p>{page.sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav><a className="public-start" href="/#start-building">Try your idea <ArrowUpRight size={15} /></a></aside>
          <article className="public-article" aria-label={page.heading}>
            {page.path === '/contact' && <>
              <section aria-labelledby="contact-email-heading">
                <h2 id="contact-email-heading">Email us directly</h2>
                <p>For account help, questions about the builder, or feedback, email <a href="mailto:support@brainhalf.com">support@brainhalf.com</a>.</p>
                <p>For administrative, privacy, or business enquiries, email <a href="mailto:admin@brainhalf.com">admin@brainhalf.com</a>.</p>
              </section>
              <ContactForm />
            </>}
            {page.sections.map(section => <section key={section.id} id={section.id}>
              <h2>{section.title}</h2>
              {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
              {section.figure && <figure className="public-example-figure"><img src={section.figure.src} alt={section.figure.alt} width={section.figure.width} height={section.figure.height} loading="lazy" decoding="async" /><figcaption>{section.figure.caption}</figcaption></figure>}
              {section.items && <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>}
              {section.example && <div className="public-prompt-example"><span>Example prompt</span><blockquote>{section.example}</blockquote><a href="/#start-building">Open the app builder <ArrowRight size={14} /></a></div>}
              {section.references && <div className="public-references"><p>Reference documentation</p><ul>{section.references.map(reference => <li key={reference.url}><a href={reference.url}>{reference.label}<ArrowUpRight size={14} aria-hidden="true" /></a></li>)}</ul></div>}
            </section>)}
          </article>
        </div>
        <section className="public-related" aria-labelledby="related-heading"><p className="studio-section-label">KEEP EXPLORING</p><h2 id="related-heading">A useful next step</h2><div>{page.related.map(path => {
          const related = findPublicPage(path);
          return related && <a href={related.path} key={path}><span>{related.category}</span><strong>{related.heading}</strong><ArrowUpRight size={18} /></a>;
        })}</div></section>
        <section className="studio-closing"><div><p className="studio-section-label">PUT YOUR IDEA INTO WORDS</p><h2>Start with the app you need.</h2></div><a href="/#start-building" className="studio-closing-link">Open BrainHalf <ArrowUpRight size={18} /></a></section>
      </> : <section className="public-not-found"><p className="studio-section-label">PAGE NOT FOUND</p><h1>This page isn’t here.</h1><p>The address may have changed. Return to the builder or explore the app-building guide.</p><a className="landing-get-started-btn" href="/">Back to BrainHalf <ArrowRight size={16} /></a><a href="/guides/build-an-app-with-ai">Read the build guide</a></section>}
    </main>
    <LandingFooter />
  </div>;
}
