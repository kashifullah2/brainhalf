# BrainHalf Layout Components

## SiteNavbar
File: `src/components/SiteNavbar.tsx`
Description: Sticky public-facing nav. Condenses on scroll, supports mobile hamburger menu.

```tsx
export const SiteNavbar: React.FC<SiteNavbarProps> = ({
  links, currentUser, onLogout, onOpenDashboard, onAuthRequest, hideDashboard, onBrandClick,
}) => {
  const [condensed, setCondensed] = useState(false);
  // ...scroll handler for condensed state

  return (
    <header className={`site-navbar${condensed ? ' site-navbar-condensed' : ''}`}>
      <a className="site-brand" href="/" aria-label="BrainHalf home">
        <span className="site-brand-logo">
          <BrainHalfLogo size={26} strokeWidth={1.65} color="currentColor" />
        </span>
        <span className="site-brand-text">BrainHalf</span>
      </a>

      <nav className="site-nav" aria-label="Main navigation">
        {links.map(link => (
          <a key={link.href} href={link.href}>{link.label}</a>
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
```

CSS (from LandingPage.css):
```css
.site-navbar {
  --site-nav-h: 68px;
  max-width: 1280px;
  min-height: var(--site-nav-h);
  margin: auto;
  padding: 0 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  z-index: 120;
  background: color-mix(in srgb, var(--studio-paper) 88%, transparent);
  -webkit-backdrop-filter: blur(14px) saturate(1.4);
  backdrop-filter: blur(14px) saturate(1.4);
}
.site-navbar.site-navbar-condensed {
  --site-nav-h: 56px;
  background: color-mix(in srgb, var(--studio-paper) 94%, transparent);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.06);
}
.site-brand { display: flex; align-items: center; gap: 10px; padding: 6px 0; border: 0; background: none; color: var(--studio-ink); }
.site-brand-text { font-size: 20px; font-weight: 650; letter-spacing: -0.8px; }
.site-nav { display: flex; align-items: center; gap: 4px; font-size: 13.5px; font-weight: 500; color: var(--studio-muted); }
.site-nav a { padding: 7px 14px; border-radius: 999px; transition: color 150ms, background 150ms; }
.site-nav a:hover { color: var(--studio-ink); background: var(--bg-surface-hover); }
```

---

## LandingPage Layout
File: `src/components/landing/LandingPage.tsx`
Description: Full-page landing layout. Sections in order: Hero → InteractiveDemo → GalleryRow → HowItWorks → BentoGrid → TrustSection → FaqSection → FinalCta → Footer.

Structure:
```html
<div class="landing-container">
  <SiteNavbar />
  <main class="landing-main-content">
    <LandingHero />       <!-- Headline, prompt composer, product screenshot -->
    <InteractiveDemo />   <!-- Tabbed demo showing features -->
    <GalleryRow />        <!-- 3 example app cards -->
    <HowItWorks />        <!-- 3-step scroll animation -->
    <BentoGrid />         <!-- Feature grid -->
    <TrustSection />      <!-- Social proof/trust signals -->
    <FaqSection />        <!-- Accordion FAQ -->
    <FinalCta />          <!-- Bottom CTA banner -->
  </main>
  <LandingFooter />
</div>
```

`.landing-main-content { max-width: 1200px; margin: 0 auto; }`

---

## LandingFooter
File: `src/components/landing/LandingFooter.tsx`
Description: Multi-column editorial footer with brand column, 4 nav columns, copyright row.

```css
.landing-footer { max-width: 1200px; padding: 64px 0 88px; margin: 24px auto 0; border-top: 1px solid var(--studio-line); }
.landing-footer-grid { display: grid; grid-template-columns: 1.6fr repeat(4, 1fr); gap: 40px; }
.landing-footer-brand-col { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
.landing-footer-brand { font-size: 18px; font-weight: 650; letter-spacing: -0.5px; color: var(--studio-ink); }
.landing-footer-tagline { font-size: 13.5px; line-height: 1.7; color: var(--studio-muted); }
.landing-footer-heading { font-size: 11px; font-weight: 650; letter-spacing: 0.07em; text-transform: uppercase; }
.landing-footer-link { font-size: 13px; color: var(--studio-muted); min-height: 38px; }
.landing-footer-link:hover { color: var(--studio-blue); }
```
