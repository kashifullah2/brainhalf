/**
 * Single source of truth for BrainHalf's product limits.
 *
 * These numbers are the product contract (quotas, AI budgets, hosted-app
 * capacity). They were previously scattered as file-local literals across
 * the registry, the AI budget ledger, and the runtime pilot config, which
 * is how a quota check once compared against the wrong constant without
 * anything catching it. Change a value here and every enforcement point
 * follows; never re-declare one of these numbers anywhere else.
 */
export const MAX_PROJECTS_PER_USER = 50;
export const MAX_PROJECT_ROWS_PER_USER = 200;
export const MAX_HOSTED_APP_SPACES = 10;
export const AI_DAILY_MODEL_CALLS = 200;
export const AI_DAILY_OUTPUT_TOKENS = 10_000_000;
export const AI_CONCURRENT_GENERATIONS = 4;
export const AI_GENERATION_LEASE_MS = 15 * 60_000;
