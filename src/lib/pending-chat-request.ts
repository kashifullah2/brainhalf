export class PendingChatRequest {
  readonly idempotencyKey = crypto.randomUUID();
  private settled = false;
  private cleanups = new Set<() => void>();

  get pending(): boolean {
    return !this.settled;
  }

  onCleanup(cleanup: () => void): void {
    if (this.settled) cleanup();
    else this.cleanups.add(cleanup);
  }

  expireAfter(milliseconds: number, onExpired: () => void): void {
    if (this.settled) return;
    const timer = setTimeout(() => {
      if (this.settled) return;
      this.cancel();
      onExpired();
    }, milliseconds);
    this.onCleanup(() => clearTimeout(timer));
  }

  cancel(): void {
    this.settled = true;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.clear();
  }

  send(callback: (idempotencyKey: string) => void): boolean {
    if (this.settled) return false;
    this.cancel();
    callback(this.idempotencyKey);
    return true;
  }
}
