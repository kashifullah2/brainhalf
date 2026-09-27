import type { Page } from '@playwright/test';
// Advanced controls (Model, Agent tools, Hosting settings) are always visible —
// no toggle button needed. This helper is kept as a no-op so existing call sites
// continue to compile and run without changes.
export async function openAdvanced(_page: Page) {}
