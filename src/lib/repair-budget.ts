/** Prevent an error/success flapping preview from buying an unbounded repair loop. */
export class RepairBudget {
  private attempts: Array<{ key: string; at: number }> = [];
  take(projectId: string, error: string, now = Date.now()): boolean {
    this.attempts = this.attempts.filter(attempt => now - attempt.at < 5 * 60_000);
    const key = projectId + ':' + error.replace(/\b\d+\b/g, '#').slice(0, 1000);
    if (this.attempts.filter(attempt => attempt.key.startsWith(projectId + ':')).length >= 3 || this.attempts.filter(attempt => attempt.key === key).length >= 1) return false;
    this.attempts.push({ key, at: now }); return true;
  }
}
