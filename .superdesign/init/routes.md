# BrainHalf Routes

## Routing Approach
No file-based routing. Single-page app with state-based view switching in `src/App.tsx`.

## View State
```typescript
type ViewState = 'landing' | 'dashboard' | 'workspace' | 'gallery' | 'pricing'
```

## Routes

| View | URL | Component | Notes |
|---|---|---|---|
| Landing | `/` | `LandingPage` | Default when not authenticated |
| Dashboard | `/?dashboard` | `DashboardPage` | After login, project list |
| Workspace | `/?project=<id>` | `Workspace` | IDE-like chat+preview |
| Gallery | `/gallery` | `GalleryPage` | Public app showcase |
| Pricing | `/pricing` | `PricingPage` | Static pricing page |
| Admin | `/admin` | `AdminPage` | Operator only |

## Navigation
- Landing: `SiteNavbar` with links: Examples, How it works, FAQs, Gallery, Pricing
- Studio: `TopNav` — project name, model selector, publish button, user menu
- Gallery/Pricing: `SiteNavbar` with back-to-home brand click

## App.tsx routing snippet
```tsx
// URL-based routing
if (pathname === '/gallery') return <GalleryPage />;
if (pathname === '/pricing') return <PricingPage />;

// State-based
if (currentView === 'landing') return <LandingPage onSubmitInitialPrompt={...} />;
if (currentView === 'dashboard') return <DashboardPage />;
if (currentView === 'workspace') return <Workspace projectId={...} />;
```
