import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { BrainHalfLogo } from './BrainHalfLogo';
import MobileNav, { type MobileNavLink } from './MobileNav';
import SiteHeaderActions, { type HeaderUser } from './SiteHeaderActions';

interface SiteNavbarProps {
  /** Desktop + mobile navigation links. */
  links: MobileNavLink[];
  currentUser?: HeaderUser | null;
  onLogout?: () => void | Promise<void>;
  onOpenDashboard?: () => void;
  onAuthRequest?: (mode?: 'login' | 'signup') => void;
  /** Hide the Dashboard shortcut for signed-in users (app-internal pages). */
  hideDashboard?: boolean;
  /**
   * What happens when the brand is clicked. Defaults to navigating home.
   * The landing page passes a smooth scroll-to-top instead.
   */
  onBrandClick?: (event: React.MouseEvent) => void;
}

export const SiteNavbar: React.FC<SiteNavbarProps> = ({
  links,
  currentUser,
  onLogout,
  onOpenDashboard,
  onAuthRequest,
  hideDashboard = false,
  onBrandClick,
}) => {
  const [condensed, setCondensed] = useState(false);
  const [activeHash, setActiveHash] = useState('');
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const updateHash = () => setActiveHash(window.location.hash || '');
    updateHash();
    window.addEventListener('hashchange', updateHash);
    return () => window.removeEventListener('hashchange', updateHash);
  }, []);

  const handleBrandClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (onBrandClick) {
      event.preventDefault();
      onBrandClick(event);
    }
  };

  return (
    <header ref={headerRef} className={`site-navbar${condensed ? ' site-navbar-condensed' : ''}`}>
      <div className="site-navbar-left">
        <a
          className="site-brand"
          href="/"
          onClick={handleBrandClick}
          aria-label="BrainHalf home"
        >
          <span className="site-brand-logo">
            <BrainHalfLogo size={26} strokeWidth={1.7} color="currentColor" />
          </span>
          <span className="site-brand-text">BrainHalf</span>
          <span className="site-brand-badge" aria-hidden="true">
            <Sparkles size={10} /> Studio
          </span>
        </a>
      </div>

      <nav className="site-nav" aria-label="Main navigation">
        {links.map(link => {
          const isCurrent = link.current || (link.href.startsWith('#') && activeHash === link.href);
          return (
            <a
              key={link.href}
              href={link.href}
              className={isCurrent ? 'is-active' : undefined}
              onClick={() => {
                if (link.href.startsWith('#')) setActiveHash(link.href);
              }}
            >
              {link.label}
            </a>
          );
        })}
      </nav>

      <div className="site-navbar-right">
        <MobileNav links={links} />
        <SiteHeaderActions
          currentUser={currentUser}
          onLogout={onLogout}
          onOpenDashboard={onOpenDashboard}
          onAuthRequest={onAuthRequest}
          hideDashboard={hideDashboard}
        />
      </div>
    </header>
  );
};

export default SiteNavbar;
