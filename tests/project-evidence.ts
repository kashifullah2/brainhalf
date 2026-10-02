import { expect, type Page } from '@playwright/test';

export interface ProjectEvidence {
  id: string;
  prompt: string;
  uniqueFile: string;
  files: Record<string, string>;
}

export async function openProject(page: Page, project: ProjectEvidence) {
  if (new URL(page.url()).pathname !== '/dashboard') await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const card = page.locator('.landing-project-card').filter({ hasText: project.prompt });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: /^Open / }).click();
}

export async function readProjectFiles(page: Page, accountId: string, projectId: string): Promise<Record<string, string> | null> {
  return page.evaluate(async ({ accountId, projectId }) => {
    const prefix = `brainhalf_account:${encodeURIComponent(accountId)}:`;
    const databases = await indexedDB.databases();
    if (databases.some(database => database.name === 'BrainHalfStorage')) {
      const stored = await new Promise<Record<string, string> | undefined>((resolve, reject) => {
        const opening = indexedDB.open('BrainHalfStorage');
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains('files')) {
            database.close();
            resolve(undefined);
            return;
          }
          const transaction = database.transaction('files');
          const request = transaction.objectStore('files').get(`${prefix}${projectId}`);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          transaction.oncomplete = () => database.close();
          transaction.onabort = () => { database.close(); reject(transaction.error); };
        };
      });
      if (stored !== undefined) return stored;
    }
    const raw = localStorage.getItem(`${prefix}brainhalf_files_${projectId}`);
    return raw ? JSON.parse(raw) : null;
  }, { accountId, projectId });
}

export async function assertProjectView(page: Page, project: ProjectEvidence, other: ProjectEvidence) {
  await expect.poll(() => new URL(page.url()).searchParams.get('project')).toBe(project.id);
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  await expect(page.locator('.message-content').filter({ hasText: project.prompt })).toBeVisible();
  expect(await page.locator('.message-content').filter({ hasText: other.prompt }).count(), 'Other project history must never appear in the mounted conversation').toBe(0);
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'View code', exact: true }).click();
  await expect(page.getByRole('treeitem').filter({ hasText: project.uniqueFile })).toBeVisible();
  await expect(page.getByRole('treeitem').filter({ hasText: other.uniqueFile })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview', exact: true }).last().click();
}

export async function assertProjectIsolation(page: Page, accountId: string, projects: readonly [ProjectEvidence, ProjectEvidence]) {
  const [first, second] = projects;
  expect(first.id, 'Isolation needs two distinct projects').not.toBe(second.id);
  expect(first.prompt, 'Isolation needs distinguishable history').not.toBe(second.prompt);
  expect(first.uniqueFile, 'Isolation needs distinguishable files').not.toBe(second.uniqueFile);
  for (const [current, other] of [[first, second], [second, first], [first, second]]) {
    await page.getByRole('button', { name: 'Return to Home', exact: true }).click();
    await openProject(page, current);
    await assertProjectView(page, current, other);
    await expect.poll(() => readProjectFiles(page, accountId, current.id)).toEqual(current.files);
  }
}
