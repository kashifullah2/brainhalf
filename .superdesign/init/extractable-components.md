# BrainHalf Extractable Components

## Layout Components

### SiteNavbar
- Source: `src/components/SiteNavbar.tsx`
- Category: layout
- Description: Sticky top nav with logo, desktop nav links, mobile menu, auth buttons
- Extractable props: `activeLink` (string, default: ""), `isLoggedIn` (boolean, default: false)
- Hardcoded: BrainHalf logo, nav link labels (Examples/How it works/FAQs/Gallery/Pricing), CSS classes

### LandingFooter
- Source: `src/components/landing/LandingFooter.tsx`
- Category: layout
- Description: Multi-column footer with brand, navigation columns, and copyright
- Extractable props: none
- Hardcoded: Footer columns (Product, Use cases, Company, Legal), copyright text, all links

## Basic Components

### HeroPromptBox
- Source: `src/components/landing/LandingHero.tsx`
- Category: basic
- Description: Large textarea prompt box with submit button, "Start building" CTA
- Extractable props: `placeholder` (string), `isLoading` (boolean, default: false)
- Hardcoded: Label text, submit button label "Start building", helper text "Free to start · No coding needed"

### StarterIdeaPills
- Source: `src/components/landing/LandingHero.tsx`
- Category: basic
- Description: Row of quick-start idea pills (Inventory tracker, Booking app, etc.)
- Extractable props: none
- Hardcoded: Pill labels and icons, all CSS

### GalleryCard
- Source: `src/components/GalleryPage.tsx`
- Category: basic
- Description: App showcase card with preview iframe, title, description, Open/Remix buttons
- Extractable props: `title` (string), `description` (string), `previewUrl` (string)
- Hardcoded: Border styles, padding, hover effects, button labels

### ProjectCard
- Source: `src/components/DashboardPage.tsx`
- Category: basic
- Description: User project card with title, last-updated date, open button
- Extractable props: `title` (string), `lastUpdated` (string), `status` (string)
- Hardcoded: Card layout, hover styles, action buttons

### BentoGridCell
- Source: `src/components/landing/BentoGrid.tsx`
- Category: basic
- Description: Feature highlight cell in bento grid layout
- Extractable props: `title` (string), `description` (string), `size` ("small" | "large")
- Hardcoded: Feature content, icons, CSS grid placement
