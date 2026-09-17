/**
 * Concurrency and integrity primitives for the ChatAgent's SQLite state.
 *
 * The agent receives messages over WebSockets and each one can trigger a
 * generation that writes many files. Two overlapping generations can interleave
 * their writes and leave the workspace in a state that neither asked for; a
 * user who hits stop and immediately re-prompts can have a *stale* generation's
 * file writes land after the new one's. These guards make the ordering explicit.
 */

/**
 * Monotonic write epoch. Every generation bumps it before it starts writing; any
 * write that observes an epoch older than the current one is a stale generation
 * whose writes must not land.
 */
export class WriteEpoch {
  private current = 0;

  /** Starts a new epoch and returns the ticket a generation must hold to write. */
  begin(): number {
    this.current += 1;
    return this.current;
  }

  /** Current epoch — a ticket below this is stale. */
  get value(): number {
    return this.current;
  }

  /** True only if `ticket` is still the most recent generation. */
  accepts(ticket: number): boolean {
    return typeof ticket === 'number' && ticket === this.current && ticket > 0;
  }

  /** For tests and diagnostics. */
  snapshot(): number {
    return this.current;
  }
}

/**
 * A non-reentrant busy lock. A generation taken while one is in flight is refused
 * rather than queued: the caller is told the reason and the client can retry,
 * which is safer than silently serialising an unknown amount of work.
 */
export class BusyLock {
  private held = false;
  private holder = '';

  /** Runs `fn` under the lock; returns null and a reason if it is already held. */
  async run<T>(label: string, fn: () => Promise<T>): Promise<{ value: T } | { reason: string }> {
    if (this.held) {
      return { reason: `${this.holder} is still running` };
    }
    this.held = true;
    this.holder = label;
    try {
      return { value: await fn() };
    } finally {
      this.held = false;
      this.holder = '';
    }
  }

  get isHeld(): boolean {
    return this.held;
  }

  get currentHolder(): string {
    return this.holder;
  }
}

/**
 * Idempotency for client retries. A WebSocket reconnect redelivers the last
 * message; without dedup the user gets two generations and two file-write passes
 * for one prompt. Keys are capped so a client cannot use it as a memory sink.
 */
export class IdempotencyStore {
  private readonly seen = new Map<string, number>();
  private readonly capacity: number;

  constructor(capacity = 256) {
    this.capacity = capacity;
  }

  /**
   * Records `key` and returns true the first time it is seen, false afterwards.
   * A null/empty key is treated as "no dedup requested" and always accepted.
   */
  claim(key: string | undefined | null): boolean {
    if (!key || typeof key !== 'string') return true;
    if (key.length > 256) return true;
    if (this.seen.has(key)) return false;
    if (this.seen.size >= this.capacity) {
      // Drop the oldest entry rather than refusing future keys.
      const first = this.seen.keys().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
    this.seen.set(key, Date.now());
    return true;
  }

  /**
   * Releases a claimed key so subsequent retries are not rejected as duplicates.
   */
  release(key: string | undefined | null): void {
    if (!key || typeof key !== 'string') return;
    this.seen.delete(key);
  }

  /** For tests: was this key recorded? */
  has(key: string): boolean {
    return this.seen.has(key);
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * Runs a sequence of SQL statements as one atomic unit. Durable Object SQLite
 * gives us `transactionSync`, which is synchronous and rolls back on a thrown
 * error — so the closure must not await anything, only run statements.
 *
 * The caller passes the storage object because the Agent's own `this.sql` is the
 * same handle the transaction operates on; binding it here keeps the helper free
 * of agent internals and therefore testable.
 */
export function runInTransaction<T>(
  storage: { transactionSync<R>(closure: () => R): R },
  statements: () => T
): T {
  return storage.transactionSync(() => statements());
}

/**
 * Deduplicates consecutive identical turns in a history rewrite. A client that
 * re-sends an edit twice would otherwise store the same assistant content back to
 * back, inflating the context window with no information.
 */
export function dedupeAdjacent(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
  const out: Array<{ role: string; content: string }> = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role && last.content === m.content) continue;
    out.push(m);
  }
  return out;
}
