import React, { useEffect, useRef, useState } from 'react';
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

/**
 * The single public-site navbar: brand, desktop links, auth actions, theme
 * toggle, and the mobile hamburger menu in one component. Previously every
 * public page assembled these from three separate pieces (an inline header,
 * MobileNav, SiteHeaderActions); that duplication is gone.
 */
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
  const headerRef = useRef<HTMLElement>(null);

  // Condense the sticky nav once the page scrolls: slimmer bar, deeper blur.
  useEffect(() => {
    const onScroll = () => setCondensed(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleBrandClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (onBrandClick) {
      event.preventDefault();
      onBrandClick(event);
    }
  };

  return (
    <header ref={headerRef} className={`site-navbar${condensed ? ' site-navbar-condensed' : ''}`}>
      <a
        className="site-brand"
        href="/"
        onClick={handleBrandClick}
        aria-label="BrainHalf home"
      >
        <span className="site-brand-logo">
          <BrainHalfLogo size={27} strokeWidth={1.6} color="currentColor" />
        </span>
        <span className="site-brand-text">BrainHalf</span>
      </a>

      <nav className="site-nav" aria-label="Main navigation">
        {links.map(link => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
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
