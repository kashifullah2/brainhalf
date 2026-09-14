import { test, expect } from '@playwright/test';

test.describe('Anti-Recursion and Preview Frame Guard Verification', () => {
  test('verifies that preview iframe NEVER duplicates the BrainHalf IDE', async ({ page }) => {
    // Set up a project with generated code in localStorage (similar to Analytics Dashboard from user screenshot)
    await page.addInitScript(() => {
      const p = {
        id: 'analytics-saas-test',
        name: 'Analytics SaaS Platform',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      const files = {
        '/src/App.jsx': `
import React, { useState } from 'react';
import { BarChart2, TrendingUp, Users } from 'lucide-react';

export default function AnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  return (
    <div id="analytics-app" style={{ padding: '24px', background: '#0f111a', minHeight: '100vh', color: '#f8fafc', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <BarChart2 size={24} color="#6366f1" />
        <h1 style={{ fontSize: '20px', margin: 0 }}>Analytics SaaS Dashboard</h1>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <div className="metric-card" style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>Total Visitors</span>
          <h2 style={{ fontSize: '22px', margin: '8px 0 0' }}>142,850</h2>
        </div>
        <div className="metric-card" style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>Conversion Rate</span>
          <h2 style={{ fontSize: '22px', margin: '8px 0 0' }}>4.82%</h2>
        </div>
        <div className="metric-card" style={{ padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>MRR Growth</span>
          <h2 style={{ fontSize: '22px', margin: '8px 0 0' }}>+$18,400</h2>
        </div>
      </div>
    </div>
  );
}
`,
        '/src/styles.css': `body { margin: 0; background: #0f111a; }`
      };

      localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
      localStorage.setItem('brainhalf_active_project', p.id);
      localStorage.setItem('brainhalf_files_analytics-saas-test', JSON.stringify(files));
      localStorage.setItem('brainhalf_messages_analytics-saas-test', JSON.stringify([
        { role: 'user', content: 'Build an app: Analytics SaaS Platform - Key metrics, conversion funnels & tables' },
        { role: 'ai', content: 'Creating a basic Analytics SaaS Platform with key metrics.' }
      ]));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // Wait for the preview iframe to mount
    const previewIframe = page.locator('iframe[title="Cloudflare Edge Preview"]');
    await expect(previewIframe).toBeVisible();

    const frame = previewIframe.contentFrame();
    expect(frame).not.toBeNull();

    // 1. Verify the generated Analytics App is rendered inside the iframe
    const analyticsApp = frame!.locator('#analytics-app');
    await expect(analyticsApp).toBeVisible({ timeout: 10000 });
    await expect(analyticsApp.locator('h1')).toHaveText('Analytics SaaS Dashboard');

    // 2. CRITICAL ANTI-RECURSION ASSERTIONS:
    // Ensure the iframe DOES NOT contain another BrainHalf IDE!
    const nestedTopNav = frame!.locator('.top-nav');
    await expect(nestedTopNav).not.toBeVisible();

    const nestedChatPanel = frame!.locator('.chat-panel-container');
    await expect(nestedChatPanel).not.toBeVisible();

    const nestedSidebar = frame!.locator('.sidebar');
    await expect(nestedSidebar).not.toBeVisible();

    const nestedIframe = frame!.locator('iframe');
    await expect(nestedIframe).not.toBeVisible();

    await page.screenshot({ path: '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475/anti_recursion_verified.png' });
  });
});
