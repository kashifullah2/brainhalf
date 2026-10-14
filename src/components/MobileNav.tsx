import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, Menu, Sparkles, X } from 'lucide-react';

export interface MobileNavLink { href: string; label: string; current?: boolean }

export function shouldCloseMenuOnPointerDown(insideMenu: boolean, insideToggleButton: boolean): boolean {
  return !insideMenu && !insideToggleButton;
}

export default function MobileNav({ links }: { links: MobileNavLink[] }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideMenu = menuRef.current?.contains(target) ?? false;
      const insideToggle = buttonRef.current?.contains(target) ?? false;
      if (shouldCloseMenuOnPointerDown(insideMenu, insideToggle)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="landing-mobile-menu-btn"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(previous => !previous)}
      >
        {open ? <X size={19} /> : <Menu size={19} />}
      </button>
      {open && (
        <div className="landing-mobile-nav" id="mobile-nav" ref={menuRef} role="dialog" aria-label="Navigation menu">
          <div className="landing-mobile-nav-header">
            <span className="landing-mobile-nav-kicker">
              <Sparkles size={12} aria-hidden="true" /> BrainHalf AI Studio
            </span>
            <span className="landing-mobile-nav-status">Live Edge</span>
          </div>
          <nav aria-label="Mobile navigation">
            {links.map(link => {
              const isExternalRoute = link.href.startsWith('/');
              return (
                <a
                  key={link.href}
                  href={link.href}
                  {...(link.current ? { 'aria-current': 'page' as const } : {})}
                  onClick={() => setOpen(false)}
                >
                  <span>{link.label}</span>
                  {isExternalRoute ? <ArrowUpRight size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                </a>
              );
            })}
          </nav>
          <div className="landing-mobile-nav-footer">
            <a href="#start-building" className="landing-mobile-cta" onClick={() => setOpen(false)}>
              Start building for free
            </a>
          </div>
        </div>
      )}
    </>
  );
}
