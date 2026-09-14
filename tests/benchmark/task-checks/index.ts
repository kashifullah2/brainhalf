/**
 * BrainHalf Benchmark — Task Checks Registry
 * Exports a map of `runChecks(page, previewUrl)` functions keyed by taskId.
 */

import type { Page } from '@playwright/test';
import type { CheckResult } from '../result-writer.js';

import { runChecks as easy1 } from './easy-1-unit-converter.js';
import { runChecks as easy2 } from './easy-2-todo-list.js';
import { runChecks as easy3 } from './easy-3-color-palette.js';
import { runChecks as medium1 } from './medium-1-kanban.js';
import { runChecks as medium2 } from './medium-2-signup-wizard.js';
import { runChecks as medium3 } from './medium-3-product-catalog.js';
import { runChecks as hard1 } from './hard-1-analytics-dashboard.js';
import { runChecks as hard2 } from './hard-2-chat-ui.js';
import { runChecks as hard3 } from './hard-3-booking-calendar.js';
import { runChecks as veryHard1 } from './very-hard-1-project-management.js';
import { runChecks as veryHard2 } from './very-hard-2-ecommerce.js';
import { runChecks as veryHard3 } from './very-hard-3-collab-editor.js';

export type CheckRunner = (page: Page, previewUrl: string) => Promise<CheckResult[]>;

export const TASK_CHECKS: Record<string, CheckRunner> = {
  'easy-1': easy1,
  'easy-2': easy2,
  'easy-3': easy3,
  'medium-1': medium1,
  'medium-2': medium2,
  'medium-3': medium3,
  'hard-1': hard1,
  'hard-2': hard2,
  'hard-3': hard3,
  'very-hard-1': veryHard1,
  'very-hard-2': veryHard2,
  'very-hard-3': veryHard3,
};
