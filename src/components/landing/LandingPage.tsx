import React, { useState, useRef } from 'react';
import SiteNavbar from '../SiteNavbar';
import LandingFooter from './LandingFooter';
import LandingHero from './LandingHero';
import InteractiveDemo from './InteractiveDemo';
import GalleryRow from '../GalleryRow';
import HowItWorks from './HowItWorks';
import BentoGrid from './BentoGrid';
import TrustSection from './TrustSection';
import FaqSection from './FaqSection';
import FinalCta from './FinalCta';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import './LandingPage.css';
import '../PublicPage.css';

interface LandingPageProps {
  onOpenProject: (projectId: string) => void;
  onSubmitInitialPrompt: (prompt: string) => void;
  creatingProject?: boolean;
  currentUser?: { email?: string; name?: string } | null;
  onLogout?: () => void | Promise<void>;
  onLoginRequest?: (mode?: 'login' | 'signup') => void;
  onOpenDashboard?: () => void;
}

const NAV_LINKS = [
  { href: '#examples', label: 'Examples' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#questions', label: 'FAQs' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/pricing', label: 'Pricing' },
];

const STUDIO_CAPABILITIES = [
  'Inventory & Stockrooms',
  'Appointment Booking',
  'Client Portals & CRMs',
  'Field Service Trackers',
  'Custom Order Forms',
  'Team Task Boards',
  'Invoice & Quote Logs',
  'Real-Time Dashboards',
];

export const LandingPage: React.FC<LandingPageProps> = ({
  onSubmitInitialPrompt,
  creatingProject = false,
  currentUser,
  onLogout,
  onLoginRequest,
  onOpenDashboard,
}) => {
  const [promptText, setPromptText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useScrollReveal();

  const handlePromptSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (creatingProject) return;
    const trimmed = promptText.trim();
    if (!trimmed) return;
    onSubmitInitialPrompt(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      handlePromptSubmit();
    }
  };

  const focusComposer = (event?: React.MouseEvent<HTMLAnchorElement>) => {
    event?.preventDefault();
    textareaRef.current?.focus({ preventScroll: true });
    textareaRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'center',
    });
  };

  const handleExamplePrompt = (prompt: string) => {
    setPromptText(prompt);
    focusComposer();
  };

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };

  return (
    <div className="landing-container">
      <a className="studio-skip-link" href="#main-content">Skip to content</a>

      <SiteNavbar
        links={NAV_LINKS}
        currentUser={currentUser ?? null}
        onLogout={onLogout}
        onOpenDashboard={onOpenDashboard}
        onAuthRequest={onLoginRequest}
        onBrandClick={scrollToTop}
      />

      <main className="landing-main-content" id="main-content" tabIndex={-1}>
        <LandingHero
          promptText={promptText}
          onPromptTextChange={setPromptText}
          textareaRef={textareaRef}
          creatingProject={creatingProject}
          onPromptSubmit={handlePromptSubmit}
          onPromptKeyDown={handleKeyDown}
          onFocusComposer={focusComposer}
        />

        {/* Kinetic Studio Ticker */}
        <section className="studio-ticker-strip" aria-label="Supported app types">
          <div className="studio-ticker-label">BUILT FOR REAL WORK</div>
          <div className="studio-ticker-track">
            {[...STUDIO_CAPABILITIES, ...STUDIO_CAPABILITIES].map((item, idx) => (
              <span key={`${item}-${idx}`} className="studio-ticker-item">
                <i className="studio-ticker-diamond" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </section>

        <div className="studio-section-block" data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <div className="studio-index-rail" aria-hidden="true">
            <span className="index-rail-code">01 // INTERACTIVE SANDBOX</span>
            <span className="index-rail-line" />
            <span className="index-rail-meta">LIVE PREVIEW</span>
          </div>
          <InteractiveDemo onUseIdea={handleExamplePrompt} />
        </div>

        <div className="studio-section-block" data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <div className="studio-index-rail" aria-hidden="true">
            <span className="index-rail-code">02 // PRODUCTION GALLERY</span>
            <span className="index-rail-line" />
            <span className="index-rail-meta">READY TO REMIX</span>
          </div>
          <GalleryRow onUseIdea={handleExamplePrompt} />
        </div>

        <div className="studio-section-block" data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <div className="studio-index-rail" aria-hidden="true">
            <span className="index-rail-code">03 // ARCHITECTURE FLOW</span>
            <span className="index-rail-line" />
            <span className="index-rail-meta">3 STEPS TO LAUNCH</span>
          </div>
          <HowItWorks />
        </div>

        <div className="studio-section-block" data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <div className="studio-index-rail" aria-hidden="true">
            <span className="index-rail-code">04 // PLATFORM SPECIFICATIONS</span>
            <span className="index-rail-line" />
            <span className="index-rail-meta">INCLUDED BY DEFAULT</span>
          </div>
          <BentoGrid />
        </div>

        <div className="studio-section-block" data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <TrustSection />
        </div>

        <div className="studio-section-block" data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <div className="studio-index-rail" aria-hidden="true">
            <span className="index-rail-code">05 // COMMON QUESTIONS</span>
            <span className="index-rail-line" />
            <span className="index-rail-meta">PLAIN ANSWERS</span>
          </div>
          <FaqSection />
        </div>

        <div className="studio-section-block" data-reveal style={{ ['--reveal-delay' as string]: '0ms' }}>
          <FinalCta onStartBuilding={focusComposer} />
        </div>
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingPage;
