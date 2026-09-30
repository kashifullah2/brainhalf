import { PILOT_LIMITS } from '../runtime/types';

/**
 * The account-wide cap on running/published apps ("hosted app spaces").
 * Single-sourced from the backend's PILOT_LIMITS so the UI can never quote a
 * stale number.
 */
export const HOSTED_APP_LIMIT = PILOT_LIMITS.projects;

/**
 * True when an error message means the account's hosted app spaces are full.
 * Matches both the current backend wording ("hosted app limit") and the older
 * wording ("hosted project limit") so clients rolling out at different times
 * still get the dedicated, actionable UI instead of a generic failure.
 */
export function isHostedLimitError(message: string | null | undefined): boolean {
  return !!message && /hosted (project|app) limit/i.test(message);
}
