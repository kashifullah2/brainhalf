# BrainHalf Design System

## Product Context
BrainHalf is an AI app builder for small business owners — non-technical users who describe what they need in plain language and get a working app. Target audience: shop owners, café managers, salon owners, farmers, freelancers. Job: remove the technical barrier between a business problem and a working digital tool.

**Core message:** "Describe it. We'll build it." — plain words as the entry point.

## Key Pages
- Landing: Marketing homepage with hero composer, demos, how-it-works, trust signals, FAQ
- Dashboard: Project list for logged-in users
- Studio/Workspace: Chat + live preview IDE for building apps
- Gallery: Public showcase of apps built by community

## Visual Direction
Clean, confident, pro. Not startup-trendy. Not enterprise-heavy. The kind of tool a small business owner would trust with real customer data. Light mode default for landing (warm white canvas), dark mode default for studio.

## Typography
**Family:** Instrument Sans — a precise, warm geometric sans. Used for everything (headings and body).
**Fallback:** system-ui, sans-serif
**Code:** DM Mono

Type scale (fluid, CSS clamp):
- Heading XL: `clamp(40px, 4.8vw, 62px)` / weight 400 / letter-spacing `-2px`
- Heading L: `clamp(34px, 3.6vw, 48px)` / weight 400 / letter-spacing `-1.1px`
- Heading M: `clamp(28px, 2.8vw, 36px)` / weight 400
- Heading S: `clamp(22px, 2vw, 26px)` / weight 600
- Body L: `clamp(15px, 1.1vw, 16.5px)` / weight 400 / line-height 1.65
- Body M: `clamp(14px, 1vw, 15px)` / weight 400
- Label: `12px–13.5px` / weight 600
- Micro: `11px–12px` / weight 650

**Heading style:** low weight (400) at large sizes for editorial feel. Bold only at small sizes.

## Color Palette

### Brand Accent
- Primary: `#5857FF` (blue-violet, electric but not neon)
- Hover/pressed: `#3A39C0`
- Light/subtle: `rgba(88,87,255,0.10)`
- On accent (text on colored bg): `#ffffff`
- Dark mode primary: `#7B7AFF`

### Landing Page Surface (Light, warm)
- Page bg: `#FAF8F5` (warm white — not clinical)
- Surface/card: `#FFFFFF`
- Surface hover: `#F7F5F2`
- Highlight warm: `#FDF8F0`
- Ink: `#0F0F10`
- Ink secondary: `#4A4A4D`
- Ink muted: `#7C7C80`
- Border: `#E8E4DF`
- Border strong: `#D4D0CB`

### Studio (Dark mode default)
- Canvas bg: `#0C0C0E`
- Panel/topnav: `#111113`
- Surface: `#171719`
- Surface hover: `#1E1E21`
- Text: `#EAEAEE`
- Text secondary: `#9494A4`
- Text muted: `#5A5A6E`
- Border: `rgba(255,255,255,0.06)` to `rgba(255,255,255,0.16)`

### Semantic
- Success: `#114a2f` on `#edf8f1`
- Error: `#7d1828` on `#fff0f2`
- Warning: `#543b0c` on `#fff7e6`

## Spacing
8px base grid: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 112, 128px`
Section vertical padding: `clamp(64px, 8vw, 120px)`
Content max-width: `1200px` (landing/gallery), `960px` (hero inner), `720px` (text blocks)

## Border Radius
- Button/pill: `999px` (fully rounded), `10px`, `12px`
- Card: `16px`, `20px`
- Input/composer: `20px`
- Small elements: `8px`

## Shadows
Landing (light surface):
- Subtle: `0 1px 2px rgba(15,15,16,0.04)`
- Card: `0 4px 16px rgba(15,15,16,0.06), 0 1px 3px rgba(15,15,16,0.04)`
- Product shot: `0 2px 6px #101c300f, 0 32px 90px #101c3026, 0 90px 180px #101c3014`
- Overlay: `0 20px 70px #1b24401f`

## Animation
- Scroll reveal: fade + translateY(28px), 600ms, cubic-bezier(0.22, 1, 0.36, 1)
- Hover transitions: 150ms ease
- Product frame tilt: rotateX/Y on mouse move, 200ms cubic-bezier(0.22, 1, 0.36, 1)
- Respect `prefers-reduced-motion`

## Component Patterns

### Prompt Composer
Large textarea card (max 720px) with rounded corners (20px), subtle border, focus ring in accent color. Submit button (brand-solid) on right. Hint text on left.

### Starter Pills
Small pill buttons (border-radius 999px) with icon + label. Subtle border, hover shows accent border.

### Section Anatomy
Each section: small kicker (brand accent, 12.5px, weight 650), H2 headline (weight 400, tight letter-spacing), lede paragraph (muted, 15px, 1.75 line-height). Max-width 640px for text blocks.

### Floating Notification Cards (Hero chips)
White card, border-radius 16px, drop shadow, icon in colored circle, 2-line content (title + detail).

### Product Screenshot Frame
Realistic browser chrome: macOS traffic lights (red/yellow/green), address bar with domain, "Ready to share" badge. 3D tilt on mouse move.

### Dark Closing Section
`--closing-background: #1b1b1e`, light text. Used for FinalCta. Single CTA button.

## Navbar
Sticky, max-width 1280px, 68px height (56px condensed on scroll). Glassmorphism: `backdrop-filter: blur(14px)`. Left: logo + wordmark. Center: nav links. Right: auth buttons. Fully responsive with mobile hamburger at 640px.
