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
 * for one prompt.
 *
 * Keys are persisted in SQLite so they survive DO hibernation. When no SQL
 * handle is provided (tests), falls back to an in-memory Map.
 */
export class IdempotencyStore {
  private readonly memory = new Map<string, number>();
  private readonly capacity: number;
  private sqlFn: ((sql: string, ...values: any[]) => any[]) | null = null;

  constructor(capacity = 256) {
    this.capacity = capacity;
  }

  setSql(fn: (sql: string, ...values: any[]) => any[]): void {
    this.sqlFn = fn;
  }

  claim(key: string | undefined | null): boolean {
    if (!key || typeof key !== 'string') return true;
    if (key.length > 256) return true;
    if (this.sqlFn) {
      try {
        const rows = this.sqlFn(`SELECT key FROM idempotency_keys WHERE key = ?`, key);
        if (rows.length > 0) return false;
        this.sqlFn(`INSERT INTO idempotency_keys (key, claimed_at) VALUES (?, ?)`, key, Date.now());
        this.pruneIfNeeded();
        return true;
      } catch {
        return this.claimMemory(key);
      }
    }
    return this.claimMemory(key);
  }

  release(key: string | undefined | null): void {
    if (!key || typeof key !== 'string') return;
    if (this.sqlFn) {
      try { this.sqlFn(`DELETE FROM idempotency_keys WHERE key = ?`, key); } catch {}
    }
    this.memory.delete(key);
  }

  has(key: string): boolean {
    if (this.sqlFn) {
      try {
        return this.sqlFn(`SELECT key FROM idempotency_keys WHERE key = ?`, key).length > 0;
      } catch {}
    }
    return this.memory.has(key);
  }

  get size(): number {
    if (this.sqlFn) {
      try {
        const rows = this.sqlFn(`SELECT COUNT(*) as count FROM idempotency_keys`) as Array<{ count: number }>;
        return rows[0]?.count ?? this.memory.size;
      } catch {}
    }
    return this.memory.size;
  }

  private claimMemory(key: string): boolean {
    if (this.memory.has(key)) return false;
    if (this.memory.size >= this.capacity) {
      const first = this.memory.keys().next().value;
      if (first !== undefined) this.memory.delete(first);
    }
    this.memory.set(key, Date.now());
    return true;
  }

  private pruneIfNeeded(): void {
    if (!this.sqlFn) return;
    try {
      const rows = this.sqlFn(`SELECT COUNT(*) as count FROM idempotency_keys`) as Array<{ count: number }>;
      if ((rows[0]?.count ?? 0) > this.capacity) {
        this.sqlFn(`DELETE FROM idempotency_keys WHERE key IN (SELECT key FROM idempotency_keys ORDER BY claimed_at ASC LIMIT 10)`);
      }
    } catch {}
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
