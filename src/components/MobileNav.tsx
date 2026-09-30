import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';

export interface MobileNavLink { href: string; label: string; current?: boolean }

/**
 * Hamburger menu for the public site header on small screens, where
 * `.studio-navigation` is hidden (see LandingPage.css @media max-width: 640px).
 * Mirrors the inline mobile menu on LandingPage: Escape closes it, clicking
 * outside closes it, and choosing a link closes it.
 */
export default function MobileNav({ links }: { links: MobileNavLink[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open ]);

  return <>
    <button
      type="button"
      className="landing-mobile-menu-btn"
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      aria-controls="mobile-nav"
      onClick={() => setOpen(previous => !previous)}
    >
      {open ? <X size={20} /> : <Menu size={20} />}
    </button>
    {open && (
      <div className="landing-mobile-nav" id="mobile-nav" ref={menuRef} role="dialog" aria-label="Navigation menu">
        <nav aria-label="Mobile navigation">
          {links.map(link => (
            <a key={link.href} href={link.href} {...(link.current ? { 'aria-current': 'page' as const } : {})} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    )}
  </>;
}
