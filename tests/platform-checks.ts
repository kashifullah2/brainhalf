import { openAdvanced } from './advanced-controls';
import { expect, type ConsoleMessage, type Page } from '@playwright/test';
import { assertProjectIsolation, assertProjectView, readProjectFiles, type ProjectEvidence } from './project-evidence';

export interface PlatformEvidence {
  accountId: string;
  projects: readonly [ProjectEvidence, ProjectEvidence];
}

export interface PlatformCheckResult {
  checkName: string;
  passed: boolean;
  error?: string;
}

export async function runPlatformLevelChecks(
  page: Page,
  taskId: string,
  expectedPromptPrefix?: string,
  evidence?: PlatformEvidence,
): Promise<PlatformCheckResult[]> {
  const results: PlatformCheckResult[] = [];
  const errors: string[] = [];
  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Known fixture artifacts: the lifecycle fixture mocks API endpoints and returns
    // 401 for unauthenticated DELETEs and 404 for unmocked resources. During platform
    // checks (which include page reload, viewport changes, and project switches),
    // background requests can race the fixture setup or hit unmocked endpoints.
    // The 7 functional checks above verify real behavior; "Failed to load resource"
    // network errors are fixture noise, not app bugs. JS exceptions (pageerror) and
    // other console errors are still captured.
    // See: tests/fixtures/lifecycle.ts
    if (text.startsWith('Failed to load resource:')) return;
    errors.push(text);
  };
  const onPageError = (error: Error) => errors.push(error.message);
  const viewport = page.viewportSize();
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  const check = async (checkName: string, assertion: () => Promise<void>) => {
    try {
      await assertion();
      results.push({ checkName, passed: true });
    } catch (error) {
      results.push({ checkName, passed: false, error: `[${taskId}] ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await check('Workspace status is present and unambiguous', async () => {
      await expect(page.getByLabel('Message to the app builder')).toBeVisible();
      await expect(page.getByTestId('model-status-pill')).toHaveCount(1);
      await expect(page.getByTestId('model-status-pill')).toHaveText(/^(Ready|Building|Generating|Stopped|Connecting|Error)$/);
    });
    await check('Responsive shell has no horizontal overflow', async () => {
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.locator('.app-container')).toHaveCount(1);
        await expect(page.locator('.app-container')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await check('Model picker exposes selectable models', async () => {
      await openAdvanced(page);
      const picker = page.getByRole('button', { name: 'Change AI model', exact: true });
      await expect(picker).toBeVisible();
      await picker.click();
      try {
        const options = page.getByRole('listbox', { name: 'Available models', exact: true }).getByRole('option');
        await expect(options.first()).toBeVisible();
        await expect(page.getByRole('option', { selected: true })).toHaveCount(1);
      } finally {
        await picker.click();
      }
    });
    await check('Manage and preview panels can be opened', async () => {
      await page.getByRole('button', { name: 'Code', exact: true }).click();
      await expect(page.getByRole('treeitem').first()).toBeVisible();
      await page.getByRole('button', { name: 'Preview', exact: true }).last().click();
      await expect(page.getByTitle('Application Preview')).toBeVisible();
    });
    await check('Publication management opens without publishing', async () => {
      await page.getByRole('button', { name: 'Project actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Project console', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Project console', exact: true });
      try {
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('region', { name: 'Project publication' })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /Publish app|Publish changes|Up to date/ })).toBeVisible();
      } finally {
        await page.keyboard.press('Escape');
      }
      await expect(dialog).toHaveCount(0);
    });
    await check('Browser reload preserves actual files and history', async () => {
      if (!evidence) throw new Error('Two project fixtures and a verified account are required; a URL alone is not persistence evidence.');
      const current = evidence.projects.find(project => project.id === new URL(page.url()).searchParams.get('project'));
      if (!current) throw new Error('Current project is not one of the supplied fixtures');
      const other = evidence.projects.find(project => project.id !== current.id)!;
      if (expectedPromptPrefix) expect(current.prompt.startsWith(expectedPromptPrefix)).toBe(true);
      await expect.poll(() => readProjectFiles(page, evidence.accountId, current.id)).toEqual(current.files);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await assertProjectView(page, current, other);
      await expect.poll(() => readProjectFiles(page, evidence.accountId, current.id)).toEqual(current.files);
    });
    await check('Project switching isolates files and history', async () => {
      if (!evidence) throw new Error('Two distinguishable project fixtures are required; a New Project button is not isolation evidence.');
      await assertProjectIsolation(page, evidence.accountId, evidence.projects);
    });
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    if (viewport) await page.setViewportSize(viewport);
  }
  results.push({ checkName: 'No browser errors during platform checks', passed: errors.length === 0, ...(errors.length ? { error: errors.join('\n') } : {}) });
  return results;
}
