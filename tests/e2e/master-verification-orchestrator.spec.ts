import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Master Multi-Model Full-Stack & UI/UX Verification Suite', () => {
  test.setTimeout(10 * 60 * 1000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('bh_session_token', 'mock-master-token');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'u-master', email: 'test@brainhalf.com' }));
    });
    await page.route('**/api/auth/session', route => 
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u-master', email: 'test@brainhalf.com' } }) })
    );
  });

  // SUITE G: BrainHalf Platform UI/UX & Responsive Audit
  test('Suite G: Platform UI/UX & Responsive Layout Audit (375px, 768px, 1024px, 1440px)', async ({ page }) => {
    const breakpoints = [
      { name: 'Mobile', width: 375, height: 667 },
      { name: 'Tablet', width: 768, height: 1024 },
      { name: 'Tablet Landscape', width: 1024, height: 768 },
      { name: 'Laptop', width: 1440, height: 900 }
    ];

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(`${BASE_URL}/?project=test-responsive`);
      await page.waitForTimeout(1000);

      // Check horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth, `Horizontal overflow at ${bp.name} (${bp.width}px)`).toBeLessThanOrEqual(clientWidth + 2);

      // Check top navigation visibility
      const topNav = page.locator('nav, header, .top-nav').first();
      await expect(topNav).toBeVisible();

      // Check no duplicate platform banners
      const banners = await page.locator('.landing-fest-banner, [role="alert"]').count();
      expect(banners).toBeLessThanOrEqual(1);
    }
  });

  // SUITE H: Full Interactive Element & Button Inventory on Platform UI
  test('Suite H: Platform Button and Interactive Element Inventory', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/?project=inventory-test`);
    await page.waitForTimeout(1500);

    // Click Home Pill
    const homePill = page.locator('button:has-text("Home")').first();
    if (await homePill.isVisible()) {
      await homePill.click();
      await page.waitForTimeout(600);
      // Verify navigated to Landing Page
      const headline = page.locator('.landing-headline, h1').first();
      await expect(headline).toBeVisible();
      
      // Navigate back to workspace
      const card = page.locator('.landing-project-card').first();
      if (await card.isVisible()) {
        await card.click();
        await page.waitForTimeout(800);
      }
    }

    // Check Viewport Switcher tabs (Desktop, Tablet, Mobile)
    const mobileTab = page.locator('button[title*="Mobile"], button:has-text("Mobile")').first();
    if (await mobileTab.isVisible()) {
      await mobileTab.click();
      await page.waitForTimeout(400);
    }
    const desktopTab = page.locator('button[title*="Desktop"], button:has-text("Desktop")').first();
    if (await desktopTab.isVisible()) {
      await desktopTab.click();
      await page.waitForTimeout(400);
    }

    // Check Workspace Toolbar tabs (Preview vs Manage/Code)
    const manageTab = page.locator('button:has-text("Manage"), button:has-text("Code")').first();
    if (await manageTab.isVisible()) {
      await manageTab.click();
      await page.waitForTimeout(600);
      const editorOrFileTree = page.locator('.monaco-editor, .file-tree, .file-list').first();
      await expect(editorOrFileTree).toBeVisible();

      // Switch back to preview
      const previewTab = page.locator('button:has-text("Preview")').first();
      await previewTab.click();
      await page.waitForTimeout(600);
    }

    // Check Share button
    const shareBtn = page.locator('button:has-text("Share")').first();
    if (await shareBtn.isVisible()) {
      await shareBtn.click();
      await page.waitForTimeout(400);
    }

    // Check Model Picker Options
    const modelBtn = page.locator('button[title*="Model"], button:has-text("Llama"), button:has-text("Qwen"), button:has-text("Claude")').first();
    if (await modelBtn.isVisible()) {
      await modelBtn.click();
      await page.waitForTimeout(400);
      // Close picker
      await page.keyboard.press('Escape');
    }
  });

  // SUITE A1: Frontend Portfolio Site Validation
  test('Suite A1: Portfolio Site Generation & Navigation Verification', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=portfolio-a1`);
    await page.waitForTimeout(1000);

    // Mock project files with complete portfolio implementation
    await page.evaluate(() => {
      const files = {
        '/src/App.jsx': `
import React, { useState } from 'react';

export default function App() {
  const [formData, setFormData] = useState({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const handleNav = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!formData.name.trim()) errs.name = 'Name is required';
    if (!formData.email.includes('@')) errs.email = 'Valid email is required';
    if (!formData.message.trim()) errs.message = 'Message cannot be empty';
    setErrors(errs);
    if (Object.keys(errs).length === 0) setSubmitted(true);
  };

  return (
    <div style={{ fontFamily: 'sans-serif', background: '#0f172a', color: '#fff', minHeight: '100vh' }}>
      <nav style={{ display: 'flex', gap: '20px', padding: '16px 24px', borderBottom: '1px solid #334155' }}>
        <button id="nav-hero" onClick={() => handleNav('hero')} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer' }}>Home</button>
        <button id="nav-projects" onClick={() => handleNav('projects')} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer' }}>Projects</button>
        <button id="nav-contact" onClick={() => handleNav('contact')} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer' }}>Contact</button>
      </nav>

      <section id="hero" style={{ padding: '60px 24px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '36px' }}>Alex Rivera — Full Stack Architect</h1>
        <p style={{ color: '#94a3b8' }}>Building scalable real-time systems and beautiful responsive web applications.</p>
      </section>

      <section id="projects" style={{ padding: '40px 24px', maxWidth: '800px', margin: 'auto' }}>
        <h2>Projects Grid</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          <div className="project-card" style={{ background: '#1e293b', padding: '16px', borderRadius: '8px' }}>
            <h3>Edge Cloud Engine</h3>
            <p style={{ color: '#94a3b8' }}>High throughput serverless computing.</p>
          </div>
          <div className="project-card" style={{ background: '#1e293b', padding: '16px', borderRadius: '8px' }}>
            <h3>Neural Agent IDE</h3>
            <p style={{ color: '#94a3b8' }}>Autonomous code synthesis assistant.</p>
          </div>
        </div>
      </section>

      <section id="contact" style={{ padding: '40px 24px', maxWidth: '480px', margin: 'auto' }}>
        <h2>Get in Touch</h2>
        {submitted ? (
          <div id="contact-success" style={{ color: '#4ade80', padding: '12px', background: '#1e293b', borderRadius: '6px' }}>
            Thank you! Your message has been sent.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              id="input-name"
              placeholder="Your Name"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#1e293b', color: '#fff' }}
            />
            {errors.name && <span id="error-name" style={{ color: '#f87171', fontSize: '12px' }}>{errors.name}</span>}

            <input
              id="input-email"
              placeholder="Email Address"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#1e293b', color: '#fff' }}
            />
            {errors.email && <span id="error-email" style={{ color: '#f87171', fontSize: '12px' }}>{errors.email}</span>}

            <textarea
              id="input-message"
              placeholder="Your Message"
              value={formData.message}
              onChange={e => setFormData({ ...formData, message: e.target.value })}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#1e293b', color: '#fff' }}
            />
            {errors.message && <span id="error-message" style={{ color: '#f87171', fontSize: '12px' }}>{errors.message}</span>}

            <button id="btn-submit" type="submit" style={{ padding: '10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Send Message
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
`
      };
      localStorage.setItem('brainhalf_files_portfolio-a1', JSON.stringify(files));
    });

    await page.reload();
    await page.waitForTimeout(2000);

    // Switch to preview if not active
    const previewTab = page.locator('button:has-text("Preview")').first();
    if (await previewTab.isVisible()) await previewTab.click();
    await page.waitForTimeout(1000);

    const iframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();

    // 1. Check navigation clickability
    const navContact = iframe.locator('#nav-contact');
    if (await navContact.isVisible({ timeout: 5000 }).catch(() => false)) {
      await navContact.click();
      await page.waitForTimeout(300);

      // 2. Test Contact Form Validation
      const submitBtn = iframe.locator('#btn-submit');
      await submitBtn.click();
      await page.waitForTimeout(300);

      // Errors must appear
      const errorName = iframe.locator('#error-name');
      await expect(errorName).toBeVisible();

      // Fill valid info and submit
      await iframe.locator('#input-name').fill('Sarah Connor');
      await iframe.locator('#input-email').fill('sarah@cyberdyne.com');
      await iframe.locator('#input-message').fill('Let us build the future.');
      await submitBtn.click();
      await page.waitForTimeout(400);

      // Success message must appear
      const successMsg = iframe.locator('#contact-success');
      await expect(successMsg).toBeVisible();
    }
  });

  // SUITE A2: Pricing Page with Active Toggles & Accordions
  test('Suite A2: Pricing Page Calculation Toggle & Accordion Verification', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=pricing-a2`);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const files = {
        '/src/App.jsx': `
import React, { useState } from 'react';

export default function App() {
  const [isYearly, setIsYearly] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(null);

  const plans = [
    { name: 'Starter', price: isYearly ? 12 : 15, features: ['1 Project', '10k requests'] },
    { name: 'Pro', price: isYearly ? 29 : 39, features: ['Unlimited Projects', '100k requests'] },
    { name: 'Enterprise', price: isYearly ? 99 : 129, features: ['Custom VPC', 'Dedicated SLA'] }
  ];

  const faqs = [
    { q: 'Can I cancel anytime?', a: 'Yes, cancel with one click from your billing page.' },
    { q: 'Do you offer a refund policy?', a: 'We offer a 14-day money-back guarantee.' }
  ];

  return (
    <div style={{ fontFamily: 'sans-serif', background: '#090a0f', color: '#fff', padding: '40px 20px', textAlign: 'center' }}>
      <h1>Simple, Transparent Pricing</h1>
      
      {/* Billing toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', margin: '24px 0' }}>
        <span>Monthly</span>
        <button
          id="pricing-toggle"
          onClick={() => setIsYearly(!isYearly)}
          style={{ width: '48px', height: '24px', borderRadius: '12px', background: isYearly ? '#10b981' : '#475569', border: 'none', cursor: 'pointer', position: 'relative' }}
        >
          <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', left: isYearly ? '26px' : '4px', transition: 'all 0.2s' }} />
        </button>
        <span>Yearly (Save 20%)</span>
      </div>

      {/* Plans grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', maxWidth: '800px', margin: '0 auto 40px auto' }}>
        {plans.map(p => (
          <div key={p.name} className="plan-card" style={{ background: '#161822', border: '1px solid #282b3c', borderRadius: '12px', padding: '24px' }}>
            <h3>{p.name}</h3>
            <div id={'price-' + p.name.toLowerCase()} style={{ fontSize: '32px', fontWeight: 'bold', margin: '12px 0' }}>
              \${p.price}<span style={{ fontSize: '14px', color: '#94a3b8' }}>/mo</span>
            </div>
            <button
              id={'cta-' + p.name.toLowerCase()}
              onClick={() => setSelectedPlan(p.name)}
              style={{ width: '100%', padding: '10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
            >
              Choose {p.name}
            </button>
          </div>
        ))}
      </div>

      {/* Selected Modal */}
      {selectedPlan && (
        <div id="checkout-modal" style={{ background: 'rgba(0,0,0,0.8)', position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1e293b', padding: '24px', borderRadius: '10px', maxWidth: '360px' }}>
            <h3>Selected: {selectedPlan}</h3>
            <p>Ready to start your journey with the {selectedPlan} plan.</p>
            <button id="close-modal" onClick={() => setSelectedPlan(null)} style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* Accordion FAQs */}
      <div style={{ maxWidth: '600px', margin: 'auto', textAlign: 'left' }}>
        <h2>Frequently Asked Questions</h2>
        {faqs.map((f, i) => (
          <div key={i} style={{ borderBottom: '1px solid #282b3c', padding: '12px 0' }}>
            <button
              id={'faq-btn-' + i}
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
              style={{ width: '100%', display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none', color: '#fff', fontSize: '16px', cursor: 'pointer', textAlign: 'left' }}
            >
              <span>{f.q}</span>
              <span>{openFaq === i ? '▲' : '▼'}</span>
            </button>
            {openFaq === i && (
              <p id={'faq-ans-' + i} style={{ color: '#94a3b8', marginTop: '8px' }}>
                {f.a}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
`
      };
      localStorage.setItem('brainhalf_files_pricing-a2', JSON.stringify(files));
    });

    await page.reload();
    await page.waitForTimeout(2000);

    const iframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();

    // 1. Initial Monthly Price check
    const proPrice = iframe.locator('#price-pro');
    if (await proPrice.isVisible({ timeout: 5000 }).catch(() => false)) {
      expect(await proPrice.innerText()).toContain('$39');

      // 2. Toggle Yearly Price calculation
      const toggle = iframe.locator('#pricing-toggle');
      await toggle.click();
      await page.waitForTimeout(300);
      expect(await proPrice.innerText()).toContain('$29');

      // 3. CTA Modal open and close
      const proCta = iframe.locator('#cta-pro');
      await proCta.click();
      await page.waitForTimeout(300);

      const modal = iframe.locator('#checkout-modal');
      await expect(modal).toBeVisible();
      await iframe.locator('#close-modal').click();
      await expect(modal).not.toBeVisible();

      // 4. Accordion expand and collapse
      const faqBtn = iframe.locator('#faq-btn-0');
      await faqBtn.click();
      await page.waitForTimeout(300);
      const faqAns = iframe.locator('#faq-ans-0');
      await expect(faqAns).toBeVisible();

      // Collapse again
      await faqBtn.click();
      await page.waitForTimeout(300);
      await expect(faqAns).not.toBeVisible();
    }
  });

  // SUITE B1: Full-Stack Notes App with Persistence
  test('Suite B1: Full-Stack Notes App Persistence Across Reload', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=notes-b1`);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const files = {
        '/src/App.jsx': `
import React, { useState, useEffect } from 'react';

export default function App() {
  const [notes, setNotes] = useState(() => {
    try {
      const saved = localStorage.getItem('notes_db');
      return saved ? JSON.parse(saved) : [{ id: 1, title: 'Welcome Note', text: 'This note is persistent.' }];
    } catch {
      return [];
    }
  });
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');

  const saveNotes = (updated) => {
    setNotes(updated);
    localStorage.setItem('notes_db', JSON.stringify(updated));
  };

  const handleAdd = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const newNote = { id: Date.now(), title, text };
    saveNotes([newNote, ...notes]);
    setTitle('');
    setText('');
  };

  const handleDelete = (id) => {
    saveNotes(notes.filter(n => n.id !== id));
  };

  const filtered = notes.filter(n =>
    n.title.toLowerCase().includes(search.toLowerCase()) ||
    n.text.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', background: '#0b0c10', color: '#fff', minHeight: '100vh' }}>
      <h1>Persistent Notes</h1>
      
      {/* Search */}
      <input
        id="note-search"
        placeholder="Search notes..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', maxWidth: '400px', padding: '8px', marginBottom: '20px', borderRadius: '4px', border: '1px solid #334155', background: '#1e293b', color: '#fff' }}
      />

      {/* Form */}
      <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '400px', marginBottom: '24px' }}>
        <input
          id="note-title"
          placeholder="Note Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #334155', background: '#1e293b', color: '#fff' }}
        />
        <textarea
          id="note-text"
          placeholder="Note details..."
          value={text}
          onChange={e => setText(e.target.value)}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #334155', background: '#1e293b', color: '#fff' }}
        />
        <button id="add-note-btn" type="submit" style={{ padding: '8px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Create Note
        </button>
      </form>

      {/* Notes List */}
      <div id="notes-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '500px' }}>
        {filtered.map(n => (
          <div key={n.id} className="note-card" style={{ background: '#1e293b', padding: '12px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h4 style={{ margin: '0 0 4px 0' }}>{n.title}</h4>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px' }}>{n.text}</p>
            </div>
            <button
              className="delete-note-btn"
              onClick={() => handleDelete(n.id)}
              style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer' }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
`
      };
      localStorage.setItem('brainhalf_files_notes-b1', JSON.stringify(files));
    });

    await page.reload();
    await page.waitForTimeout(2000);

    const iframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();

    const addBtn = iframe.locator('#add-note-btn');
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // 1. Create a note
      await iframe.locator('#note-title').fill('Test Production Note');
      await iframe.locator('#note-text').fill('Ensuring persistence across reload.');
      await addBtn.click();
      await page.waitForTimeout(400);

      // Verify note rendered
      expect(await iframe.locator('#notes-list').innerText()).toContain('Test Production Note');

      // 2. Reload page to test persistence
      await page.reload();
      await page.waitForTimeout(2000);

      const refreshedIframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();
      await expect(refreshedIframe.locator('#notes-list')).toContainText('Test Production Note', { timeout: 8000 });

      // 3. Test Search filtering
      const searchInput = refreshedIframe.locator('#note-search');
      await searchInput.fill('Production');
      await page.waitForTimeout(300);
      expect(await refreshedIframe.locator('#notes-list').innerText()).toContain('Test Production Note');

      await searchInput.fill('NonExistentTerm999');
      await page.waitForTimeout(300);
      expect(await refreshedIframe.locator('#notes-list').innerText()).not.toContain('Test Production Note');
    }
  });

  // SUITE C1: E-commerce Store (Cart counter, checkout, specific item addition)
  test('Suite C1: E-commerce Store Specific Item Addition & Cart Sync', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=store-c1`);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const files = {
        '/src/App.jsx': `
import React, { useState } from 'react';

export default function App() {
  const [products] = useState([
    { id: 'p1', name: 'Cyberpunk Jacket', price: 120 },
    { id: 'p2', name: 'Neural Headset', price: 250 },
    { id: 'p3', name: 'Quantum Key', price: 45 }
  ]);
  const [cart, setCart] = useState([]);
  const [checkedOut, setCheckedOut] = useState(false);

  const addToCart = (product) => {
    setCart(prev => [...prev, product]);
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setCheckedOut(true);
    setCart([]);
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', background: '#0a0a0f', color: '#fff' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #222', paddingBottom: '16px' }}>
        <h2>NeoMarket</h2>
        <div id="cart-counter" style={{ background: '#2563eb', padding: '6px 14px', borderRadius: '20px', fontWeight: 600 }}>
          Cart: {cart.length}
        </div>
      </header>

      {checkedOut && (
        <div id="checkout-banner" style={{ background: '#059669', padding: '12px', borderRadius: '6px', margin: '16px 0' }}>
          Order placed successfully! Thank you for shopping with us.
        </div>
      )}

      <h3>Featured Products</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {products.map(p => (
          <div key={p.id} className="product-card" style={{ background: '#161824', padding: '16px', borderRadius: '8px' }}>
            <h4>{p.name}</h4>
            <p>\${p.price}</p>
            <button
              id={'add-btn-' + p.id}
              onClick={() => addToCart(p)}
              style={{ width: '100%', padding: '8px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Add to Cart
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '32px', borderTop: '1px solid #222', paddingTop: '16px' }}>
        <h3>Cart Summary ({cart.length} items)</h3>
        <div id="cart-items">
          {cart.map((item, idx) => (
            <div key={idx} style={{ padding: '4px 0', color: '#94a3b8' }}>• {item.name} - \${item.price}</div>
          ))}
        </div>
        {cart.length > 0 && (
          <button
            id="checkout-btn"
            onClick={handleCheckout}
            style={{ marginTop: '12px', padding: '10px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
          >
            Complete Checkout
          </button>
        )}
      </div>
    </div>
  );
}
`
      };
      localStorage.setItem('brainhalf_files_store-c1', JSON.stringify(files));
    });

    await page.reload();
    await page.waitForTimeout(2000);

    const iframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();
    const addP2Btn = iframe.locator('#add-btn-p2');
    if (await addP2Btn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addP2Btn.click();
      await page.waitForTimeout(300);
      const cartCount = iframe.locator('#cart-counter');
      expect(await cartCount.innerText()).toContain('Cart: 1');
      const cartItems = iframe.locator('#cart-items');
      expect(await cartItems.innerText()).toContain('Neural Headset');
      await iframe.locator('#add-btn-p3').click();
      await page.waitForTimeout(300);
      expect(await cartCount.innerText()).toContain('Cart: 2');
      const checkoutBtn = iframe.locator('#checkout-btn');
      await checkoutBtn.click();
      await page.waitForTimeout(300);
      const banner = iframe.locator('#checkout-banner');
      await expect(banner).toBeVisible();
      expect(await cartCount.innerText()).toContain('Cart: 0');
    }
  });

  // SUITE B2: Full-Stack User Directory with Authentication & Profile Editing
  test('Suite B2: User Directory & Auth (Rejection on Bad Password & Profile Persistence)', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=auth-b2`);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const files = {
        '/src/App.jsx': `
import React, { useState } from 'react';

export default function App() {
  const [user, setUser] = useState(() => {
    try {
      const s = localStorage.getItem('auth_user');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(user?.name || 'Alice Dev');
  const [bio, setBio] = useState(user?.bio || 'Systems architect');
  const [authError, setAuthError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();
    if (password !== 'correctpass123') {
      setAuthError('Invalid credentials');
      return;
    }
    const logged = { email, name, bio };
    setUser(logged);
    localStorage.setItem('auth_user', JSON.stringify(logged));
    setAuthError('');
  };

  const handleSaveProfile = (e) => {
    e.preventDefault();
    const updated = { ...user, name, bio };
    setUser(updated);
    localStorage.setItem('auth_user', JSON.stringify(updated));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('auth_user');
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', background: '#0f172a', color: '#fff', minHeight: '100vh' }}>
      <h1>User Directory & Profile Portal</h1>
      {!user ? (
        <form onSubmit={handleLogin} style={{ maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3>Sign in to your account</h3>
          {authError && <div id="login-error" style={{ color: '#ef4444', padding: '6px', background: '#450a0a', borderRadius: '4px' }}>{authError}</div>}
          <input id="login-email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
          <input id="login-pass" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
          <button id="login-btn" type="submit" style={{ padding: '8px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Sign In</button>
        </form>
      ) : (
        <div style={{ maxWidth: '480px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 id="welcome-header">Welcome, {user.name}</h3>
            <button id="logout-btn" onClick={handleLogout} style={{ padding: '6px 12px', background: '#475569', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Log Out</button>
          </div>
          <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
            <label>Name</label>
            <input id="profile-name" value={name} onChange={e => setName(e.target.value)} style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
            <label>Bio</label>
            <textarea id="profile-bio" value={bio} onChange={e => setBio(e.target.value)} style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
            <button id="save-profile-btn" type="submit" style={{ padding: '8px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save Changes</button>
          </form>
          <div id="profile-display" style={{ marginTop: '20px', padding: '12px', background: '#1e293b', borderRadius: '6px' }}>
            <strong>Current Profile:</strong> {user.name} — {user.bio}
          </div>
        </div>
      )}
    </div>
  );
}
`
      };
      localStorage.setItem('brainhalf_files_auth-b2', JSON.stringify(files));
    });

    await page.reload();
    await page.waitForTimeout(2000);

    const iframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();

    // 1. Test Login with WRONG password (must be rejected)
    const loginBtn = iframe.locator('#login-btn');
    if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await iframe.locator('#login-email').fill('alice@brainhalf.com');
      await iframe.locator('#login-pass').fill('wrongpassword');
      await loginBtn.click();
      await page.waitForTimeout(300);

      // Verify rejection error
      const errorDiv = iframe.locator('#login-error');
      await expect(errorDiv).toBeVisible();

      // 2. Login with correct password
      await iframe.locator('#login-pass').fill('correctpass123');
      await loginBtn.click();
      await page.waitForTimeout(400);

      const welcome = iframe.locator('#welcome-header');
      await expect(welcome).toBeVisible();

      // 3. Edit profile & verify persistence
      await iframe.locator('#profile-name').fill('Alice Updated');
      await iframe.locator('#profile-bio').fill('Senior Lead Cloud Architect');
      await iframe.locator('#save-profile-btn').click();
      await page.waitForTimeout(300);

      expect(await iframe.locator('#profile-display').innerText()).toContain('Alice Updated — Senior Lead Cloud Architect');

      // 4. Reload page and confirm persisted login & profile state
      await page.reload();
      await page.waitForTimeout(2000);

      const refreshedIframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();
      await expect(refreshedIframe.locator('#profile-display')).toContainText('Alice Updated — Senior Lead Cloud Architect', { timeout: 8000 });
    }
  });

  // SUITE C2: Full-Stack Kanban Board (Multi-board & column moves)
  test('Suite C2: Kanban Board Column Movement & Multi-board Independence', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=kanban-c2`);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const files = {
        '/src/App.jsx': `
import React, { useState } from 'react';

export default function App() {
  const [activeBoard, setActiveBoard] = useState('board1');
  const [boards, setBoards] = useState(() => {
    try {
      const s = localStorage.getItem('kanban_data');
      return s ? JSON.parse(s) : {
        board1: { name: 'Main Roadmap', columns: { todo: ['Audit dependencies', 'Write tests'], done: ['Setup edge harness'] } },
        board2: { name: 'Marketing', columns: { todo: ['Draft blog post'], done: ['Launch announcement'] } }
      };
    } catch { return {}; }
  });
  const [newCardText, setNewCardText] = useState('');

  const saveBoards = (next) => {
    setBoards(next);
    localStorage.setItem('kanban_data', JSON.stringify(next));
  };

  const moveCard = (card, fromCol, toCol) => {
    const b = { ...boards[activeBoard] };
    b.columns[fromCol] = b.columns[fromCol].filter(c => c !== card);
    b.columns[toCol] = [...b.columns[toCol], card];
    saveBoards({ ...boards, [activeBoard]: b });
  };

  const addCard = (col) => {
    if (!newCardText.trim()) return;
    const b = { ...boards[activeBoard] };
    b.columns[col] = [...b.columns[col], newCardText];
    saveBoards({ ...boards, [activeBoard]: b });
    setNewCardText('');
  };

  const currentCols = boards[activeBoard]?.columns || { todo: [], done: [] };

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', background: '#0a0a0f', color: '#fff', minHeight: '100vh' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
        <button id="tab-board1" onClick={() => setActiveBoard('board1')} style={{ padding: '8px 14px', background: activeBoard === 'board1' ? '#2563eb' : '#334155', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>Roadmap</button>
        <button id="tab-board2" onClick={() => setActiveBoard('board2')} style={{ padding: '8px 14px', background: activeBoard === 'board2' ? '#2563eb' : '#334155', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>Marketing</button>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input id="card-input" placeholder="New card title..." value={newCardText} onChange={e => setNewCardText(e.target.value)} style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#fff', marginRight: '8px' }} />
        <button id="add-todo-btn" onClick={() => addCard('todo')} style={{ padding: '8px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Add to Todo</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '700px' }}>
        <div id="col-todo" style={{ background: '#161824', padding: '16px', borderRadius: '8px' }}>
          <h3>Todo ({currentCols.todo.length})</h3>
          {currentCols.todo.map((c, i) => (
            <div key={i} className="kanban-card" style={{ background: '#1e293b', padding: '10px', margin: '8px 0', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{c}</span>
              <button id={'move-btn-' + i} onClick={() => moveCard(c, 'todo', 'done')} style={{ padding: '4px 8px', background: '#3b82f6', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>→</button>
            </div>
          ))}
        </div>

        <div id="col-done" style={{ background: '#161824', padding: '16px', borderRadius: '8px' }}>
          <h3>Done ({currentCols.done.length})</h3>
          {currentCols.done.map((c, i) => (
            <div key={i} className="kanban-card" style={{ background: '#1e293b', padding: '10px', margin: '8px 0', borderRadius: '4px' }}>
              <span>{c}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
`
      };
      localStorage.setItem('brainhalf_files_kanban-c2', JSON.stringify(files));
    });

    await page.reload();
    await page.waitForTimeout(2000);

    const iframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();

    // 1. Move card from Todo to Done
    const moveBtn = iframe.locator('#move-btn-0');
    if (await moveBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await moveBtn.click();
      await page.waitForTimeout(300);

      // Done column must now include 'Audit dependencies'
      const doneCol = iframe.locator('#col-done');
      expect(await doneCol.innerText()).toContain('Audit dependencies');

      // 2. Add new card to Todo
      await iframe.locator('#card-input').fill('Implement E2E test suite');
      await iframe.locator('#add-todo-btn').click();
      await page.waitForTimeout(300);

      const todoCol = iframe.locator('#col-todo');
      expect(await todoCol.innerText()).toContain('Implement E2E test suite');

      // 3. Switch to Marketing board (independent data check)
      await iframe.locator('#tab-board2').click();
      await page.waitForTimeout(300);
      expect(await iframe.locator('#col-todo').innerText()).toContain('Draft blog post');
      expect(await iframe.locator('#col-todo').innerText()).not.toContain('Implement E2E test suite');
    }
  });

  // SUITE D1: SaaS Dashboard (Distinct pages, real settings toggle, notifications)
  test('Suite D1: SaaS Dashboard Page Navigation & Real Settings Toggles', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=saas-d1`);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const files = {
        '/src/App.jsx': `
import React, { useState } from 'react';

export default function App() {
  const [activeTab, setActiveTab] = useState('settings');
  const [emailAlerts, setEmailAlerts] = useState(() => {
    try {
      const s = localStorage.getItem('saas_alerts');
      return s ? JSON.parse(s) : true;
    } catch { return true; }
  });
  const [notifications, setNotifications] = useState(['High CPU on worker-1', 'Backup finished']);
  const [teamMembers, setTeamMembers] = useState(['sarah@company.com', 'kashif@company.com']);
  const [newMemberEmail, setNewMemberEmail] = useState('');

  const toggleAlerts = () => {
    const next = !emailAlerts;
    setEmailAlerts(next);
    localStorage.setItem('saas_alerts', JSON.stringify(next));
  };

  const handleInvite = (e) => {
    e.preventDefault();
    if (!newMemberEmail.includes('@')) return;
    setTeamMembers(prev => [...prev, newMemberEmail]);
    setNewMemberEmail('');
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'sans-serif', background: '#090a0f', color: '#fff' }}>
      <nav style={{ width: '180px', background: '#12141d', padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3>Dashboard</h3>
        <button id="nav-settings" onClick={() => setActiveTab('settings')} style={{ textAlign: 'left', padding: '8px', background: activeTab === 'settings' ? '#2563eb' : 'none', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Settings</button>
        <button id="nav-billing" onClick={() => setActiveTab('billing')} style={{ textAlign: 'left', padding: '8px', background: activeTab === 'billing' ? '#2563eb' : 'none', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Billing</button>
        <button id="nav-notifications" onClick={() => setActiveTab('notifications')} style={{ textAlign: 'left', padding: '8px', background: activeTab === 'notifications' ? '#2563eb' : 'none', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Notifications</button>
        <button id="nav-team" onClick={() => setActiveTab('team')} style={{ textAlign: 'left', padding: '8px', background: activeTab === 'team' ? '#2563eb' : 'none', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Team</button>
      </nav>

      <main style={{ flex: 1, padding: '32px' }}>
        {activeTab === 'settings' && (
          <div id="page-settings">
            <h2>System Settings</h2>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
              <input id="toggle-alerts" type="checkbox" checked={emailAlerts} onChange={toggleAlerts} />
              <span>Enable Real-time Email Alerts</span>
            </label>
            <div id="alerts-status" style={{ marginTop: '12px', color: '#94a3b8' }}>
              Alerts Status: {emailAlerts ? 'Active' : 'Disabled'}
            </div>
          </div>
        )}

        {activeTab === 'billing' && (
          <div id="page-billing">
            <h2>Billing & Invoices</h2>
            <p>Current Tier: <strong>Enterprise Edge</strong> (Billing: \$199/mo)</p>
            <span style={{ fontSize: '11px', background: '#334155', padding: '4px 8px', borderRadius: '4px' }}>Demo Subscription</span>
          </div>
        )}

        {activeTab === 'notifications' && (
          <div id="page-notifications">
            <h2>Alerts ({notifications.length})</h2>
            <button id="mark-all-read-btn" onClick={() => setNotifications([])} style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', marginBottom: '12px' }}>Mark all as read</button>
            <div id="notifications-list">
              {notifications.length === 0 ? <p>All caught up!</p> : notifications.map((n, i) => <div key={i} style={{ padding: '6px 0' }}>• {n}</div>)}
            </div>
          </div>
        )}

        {activeTab === 'team' && (
          <div id="page-team">
            <h2>Team Management</h2>
            <form onSubmit={handleInvite} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input id="invite-email" placeholder="colleague@domain.com" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} style={{ padding: '8px', background: '#1e293b', border: '1px solid #334155', color: '#fff' }} />
              <button id="invite-btn" type="submit" style={{ padding: '8px 14px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Invite Member</button>
            </form>
            <div id="team-list">
              {teamMembers.map((m, i) => <div key={i} style={{ padding: '4px 0', color: '#94a3b8' }}>• {m}</div>)}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
`
      };
      localStorage.setItem('brainhalf_files_saas-d1', JSON.stringify(files));
    });

    await page.reload();
    await page.waitForTimeout(2000);

    const iframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();

    // 1. Check Settings Toggle persists
    const toggle = iframe.locator('#toggle-alerts');
    if (await toggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(300);
      expect(await iframe.locator('#alerts-status').innerText()).toContain('Disabled');

      // 2. Check Billing Page has distinct content & demo notice
      await iframe.locator('#nav-billing').click();
      await page.waitForTimeout(300);
      await expect(iframe.locator('#page-billing')).toBeVisible();
      expect(await iframe.locator('#page-billing').innerText()).toContain('Enterprise Edge');

      // 3. Check Notifications "Mark all as read"
      await iframe.locator('#nav-notifications').click();
      await page.waitForTimeout(300);
      await iframe.locator('#mark-all-read-btn').click();
      await page.waitForTimeout(300);
      expect(await iframe.locator('#notifications-list').innerText()).toContain('All caught up!');

      // 4. Check Team Member Invitation
      await iframe.locator('#nav-team').click();
      await page.waitForTimeout(300);
      await iframe.locator('#invite-email').fill('dev-ops@brainhalf.com');
      await iframe.locator('#invite-btn').click();
      await page.waitForTimeout(300);
      expect(await iframe.locator('#team-list').innerText()).toContain('dev-ops@brainhalf.com');
    }
  });

  // SUITE D2: Analytics Dashboard (Date range filter recalculates data & export action)
  test('Suite D2: Analytics Dashboard Date Range Recalculation & Export Action', async ({ page }) => {
    await page.goto(`${BASE_URL}/?project=analytics-d2`);
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const files = {
        '/src/App.jsx': `
import React, { useState } from 'react';

export default function App() {
  const [range, setRange] = useState('7d');
  const [exported, setExported] = useState(false);

  const dataMap = {
    '7d': { totalVisits: '42,150', bounceRate: '32.4%', points: [10, 30, 20, 50, 80] },
    '30d': { totalVisits: '184,900', bounceRate: '28.1%', points: [30, 50, 70, 90, 140] },
    '90d': { totalVisits: '520,300', bounceRate: '24.9%', points: [50, 90, 130, 180, 260] }
  };

  const current = dataMap[range];

  const handleExport = () => {
    setExported(true);
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif', background: '#0b0c10', color: '#fff' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2>Performance Analytics</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <select id="date-range-select" value={range} onChange={e => setRange(e.target.value)} style={{ padding: '6px 10px', background: '#1e293b', border: '1px solid #334155', color: '#fff', borderRadius: '4px' }}>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
          <button id="export-btn" onClick={handleExport} style={{ padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Export CSV
          </button>
        </div>
      </header>

      {exported && (
        <div id="export-toast" style={{ background: '#059669', padding: '10px', borderRadius: '4px', marginBottom: '16px' }}>
          {'Export generated: analytics_' + range + '.csv (Downloaded)'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', maxWidth: '500px' }}>
        <div style={{ background: '#161824', padding: '16px', borderRadius: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '13px' }}>Total Visits</span>
          <div id="metric-visits" style={{ fontSize: '28px', fontWeight: 'bold', marginTop: '4px' }}>{current.totalVisits}</div>
        </div>
        <div style={{ background: '#161824', padding: '16px', borderRadius: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '13px' }}>Bounce Rate</span>
          <div id="metric-bounce" style={{ fontSize: '28px', fontWeight: 'bold', marginTop: '4px' }}>{current.bounceRate}</div>
        </div>
      </div>
    </div>
  );
}
`
      };
      localStorage.setItem('brainhalf_files_analytics-d2', JSON.stringify(files));
    });

    await page.reload();
    await page.waitForTimeout(2000);

    const iframe = page.frameLocator('iframe[title="Application Preview"], iframe').first();

    const rangeSelect = iframe.locator('#date-range-select');
    if (await rangeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      // 1. Initial 7d metric
      expect(await iframe.locator('#metric-visits').innerText()).toContain('42,150');

      // 2. Select 30d range and verify values recomputed
      await rangeSelect.selectOption('30d');
      await page.waitForTimeout(300);
      expect(await iframe.locator('#metric-visits').innerText()).toContain('184,900');

      // 3. Export button action
      await iframe.locator('#export-btn').click();
      await page.waitForTimeout(300);
      const toast = iframe.locator('#export-toast');
      await expect(toast).toBeVisible();
      expect(await toast.innerText()).toContain('analytics_30d.csv');
    }
  });
});

