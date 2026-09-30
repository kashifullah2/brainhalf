import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Pretend the theme hook already resolved to dark (as it does on the client
// after theme-init.js sets data-theme="dark" before hydration). The toggle's
// first render must still match the prerendered light-theme HTML, or React
// throws a #418 hydration mismatch for every dark-mode visitor.
vi.mock('../lib/theme', () => ({
  useTheme: () => 'dark',
  setTheme: vi.fn(),
}));

import ThemeToggle from '../components/ThemeToggle';
import MobileNav from '../components/MobileNav';
import PublicPage from '../components/PublicPage';
import GalleryPage from '../components/GalleryPage';

describe('ThemeToggle hydration safety', () => {
  it('renders the light-theme markup on first paint even when the theme is dark', () => {
    const html = renderToStaticMarkup(<ThemeToggle />);
    expect(html).toContain('Switch to dark mode');
    expect(html).not.toContain('Switch to light mode');
  });
});

describe('MobileNav', () => {
  const links = [
    { href: '/', label: 'AI app builder' },
    { href: '/gallery', label: 'Gallery' },
    { href: '/about', label: 'About' },
  ];

  it('renders a collapsed menu button, not the open nav, on first paint', () => {
    const html = renderToStaticMarkup(<MobileNav links={links} />);
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('aria-expanded="false"');
    // The dropdown links only appear after the user opens the menu.
    expect(html).not.toContain('aria-label="Mobile navigation"');
  });
});

describe('interior page mobile navigation', () => {
  it('PublicPage renders the hamburger menu button', () => {
    const html = renderToStaticMarkup(<PublicPage />);
    expect(html).toContain('landing-mobile-menu-btn');
    expect(html).toContain('aria-label="Open menu"');
  });

  it('GalleryPage renders the hamburger menu button', () => {
    const html = renderToStaticMarkup(<GalleryPage />);
    expect(html).toContain('landing-mobile-menu-btn');
    expect(html).toContain('aria-label="Open menu"');
  });
});
