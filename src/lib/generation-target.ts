import { isFullStackProject } from './backend-runner';
import type { RuntimeAvailability, RuntimeStatus } from '../runtime/types';

/** Conservative product preflight; the runtime still enforces actual admission. */
export function needsBackend(prompt: string, files: Record<string, string>): boolean {
  if (isFullStackProject(files)) return true;
  // Respect explicit demo scope. Mentioning a service only to exclude it must
  // not provision that service or delay a frontend preview.
  const request = prompt.replace(/\b(?:no|without|do not (?:add|use|create)|don't (?:add|use|create))\s+(?:(?:a|any|an)\s+)?(?:back[ -]?end|database|authentication|auth|login|sign[ -]?in)(?:\s+(?:or|and)\s+(?:back[ -]?end|database|authentication|auth|login))*/gi, '');
  const frontendOnly = /\b(?:front[ -]?end[ -]only|front[ -]?end demo|static (?:demo|mockup)|ui[ -]only)\b/i.test(request) || /\b(?:no|without|do not (?:add|use|create)|don't (?:add|use|create))\s+(?:(?:a|any|an)\s+)?back[ -]?end\b/i.test(prompt);
  const onlineRequirement = /\b(?:connect (?:to )?(?:a |the )?database|save .{0,30} (?:online|to (?:a |the )?database)|real (?:authentication|payments)|(?:add|implement|create|build) (?:a |an |the )?(?:database|backend|authentication|login))\b/i.test(request);
  if (frontendOnly && !onlineRequirement) return false;
  return /\b(?:back[ -]?end|full[ -]?stack|database|persist\w*|authentication|auth|sign[ -]?(?:in|up)|log[ -]?in|accounts?|checkout|payment|e[ -]?commerce|websocket|real[ -]?time|shared files|customer portal|crm|inventory|bookings?|reservations?|task (?:app|manager|management)|habit tracker|expense tracker|project management|kanban|storefront)\b/i.test(request);
}

export function hostingAvailability(status: Pick<RuntimeStatus, 'enabled' | 'availability'>): RuntimeAvailability {
  return status.enabled && status.availability?.state === 'ready'
    ? status.availability
    : status.availability?.state !== 'ready' && status.availability
      ? status.availability
      : { state: 'setup_required', message: 'Managed hosting is unavailable. You can build an app to download and run on your own hosting.' };
}
