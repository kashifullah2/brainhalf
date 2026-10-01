import React, { useState, useRef } from 'react';
import SiteNavbar from './SiteNavbar';
import LandingFooter from './LandingFooter';
import LandingHero from './LandingHero';
import InteractiveDemo from './InteractiveDemo';
import GalleryRow from './GalleryRow';
import HowItWorks from './HowItWorks';
import BentoGrid from './BentoGrid';
import TrustSection from './TrustSection';
import FaqSection from './FaqSection';
import FinalCta from './FinalCta';
import './LandingPage.css';
import './PublicPage.css';

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

        <InteractiveDemo onUseIdea={handleExamplePrompt} />

        <GalleryRow />

        <HowItWorks />

        <BentoGrid />

        <TrustSection />

        <FaqSection />

        <FinalCta onStartBuilding={focusComposer} />
      </main>

      <LandingFooter />
    </div>
  );
};

export default LandingPage;
