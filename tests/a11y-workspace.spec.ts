import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { setupLifecycle } from './fixtures/lifecycle';

// CI accessibility gate recommended by the upgrade009 review: the workspace
// shell must stay free of critical WCAG 2 A/AA violations.
test('workspace shell has no critical accessibility violations', async ({ page }) => {
  await setupLifecycle(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const critical = results.violations.filter(violation => violation.impact === 'critical');
  expect(
    critical.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});
