/**
 * Plain-language copy for failed publish verification checks.
 *
 * Verification check names are generated per app (e.g. "Agent chat with missing
 * messages returns 400") and their details read like test output
 * ("Expected HTTP 400; received 503"). Non-technical users cannot act on that,
 * so the UI leads with one plain sentence per failed check and keeps the raw
 * output behind a "Technical details" expander for the agent and power users.
 */

export interface FailedCheck {
  name: string;
  detail: string;
}

export interface VerificationFailureCopy {
  /** e.g. "One automatic check did not pass." */
  headline: string;
  /** What this means for the user's app. */
  reassurance: string;
  /** One plain sentence per failed check, in the same order. */
  plainChecks: string[];
}

const CHECK_PATTERNS: Array<[RegExp, string]> = [
  [/expected http \d+; received \d+/i, 'A feature gave the wrong answer when it was tested.'],
  [/timed?\s?out/i, 'A feature took too long to answer while it was being tested.'],
  [/\b404\b|not found/i, 'A page or feature the test looked for was not there.'],
  [/expected .+ to (be|equal|contain|match)/i, 'A feature did not behave the way it should.'],
  [/connection refused|econnrefused|fetch failed|network/i, 'The test could not reach part of the app over the network.'],
];

export function plainLanguageCheck(check: FailedCheck): string {
  const text = `${check.name} ${check.detail}`;
  for (const [pattern, plain] of CHECK_PATTERNS) {
    if (pattern.test(text)) return plain;
  }
  return 'An automatic check on the app did not pass.';
}

export function describeVerificationFailure(checks: FailedCheck[]): VerificationFailureCopy {
  return {
    headline: checks.length === 1 ? 'One automatic check did not pass.' : `${checks.length} automatic checks did not pass.`,
    reassurance: 'This version was not published, and anything already live is untouched.',
    plainChecks: checks.map(plainLanguageCheck),
  };
}

/** True when a publish job message indicates the failure came from verification rather than the build. */
export function isVerificationFailure(jobMessage: string): boolean {
  return /verif/i.test(jobMessage);
}
