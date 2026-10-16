# BrainHalf Shared UI Components

Framework: React 19 + TypeScript
CSS: Vanilla CSS custom properties (no Tailwind, no component library)
Icons: lucide-react

---

## LandingHero
File: `src/components/landing/LandingHero.tsx`
Description: Full hero section — headline, prompt composer, starter pills, product screenshot.

Key JSX structure:
```tsx
<section className="landing-hero-redesign">
  <div className="hero-inner">
    <div className="hero-copy">
      <p className="hero-kicker">Software for your business, in plain words</p>
      <h1>Describe it. <span className="hero-gradient-text">We'll build it.</span></h1>
      <p className="hero-sub">Tell BrainHalf what your business needs...</p>
    </div>

    <form className="landing-prompt-box hero-prompt">
      <label className="landing-input-label">Describe your app</label>
      <textarea className="landing-prompt-textarea" rows={3} />
      <div className="landing-prompt-actions">
        <span><Check size={14} /> Free to start · No coding needed</span>
        <button type="submit" className="landing-submit-btn">
          <span>Start building</span>
          <ArrowRight size={16} />
        </button>
      </div>
    </form>

    <div className="hero-starters">
      <span className="hero-starters-label">Try an idea:</span>
      <div className="hero-starters-list">
        {/* Pill buttons: Inventory tracker, Booking app, Customer follow-ups, Team task board */}
        <button className="hero-starter-pill"><Icon /> <span>Label</span></button>
      </div>
    </div>

    <div className="hero-cta-row">
      <a className="hero-cta-primary">Start building <ArrowRight /></a>
      <a className="hero-cta-secondary">See examples</a>
    </div>

    <div className="hero-stage">
      {/* Floating chips */}
      <div className="hero-chip hero-chip-inventory">
        <span className="hero-chip-icon"><Package /></span>
        <div className="hero-chip-body">
          <strong>Corner Café stockroom</strong>
          <span>Oat milk updated to 23 cartons</span>
        </div>
      </div>
      <div className="hero-chip hero-chip-bookings">
        <span className="hero-chip-icon hero-chip-icon-warm"><CalendarCheck /></span>
        <div className="hero-chip-body">
          <strong>Thursday at the salon</strong>
          <span>11:00 AM appointment booked</span>
        </div>
      </div>

      <figure className="hero-shot">
        <div className="hero-shot-chrome">
          <div className="hero-shot-dots"><i/><i/><i/></div>
          <div className="hero-shot-address"><Globe2 size={12} /><span>yourshop.brainhalf.com</span></div>
          <span className="hero-shot-badge">Ready to share</span>
        </div>
        <img src="/images/landing-workspace.png" alt="..." width={1600} height={1000} />
      </figure>
    </div>
  </div>
</section>
```

---

## HowItWorks
File: `src/components/landing/HowItWorks.tsx`
Description: 3-step scroll-animated section. Left: numbered steps list. Right: sticky visual cards.

```tsx
<section className="hiw-section" id="how-it-works">
  <div className="landing-section-intro">
    <p className="landing-kicker">How it works</p>
    <h2>Describe. Refine. Share.</h2>
    <p className="landing-section-lede">You set the direction and make the decisions. BrainHalf does the building.</p>
  </div>
  <div className="hiw-layout">
    <ol className="hiw-steps">
      {/* 3 steps: Describe it → Refine by chatting → Share with world */}
      <li className="hiw-step is-active">
        <span className="hiw-dot"><Icon /></span>
        <div className="hiw-step-body">
          <p className="hiw-step-num">Step 1</p>
          <h3>Describe it in plain words</h3>
          <p>Detail text...</p>
        </div>
      </li>
    </ol>
    <div className="hiw-sticky">
      {/* Rotating visual cards for each step */}
      <div className="hiw-visual is-active">
        <div className="hiw-card">...</div>
      </div>
    </div>
  </div>
</section>
```

---

## BentoGrid
File: `src/components/landing/BentoGrid.tsx`
Description: Feature highlight grid with mixed-size cells showcasing product capabilities.

CSS structure: CSS grid with varying cell sizes. Items include: "Your app, your database", "Talk to it like a person", "Live at your own web address", "Everything works before it goes live".

---

## FaqSection
File: `src/components/landing/FaqSection.tsx`
Description: Accordion FAQ with questions about BrainHalf's capabilities and pricing.

```tsx
<section className="faq-section" id="questions">
  <div className="landing-section-intro">
    <p className="landing-kicker">Common questions</p>
    <h2>Questions & answers</h2>
  </div>
  <dl className="faq-list">
    {/* Each item: <dt> question + toggle + <dd> answer */}
    <div className="faq-item">
      <dt><button className="faq-toggle">Question text <ChevronDown /></button></dt>
      <dd className="faq-answer">Answer text</dd>
    </div>
  </dl>
</section>
```

---

## FinalCta
File: `src/components/landing/FinalCta.tsx`
Description: Dark closing CTA banner with headline and "Start building" button.

```tsx
<section className="final-cta-section">
  <h2>Build your first app today</h2>
  <p>Start with a sentence. Get a working app in minutes.</p>
  <button className="final-cta-btn" onClick={onStartBuilding}>
    Start building free
    <ArrowRight size={16} />
  </button>
</section>
```

CSS: dark `--closing-background: #1b1b1e`, `--closing-ink: #f5f4f0` — inverted dark section.

---

## TrustSection
File: `src/components/landing/TrustSection.tsx`
Description: Trust/social proof section with testimonials or usage stats.

---

## InteractiveDemo
File: `src/components/landing/InteractiveDemo.tsx`
Description: Tabbed interactive demo showing different use cases. Has "Try an idea" buttons that populate the hero composer.
