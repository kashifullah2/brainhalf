# BrainHalf Page Dependency Trees

## / (Landing Page)
Entry: `src/components/landing/LandingPage.tsx`
Dependencies:
- `src/components/SiteNavbar.tsx`
  - `src/components/BrainHalfLogo.tsx`
  - `src/components/MobileNav.tsx`
  - `src/components/SiteHeaderActions.tsx`
- `src/components/landing/LandingHero.tsx`
  - `src/components/landing/LandingHero.css`
- `src/components/landing/InteractiveDemo.tsx`
  - `src/components/landing/InteractiveDemo.css`
- `src/components/GalleryRow.tsx`
- `src/components/landing/HowItWorks.tsx`
  - `src/components/landing/HowItWorks.css`
- `src/components/landing/BentoGrid.tsx`
  - `src/components/landing/BentoGrid.css`
- `src/components/landing/TrustSection.tsx`
  - `src/components/landing/TrustSection.css`
- `src/components/landing/FaqSection.tsx`
  - `src/components/landing/FaqSection.css`
- `src/components/landing/FinalCta.tsx`
  - `src/components/landing/FinalCta.css`
- `src/components/landing/LandingFooter.tsx`
- `src/hooks/useScrollReveal.ts`
- `src/components/landing/landing-tokens.css`
- `src/components/landing/LandingPage.css`
- `src/components/PublicPage.css`

## /gallery (Gallery Page)
Entry: `src/components/GalleryPage.tsx`
Dependencies:
- `src/components/SiteNavbar.tsx`
- `src/components/landing/LandingFooter.tsx`
- `src/components/GalleryPage.css`

## /pricing (Pricing Page)
Entry: `src/components/PricingPage.tsx`
Dependencies:
- `src/components/SiteNavbar.tsx`
- `src/components/landing/LandingFooter.tsx`

## /dashboard (Dashboard)
Entry: `src/components/DashboardPage.tsx`
Dependencies:
- `src/components/TopNav.tsx`
- `src/components/ProjectCard.tsx`
- `src/components/DashboardPage.css`

## /workspace?project=<id> (Studio)
Entry: `src/components/Workspace.tsx`
Dependencies:
- `src/components/TopNav.tsx`
- `src/components/ChatPanel.tsx`
- `src/components/PreviewPanel.tsx`
- `src/components/FileExplorer.tsx`
- `src/components/CodeEditor.tsx`
- `src/components/PublishPopover.tsx`
- `src/components/ProjectConsole.tsx`
