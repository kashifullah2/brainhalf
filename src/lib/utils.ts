import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitizes strings for CSV/Excel export to prevent formula injection attacks.
 * If a string starts with a formula character (=, +, -, @), it prepends a single quote.
 */
export function sanitizeForExport(value: unknown): string {
  const str = String(value ?? "");
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}
