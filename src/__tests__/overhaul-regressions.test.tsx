import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminPage from '../components/AdminPage';
import { isAutoSave, displayLabel } from '../components/ProjectHistory';
import { STATUS_LABEL, SSL_LABEL } from '../components/CustomDomainSettings';
import { stages as controlsStages, stageKeys as controlsStageKeys, stageLabels } from '../components/PublicationControls';

/**
 * Regression guards for the plain-language + consistency overhaul. Each area
 * below was hand-edited across many files; these tests pin the user-critical
 * contracts so a later copy tweak cannot silently break them.
 */

describe('dark-grey theme (no navy regression)', () => {
  const themeCss = readFileSync(resolve(__dirname, '../styles/studio-theme.css'), 'utf8');
  const indexCss = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
  const themeInit = readFileSync(resolve(__dirname, '../../public/theme-init.js'), 'utf8');
  // Hexes from the old navy dark theme that must not come back.
  const NAVY_HEXES = ['#1a2332', '#16213e', '#0f172a', '#1e293b'];
  // The dark palette's neutral grey anchors.
  const GREY_HEXES = ['#161616', '#212121', '#292929'];

  it('studio-theme.css uses the neutral grey scale with no navy hexes', () => {
    for (const hex of GREY_HEXES) expect(themeCss).toContain(hex);
    for (const hex of NAVY_HEXES) expect(themeCss.toLowerCase()).not.toContain(hex);
  });

  it('index.css dark base layer uses grey and keeps navy out of dark mode', () => {
    const [darkLayer] = indexCss.split("Light Mode Theme Overrides");
    for (const hex of GREY_HEXES) expect(darkLayer).toContain(hex);
    for (const hex of NAVY_HEXES) expect(darkLayer.toLowerCase()).not.toContain(hex);
  });

  it('theme-init.js sets the dark theme-color meta to the grey canvas', () => {
    expect(themeInit).toContain('#161616');
  });

  it('theme.ts sets the dark theme-color meta to the grey canvas (M11)', () => {
    const themeTs = readFileSync(resolve(__dirname, '../lib/theme.ts'), 'utf8');
    expect(themeTs).toContain('#161616');
    expect(themeTs.toLowerCase()).not.toContain('#0d1219');
  });
});

describe('AdminPage smoke render', () => {
  it('renders the operator header with section anchors and the loading state', () => {
    const html = renderToStaticMarkup(<AdminPage />);
    expect(html).toContain('admin-page');
    expect(html).toContain('Operator');
    expect(html).toContain('Accounts &amp; product health');
    expect(html).toContain('href="#overview"');
    expect(html).toContain('href="#health"');
    expect(html).toContain('href="#manage"');
    // Initial state is loading skeletons — never a half-rendered table.
    expect(html).toContain('admin-skeletons');
  });
});

describe('ProjectHistory version labels', () => {
  it('rewrites auto-save labels into plain language', () => {
    expect(displayLabel('Before agent changes')).toBe('Auto-saved before builder change');
    expect(displayLabel('Before restore')).toBe('Auto-saved before restore');
  });

  it('leaves user-named versions untouched', () => {
    expect(displayLabel('Working login flow')).toBe('Working login flow');
    expect(displayLabel('Manual version')).toBe('Manual version');
  });

  it('every label isAutoSave recognizes gets a plain display label (no stale raw label leaks)', () => {
    const autoLabels = ['Before agent changes', 'Before restore'];
    for (const label of autoLabels) {
      expect(isAutoSave(label)).toBe(true);
      expect(displayLabel(label)).not.toBe(label);
      expect(displayLabel(label)).not.toMatch(/agent/i);
    }
  });
});

describe('CustomDomainSettings plain-language labels', () => {
  // Jargon the overhaul removed from the domain UI; it must not creep back.
  const JARGON = [/\btls\b/i, /\bdns\b/i, /provision/i, /certificate/i, /\bcname\b/i, /propagat/i];

  it('covers every domain status with a plain label', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(
      ['active', 'active_redeploying', 'blocked', 'error', 'pending', 'pending_deletion', 'unknown'].sort()
    );
    for (const [key, label] of Object.entries(STATUS_LABEL)) {
      expect(label.trim().length, `STATUS_LABEL.${key}`).toBeGreaterThan(0);
      for (const jargon of JARGON) expect(label, `STATUS_LABEL.${key}`).not.toMatch(jargon);
    }
  });

  it('covers every secure-connection state with a plain label', () => {
    expect(Object.keys(SSL_LABEL).length).toBeGreaterThan(0);
    for (const [key, label] of Object.entries(SSL_LABEL)) {
      expect(label.trim().length, `SSL_LABEL.${key}`).toBeGreaterThan(0);
      for (const jargon of JARGON) expect(label, `SSL_LABEL.${key}`).not.toMatch(jargon);
    }
  });
});

describe('single publish UI (duplicate PublishDialog removed)', () => {
  it('stage labels and keys stay consistent in the one publish UI', () => {
    expect(stageLabels).toEqual(controlsStages);
    expect(controlsStageKeys).toHaveLength(controlsStages.length);
    expect(stageLabels).toHaveLength(controlsStageKeys.length);
  });

  it('PublishDialog.tsx is gone and nothing references it', () => {
    expect(existsSync(resolve(__dirname, '../components/PublishDialog.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../components/PublishDialog.css'))).toBe(false);
    for (const file of ['Workspace.tsx', 'ProjectConsole.tsx']) {
      const source = readFileSync(resolve(__dirname, `../components/${file}`), 'utf8');
      expect(source, file).not.toContain('PublishDialog');
    }
    const events = readFileSync(resolve(__dirname, '../lib/events.ts'), 'utf8');
    expect(events).not.toContain('open-deploy-modal');
  });

  it('the header Publish button and command palette open the console Publish section', () => {
    const workspace = readFileSync(resolve(__dirname, '../components/Workspace.tsx'), 'utf8');
    expect(workspace).toContain("section: 'Publish'");
    expect(workspace).toContain("selectTab('console')");
  });
});
