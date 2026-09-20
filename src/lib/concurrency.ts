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
 *
 * `fn` may never settle — a provider that stops responding mid-stream, an
 * abandoned abort — and a lock with no timeout would then stay held for the life
 * of the Durable Object: every subsequent prompt on that project would be
 * refused with "still running" and nothing could clear it short of an eviction.
 * So `run` takes a timeout and, when it fires, releases the lock and reports the
 * timeout as a reason exactly like a refusal.
 */
export class BusyLock {
  private held = false;
  private holder = '';

  async run<T>(
    label: string,
    fn: () => Promise<T>,
    timeoutMs = 5 * 60_000
  ): Promise<{ value: T } | { reason: string }> {
    if (this.held) {
      return { reason: `${this.holder} is still running` };
    }
    this.held = true;
    this.holder = label;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    try {
      const work = fn().then(
        (value) => { settled = true; return { value } as { value: T }; },
        (err) => { settled = true; throw err; }
      );
      const timeout = new Promise<{ reason: string }>((resolve) => {
        timer = setTimeout(
          () => resolve({ reason: `${label} exceeded ${timeoutMs}ms and was abandoned` }),
          timeoutMs
        );
      });
      const result = await Promise.race([work, timeout]);
      if (!settled) {
        // The timeout won and `fn` is still in flight; nobody is awaiting it, so
        // a later rejection would be an unhandled-rejection crash of the
        // isolate. Detach it — the caller has already been told the job was
        // abandoned.
        work.catch(() => { /* no longer awaited by design */ });
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
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
   *
   * Both guards here are deliberate evictions, not errors, because either way
   * the caller proceeds to generate: a key longer than 256 chars is accepted
   * rather than stored (it can never be presented again anyway, since a retry
   * redelivers the identical string), and once the store holds `capacity`
   * entries the oldest is dropped to make room. That means dedup is a
   * bounded-history guarantee, not an unbounded one — a message whose key was
   * evicted will generate again if it is redelivered. capacity defaults to 256,
   * far above the number of in-flight generations a single ChatAgent holds, so
   * eviction only happens if a client hammers the agent with hundreds of
   * distinct keys without a reconnect.
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
