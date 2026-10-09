/** Prevent an error/success flapping preview from buying an unbounded repair loop. */
export class RepairBudget {
  private attempts: Array<{ key: string; at: number }> = [];
  take(projectId: string, error: string, now = Date.now()): boolean {
    this.attempts = this.attempts.filter(attempt => now - attempt.at < 5 * 60_000);
    const key = projectId + ':' + error.replace(/\b\d+\b/g, '#').slice(0, 1000);
    // Allow 3 total repairs per project per 5 min; allow 2 attempts for the
    // same normalised error (up from 1) so a first-pass fix that misses one
    // type error still gets a second automatic attempt.
    if (this.attempts.filter(attempt => attempt.key.startsWith(projectId + ':')).length >= 3 || this.attempts.filter(attempt => attempt.key === key).length >= 2) return false;
    this.attempts.push({ key, at: now }); return true;
  }
}

/**
 * Detect when a dependency version alternates between values across repair
 * rounds (e.g. vite "^5.0.0" → "4.3.2" → "^5.0.0"). When the same package
 * reverts to a version it was changed FROM, the repair is chasing its own tail
 * and should surface the real error instead of looping.
 */
export class FlipFlopGuard {
  private history = new Map<string, string[]>();

  /** Record a version and return true when the change creates an A→B→A flip-flop. */
  record(key: string, version: string): boolean {
    const versions = this.history.get(key) || [];
    versions.push(version);
    this.history.set(key, versions);
    if (versions.length >= 3) {
      const tail = versions.slice(-3);
      if (tail[0] === tail[2] && tail[0] !== tail[1]) return true;
    }
    return false;
  }

  clear(): void { this.history.clear(); }
}

/** Per-session repair audit log. */
export class RepairLog {
  readonly entries: Array<{
    projectId: string;
    kind: 'round' | 'shrinkage' | 'unverified_claim' | 'unrelated_dep_change';
    detail: string;
    at: number;
  }> = [];

  add(projectId: string, kind: RepairLog['entries'][number]['kind'], detail: string, now = Date.now()): void {
    this.entries.push({ projectId, kind, detail, at: now });
  }

  forProject(projectId: string): typeof this.entries {
    return this.entries.filter(e => e.projectId === projectId);
  }
}
