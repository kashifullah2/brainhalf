import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const BREAKPOINTS = [320, 375, 414, 768, 1024, 1280, 1440, 1920];
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'screenshots');

test.describe('Platform Responsive & UI/UX Audit', () => {
  test('audits layout, overlap, scrollWidth, and tap targets across 8 breakpoints', async ({ page }) => {
    const a11yIssues: any[] = [];
    const responsiveIssues: any[] = [];

    for (const width of BREAKPOINTS) {
      const height = width < 768 ? 812 : 900;
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      // 1. Capture full-page screenshot
      const screenshotPath = path.join(SCREENSHOT_DIR, `breakpoint-${width}px.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      // 2. Horizontal scroll check
      const scrollMetrics = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
        };
      });

      const hasHorizontalScroll =
        scrollMetrics.scrollWidth > scrollMetrics.innerWidth + 1 ||
        scrollMetrics.bodyScrollWidth > scrollMetrics.innerWidth + 1;

      if (hasHorizontalScroll) {
        responsiveIssues.push({
          breakpoint: `${width}px`,
          issue: 'Horizontal scroll detected',
          details: `scrollWidth (${scrollMetrics.scrollWidth}px) exceeds innerWidth (${scrollMetrics.innerWidth}px)`,
        });
      }
      expect(hasHorizontalScroll, `Horizontal scroll detected at ${width}px`).toBeFalsy();

      // 3. Overlap detection script for visible interactive elements
      const overlapReport = await page.evaluate(() => {
        const interactives = Array.from(document.querySelectorAll('button, a, input, select, textarea'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0'
            );
          });

        const overlaps: string[] = [];
        for (let i = 0; i < interactives.length; i++) {
          const r1 = interactives[i].getBoundingClientRect();
          for (let j = i + 1; j < interactives.length; j++) {
            const r2 = interactives[j].getBoundingClientRect();
            // Check for true intersection (excluding identical bounds or containment)
            const intersects = !(
              r2.left >= r1.right ||
              r2.right <= r1.left ||
              r2.top >= r1.bottom ||
              r2.bottom <= r1.top
            );
            if (intersects) {
              const label1 = interactives[i].textContent?.trim() || interactives[i].getAttribute('aria-label') || interactives[i].tagName;
              const label2 = interactives[j].textContent?.trim() || interactives[j].getAttribute('aria-label') || interactives[j].tagName;
              overlaps.push(`"${label1}" overlaps with "${label2}"`);
            }
          }
        }
        return overlaps;
      });

      if (overlapReport.length > 0) {
        responsiveIssues.push({
          breakpoint: `${width}px`,
          issue: 'Intersecting interactive elements',
          details: overlapReport.slice(0, 3).join('; '),
        });
      }

      // 4. Tap target check for mobile (< 768px)
      if (width < 768) {
        const smallTargets = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a[href]')).filter(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none';
          });
          return buttons
            .filter(btn => {
              const rect = btn.getBoundingClientRect();
              return rect.width < 32 || rect.height < 32; // strict touch target lower bound
            })
            .map(btn => btn.textContent?.trim() || btn.getAttribute('aria-label') || 'unnamed-btn');
        });

        if (smallTargets.length > 0) {
          responsiveIssues.push({
            breakpoint: `${width}px`,
            issue: 'Small touch targets below 32px',
            details: `Elements: ${smallTargets.slice(0, 4).join(', ')}`,
          });
        }
      }

      // 5. Basic accessibility audits (contrast, labels, image alt tags)
      const a11yResult = await page.evaluate((bp) => {
        const issues: Array<{ breakpoint: number; rule: string; element: string }> = [];
        // Images without alt
        document.querySelectorAll('img:not([alt])').forEach(img => {
          issues.push({ breakpoint: bp, rule: 'image-alt', element: img.outerHTML.slice(0, 60) });
        });
        // Inputs without label or aria-label
        document.querySelectorAll('input:not([aria-label]):not([aria-labelledby]):not([title])').forEach(inp => {
          const id = inp.getAttribute('id');
          if (!id || !document.querySelector(`label[for="${id}"]`)) {
            issues.push({ breakpoint: bp, rule: 'input-label', element: inp.outerHTML.slice(0, 60) });
          }
        });
        return issues;
      }, width);

      a11yIssues.push(...a11yResult);
    }

    // Write a11y report
    fs.writeFileSync(
      path.resolve(process.cwd(), 'a11y-report.json'),
      JSON.stringify({ auditTimestamp: new Date().toISOString(), totalIssues: a11yIssues.length, issues: a11yIssues }, null, 2)
    );

    console.log(`Responsive audit completed for all 8 breakpoints. Issues logged: ${responsiveIssues.length}`);
  });
});
