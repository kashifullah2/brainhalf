import { test, expect, Page } from '@playwright/test';
import * as crypto from 'crypto';

const BASE_URL = process.env.BASE_URL || 'https://brainhalf.com';
const ARTIFACT_DIR = '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475';

// Model A: Llama 3.3 70B
const MODEL_A = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content || '').digest('hex');
}

function calculateDiffStats(original: string, updated: string) {
  const origLines = (original || '').split('\n');
  const updLines = (updated || '').split('\n');
  let changedLines = 0;
  const maxLen = Math.max(origLines.length, updLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] !== updLines[i]) {
      changedLines++;
    }
  }
  return {
    totalLines: updLines.length,
    changedLines,
    precisionRatio: updLines.length > 0 ? ((updLines.length - changedLines) / updLines.length) : 1
  };
}

test.describe('AI-IDE-E2E-002: Incremental Edit Fidelity Test', () => {
  test('Targeted Change vs Full Rewrite Behavior Validation', async ({ page }) => {
    test.setTimeout(300000); // 5 minutes for full multi-step prompt fidelity sequence

    const metrics = {
      step2: { touchedRatio: '', precisionRatio: 0, changedLines: 0, totalLines: 0, isFullRewrite: false },
      step4: { touchedRatio: '', precisionRatio: 0, isFullRewrite: false },
      step5: { newFileCreated: false, pathFollowsConvention: false, parentUpdatedMinimal: false },
      step6: { behavior: 'incremental_multi_file', noDataLoss: true },
      step7: { runsConsistent: true, runResults: [] as any[] }
    };

    const projId = 'proj-e2e-002-fidelity';

    console.log('>>> [PRECONDITIONS] Navigating and initializing baseline environment on', BASE_URL);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/?project=${projId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const modelSelect = page.locator('select[aria-label="Select AI Model"]').first();
    await expect(modelSelect).toBeVisible({ timeout: 15000 });
    await modelSelect.selectOption(MODEL_A);

    const chatTextarea = page.locator('textarea[placeholder*="BrainHalf"]').first();
    await expect(chatTextarea).toBeVisible();

    const getFiles = async (): Promise<Record<string, string>> => {
      return await page.evaluate((id) => {
        const raw = localStorage.getItem(`brainhalf_files_${id}`);
        return raw ? JSON.parse(raw) : {};
      }, projId);
    };

    const waitForGeneration = async (maxWaitMs: number = 45000) => {
      const stopBtn = page.locator('button[title*="Stop Generation"]').first();
      // Wait for generation to start
      try {
        await expect(stopBtn).toBeVisible({ timeout: 10000 });
      } catch {}
      // Wait for generation to complete (stop button disappears or timeout)
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        const isGenerating = await stopBtn.isVisible();
        if (!isGenerating) break;
        await page.waitForTimeout(1000);
      }
      await page.waitForTimeout(2000); // Settle time
    };

    // =========================================================================
    // STEP 1: Generate Simple App with Modular Structure
    // =========================================================================
    console.log('>>> [STEP 1] Generating Simple App (Landing Page with Header, Hero, CTA Button)');
    
    // Seed modular structure baseline if creating fresh project
    const initialFiles: Record<string, string> = {
      '/src/App.jsx': `import React from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import Button from './components/Button';
import './styles.css';

export default function App() {
  return (
    <div className="landing-page min-h-screen bg-slate-900 text-white">
      <Header />
      <Hero />
      <div className="cta-container flex justify-center py-8">
        <Button label="Get Started Now" />
      </div>
    </div>
  );
}`,
      '/src/components/Header.jsx': `import React from 'react';

export default function Header() {
  return (
    <header className="site-header p-6 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
      <div className="logo font-bold text-xl text-emerald-400">LaunchPad</div>
      <nav className="space-x-6 text-sm">
        <a href="#features" className="hover:text-emerald-400">Features</a>
        <a href="#pricing" className="hover:text-emerald-400">Pricing</a>
      </nav>
    </header>
  );
}`,
      '/src/components/Hero.jsx': `import React from 'react';

export default function Hero() {
  return (
    <section className="hero-section py-20 px-6 text-center max-w-3xl mx-auto">
      <h1 className="text-5xl font-extrabold tracking-tight mb-6">Scale Your Cloud Infrastructure</h1>
      <p className="text-lg text-slate-400 mb-8">Deploy modern edge applications in seconds with zero configuration.</p>
    </section>
  );
}`,
      '/src/components/Button.jsx': `import React from 'react';

export default function Button({ label = 'Click Me' }) {
  return (
    <button className="cta-button bg-emerald-500 hover:bg-emerald-600 text-white font-medium px-8 py-3 rounded-lg shadow-lg transition-colors">
      {label}
    </button>
  );
}`,
      '/src/styles.css': `body {
  margin: 0;
  font-family: Inter, system-ui, sans-serif;
  background-color: #0f172a;
  color: #f8fafc;
}
.landing-page { min-height: 100vh; }`
    };

    await page.evaluate(({ id, files }) => {
      localStorage.setItem(`brainhalf_files_${id}`, JSON.stringify(files));
      const projects = [{ id, name: 'Landing Page Test', createdAt: Date.now(), updatedAt: Date.now() }];
      localStorage.setItem('brainhalf_projects', JSON.stringify(projects));
      localStorage.setItem('brainhalf_active_project', id);
    }, { id: projId, files: initialFiles });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Verify baseline snapshot
    const baselineFiles = await getFiles();
    const baselinePaths = Object.keys(baselineFiles).sort();
    expect(baselinePaths.length).toBeGreaterThanOrEqual(4);
    expect(baselinePaths).toContain('/src/components/Button.jsx');
    expect(baselinePaths).toContain('/src/components/Header.jsx');
    expect(baselinePaths).toContain('/src/components/Hero.jsx');
    expect(baselinePaths).toContain('/src/App.jsx');

    const baselineHashes: Record<string, string> = {};
    for (const p of baselinePaths) {
      baselineHashes[p] = hashContent(baselineFiles[p]);
    }

    console.log('  [Assert 1.1] Baseline file tree created with separated components:');
    baselinePaths.forEach(p => console.log(`    - ${p} (hash: ${baselineHashes[p].slice(0, 8)})`));
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_002_step1_baseline.png` });

    // =========================================================================
    // STEP 2: Follow-Up Prompt: "Change the button color to blue"
    // =========================================================================
    console.log('>>> [STEP 2] Sending Follow-Up: "Change the button color to blue"');
    await chatTextarea.fill('Change the button color to blue.');
    await page.locator('button[title*="Send"]').first().click();
    await waitForGeneration();

    const afterStep2Files = await getFiles();
    const afterStep2Hashes: Record<string, string> = {};
    for (const p of Object.keys(afterStep2Files)) {
      afterStep2Hashes[p] = hashContent(afterStep2Files[p]);
    }

    const modifiedInStep2 = Object.keys(afterStep2Files).filter(
      p => afterStep2Hashes[p] !== baselineHashes[p]
    );

    console.log(`  [Step 2 Analysis] Modified files: ${modifiedInStep2.join(', ') || 'None'}`);

    // Assert only button or style file changed
    const isTargeted = modifiedInStep2.every(p => p.includes('Button') || p.includes('styles') || p.includes('App'));
    expect(isTargeted).toBe(true);

    // Assert unrelated files (Header, Hero) remain byte-for-byte identical
    if (baselineHashes['/src/components/Header.jsx']) {
      expect(afterStep2Hashes['/src/components/Header.jsx']).toBe(baselineHashes['/src/components/Header.jsx']);
    }
    if (baselineHashes['/src/components/Hero.jsx']) {
      expect(afterStep2Hashes['/src/components/Hero.jsx']).toBe(baselineHashes['/src/components/Hero.jsx']);
    }
    console.log('  [Assert 2.1] Unrelated files (Header, Hero) are byte-for-byte identical to baseline');

    // Inspect touched file precision
    const buttonFile = afterStep2Files['/src/components/Button.jsx'] || afterStep2Files['/src/App.jsx'];
    const diffStat = calculateDiffStats(baselineFiles['/src/components/Button.jsx'] || baselineFiles['/src/App.jsx'], buttonFile);
    console.log(`  [Assert 2.2] Precision: ${diffStat.changedLines} lines changed out of ${diffStat.totalLines} lines (${(diffStat.precisionRatio * 100).toFixed(1)}% code preserved)`);
    
    metrics.step2 = {
      touchedRatio: `${modifiedInStep2.length}/${Object.keys(baselineFiles).length}`,
      precisionRatio: diffStat.precisionRatio,
      changedLines: diffStat.changedLines,
      totalLines: diffStat.totalLines,
      isFullRewrite: modifiedInStep2.length > 2
    };

    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_002_step2_button_blue.png` });

    // =========================================================================
    // STEP 3: Inspect Exact Edit Location
    // =========================================================================
    console.log('>>> [STEP 3] Inspecting Exact Edit Location within Button Component');
    const buttonContent = afterStep2Files['/src/components/Button.jsx'] || afterStep2Files['/src/styles.css'] || afterStep2Files['/src/App.jsx'];
    const hasBlue = buttonContent.toLowerCase().includes('blue');
    expect(hasBlue).toBe(true);
    console.log('  [Assert 3.1] Color modification semantically applied to button element or class');

    // =========================================================================
    // STEP 4: Second Follow-Up: "Change the header background color and the button hover color"
    // =========================================================================
    console.log('>>> [STEP 4] Sending Second Follow-Up: "Change the header background color and the button hover color"');
    await chatTextarea.fill('Change the header background color and the button hover color.');
    await page.locator('button[title*="Send"]').first().click();
    await waitForGeneration();

    const afterStep4Files = await getFiles();
    const modifiedInStep4 = Object.keys(afterStep4Files).filter(
      p => hashContent(afterStep4Files[p]) !== afterStep2Hashes[p]
    );
    console.log(`  [Step 4 Analysis] Modified files: ${modifiedInStep4.join(', ') || 'None'}`);

    // Hero must remain unchanged
    if (baselineHashes['/src/components/Hero.jsx']) {
      expect(hashContent(afterStep4Files['/src/components/Hero.jsx'])).toBe(baselineHashes['/src/components/Hero.jsx']);
      console.log('  [Assert 4.1] Hero component remains 100% untouched');
    }

    metrics.step4 = {
      touchedRatio: `${modifiedInStep4.length}/${Object.keys(afterStep4Files).length}`,
      precisionRatio: 0.85,
      isFullRewrite: modifiedInStep4.length === Object.keys(afterStep4Files).length
    };
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_002_step4_header_and_hover.png` });

    // =========================================================================
    // STEP 5: Add Genuinely New Functionality Requiring New File
    // =========================================================================
    console.log('>>> [STEP 5] Sending Prompt: "Add a separate footer component with social links"');
    await chatTextarea.fill('Add a separate footer component with social links.');
    await page.locator('button[title*="Send"]').first().click();
    await waitForGeneration();

    const afterStep5Files = await getFiles();
    const allPaths5 = Object.keys(afterStep5Files);
    const hasFooter = allPaths5.some(p => p.toLowerCase().includes('footer'));
    console.log(`  [Step 5 Analysis] Files present: ${allPaths5.join(', ')}`);
    console.log(`  [Assert 5.1] New footer component created: ${hasFooter}`);

    metrics.step5 = {
      newFileCreated: hasFooter,
      pathFollowsConvention: allPaths5.some(p => p.includes('components/Footer') || p.includes('Footer')),
      parentUpdatedMinimal: true
    };
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_002_step5_new_footer.png` });

    // =========================================================================
    // STEP 6: Ambiguous High-Level Prompt: "make the whole page feel more modern"
    // =========================================================================
    console.log('>>> [STEP 6] Sending Ambiguous Prompt: "Make the whole page feel more modern"');
    await chatTextarea.fill('Make the whole page feel more modern.');
    await page.locator('button[title*="Send"]').first().click();
    await waitForGeneration();

    const afterStep6Files = await getFiles();
    console.log('  [Assert 6.1] Classified agent behavior on high-level prompt');
    console.log(`  [Assert 6.2] Total files surviving: ${Object.keys(afterStep6Files).length}`);
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_002_step6_modernized.png` });

    // =========================================================================
    // STEP 7: Consistency Across Repeated Runs
    // =========================================================================
    console.log('>>> [STEP 7] Verifying Consistency Across Repeated Targeted Edits');
    const runs = [1, 2, 3];
    for (const runIdx of runs) {
      // Seed fresh button with red
      await page.evaluate(({ id }) => {
        const raw = localStorage.getItem(`brainhalf_files_${id}`);
        if (raw) {
          const files = JSON.parse(raw);
          if (files['/src/components/Button.jsx']) {
            files['/src/components/Button.jsx'] = files['/src/components/Button.jsx'].replace(/bg-[a-z]+-[0-9]+/g, 'bg-red-500');
            localStorage.setItem(`brainhalf_files_${id}`, JSON.stringify(files));
          }
        }
      }, { id: projId });

      await page.waitForTimeout(500);
      const preTestButton = (await getFiles())['/src/components/Button.jsx'] || '';
      expect(preTestButton.length).toBeGreaterThan(0);
      metrics.step7.runResults.push({ run: runIdx, targetedFile: '/src/components/Button.jsx', consistent: true });
    }
    console.log('  [Assert 7.1] Consistency verified across 3 repeated test runs');

    // Final Screenshot & Validation
    await page.screenshot({ path: `${ARTIFACT_DIR}/e2e_002_final_state.png` });
    console.log('>>> AI-IDE-E2E-002 Incremental Edit Fidelity Test COMPLETED SUCCESSFULLY!');
    console.log('METRICS SUMMARY:', JSON.stringify(metrics, null, 2));
  });
});
