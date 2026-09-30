/** Product allowances, not provider prices. Reservations remain charged on failure. */
export const AI_ALLOWANCE = { dailyCalls: 200, dailyOutputTokens: 10_000_000, concurrentGenerations: 4, leaseMs: 15 * 60_000 } as const;
export interface AiUsage { day: string; calls: number; reservedOutputTokens: number; activeGenerations: number; limits: typeof AI_ALLOWANCE }
interface Sql { exec(query: string, ...values: (string | number | null)[]): { toArray(): Record<string, unknown>[] } }
interface LedgerStorage { sql: Sql; transactionSync<T>(work: () => T): T }
export type AiBudgetErrorKind = 'concurrency' | 'daily' | 'other';
export class AiBudgetError extends Error {
  constructor(message: string, readonly status = 503, readonly kind: AiBudgetErrorKind = 'other') { super(message); }
}

/** Runs on an owner-specific registry instance. All check-and-charge writes are atomic. */
export class AiLedger {
  constructor(private storage: LedgerStorage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS ai_calls (id TEXT PRIMARY KEY, day TEXT NOT NULL, output_tokens INTEGER NOT NULL)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS ai_calls_day ON ai_calls(day)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS ai_leases (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
  }
  usage(now = Date.now()): AiUsage {
    const day = new Date(now).toISOString().slice(0, 10);
    const row = this.storage.sql.exec('SELECT COUNT(*) AS calls, COALESCE(SUM(output_tokens),0) AS tokens FROM ai_calls WHERE day=?', day).toArray()[0];
    const active = this.storage.sql.exec('SELECT COUNT(*) AS active FROM ai_leases WHERE expires_at>?', now).toArray()[0];
    return { day, calls: Number(row.calls), reservedOutputTokens: Number(row.tokens), activeGenerations: Number(active.active), limits: AI_ALLOWANCE };
  }
  start(id: string, now = Date.now()) {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM ai_leases WHERE expires_at<=?', now);
      this.storage.sql.exec('DELETE FROM ai_calls WHERE day<?', new Date(now - 2 * 86400_000).toISOString().slice(0, 10));
      if (this.storage.sql.exec('SELECT id FROM ai_leases WHERE id=?', id).toArray().length) return;
      const usage = this.usage(now);
      if (usage.activeGenerations >= AI_ALLOWANCE.concurrentGenerations) throw new AiBudgetError(`${AI_ALLOWANCE.concurrentGenerations} AI generations are already running across your projects. Wait or stop one before retrying.`, 429, 'concurrency');
      if (usage.calls >= AI_ALLOWANCE.dailyCalls || usage.reservedOutputTokens >= AI_ALLOWANCE.dailyOutputTokens) throw new AiBudgetError('Your daily AI allowance is exhausted. It resets at midnight UTC.', 429, 'daily');
      this.storage.sql.exec('INSERT INTO ai_leases(id,expires_at) VALUES (?,?)', id, now + AI_ALLOWANCE.leaseMs);
    });
  }
  reserve(lease: string, id: string, maxTokens: number, now = Date.now()) {
    if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 65536) throw new AiBudgetError('Invalid AI output allowance.', 400);
    this.storage.transactionSync(() => {
      if (!this.storage.sql.exec('SELECT id FROM ai_leases WHERE id=? AND expires_at>?', lease, now).toArray().length) throw new AiBudgetError('The AI reservation expired. Retry your request.', 409);
      if (this.storage.sql.exec('SELECT id FROM ai_calls WHERE id=?', id).toArray().length) return;
      const usage = this.usage(now);
      if (usage.calls >= AI_ALLOWANCE.dailyCalls || usage.reservedOutputTokens + maxTokens > AI_ALLOWANCE.dailyOutputTokens) throw new AiBudgetError('Your daily AI allowance cannot cover this call. Select a smaller output limit or retry after midnight UTC.', 429, 'daily');
      this.storage.sql.exec('INSERT INTO ai_calls(id,day,output_tokens) VALUES (?,?,?)', id, usage.day, maxTokens);
    });
  }
  end(id: string) { this.storage.sql.exec('DELETE FROM ai_leases WHERE id=?', id); }
}

interface BudgetEnv { REGISTRY?: { idFromName(name: string): unknown; get(id: any): { fetch(request: Request): Promise<Response> } } }
export function aiBudgetEndpoint(env: BudgetEnv, owner: string) {
  if (!env.REGISTRY || !owner) throw new AiBudgetError('AI allowance service unavailable. No inference was started.');
  return env.REGISTRY.get(env.REGISTRY.idFromName(`ai-budget:${owner}`));
}
export class AiBudget {
  readonly id = crypto.randomUUID();
  constructor(private env: BudgetEnv, private owner: string, private signal?: AbortSignal) {}
  private async request(path: string, body: Record<string, unknown>) {
    const response = await aiBudgetEndpoint(this.env, this.owner).fetch(new Request(`https://registry/ai/${path}`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }));
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: string; kind?: AiBudgetErrorKind } | null;
      throw new AiBudgetError(data?.error || 'AI allowance service unavailable. No new inference was started.', response.status, data?.kind ?? 'other');
    }
    const data = await response.json() as { ok?: boolean };
    if (data.ok !== true) throw new AiBudgetError('AI allowance service returned an invalid reservation.');
  }
  async start() { this.signal?.throwIfAborted(); await this.request('start', { id: this.id }); }
  async reserve(maxTokens: number) { this.signal?.throwIfAborted(); await this.request('reserve', { lease: this.id, id: crypto.randomUUID(), maxTokens }); this.signal?.throwIfAborted(); }
  async startAndReserve(maxTokens: number) {
    this.signal?.throwIfAborted();
    await this.request('start', { id: this.id });
    this.signal?.throwIfAborted();
    await this.request('reserve', { lease: this.id, id: crypto.randomUUID(), maxTokens });
    this.signal?.throwIfAborted();
  }
  async end() { await this.request('end', { id: this.id }); }
}

/**
 * Meter SDK steps at the actual model boundary.
 *
 * Budget reservation was previously done here on every doStream/doGenerate call
 * (one per tool step). That charged 6 × dailyCalls for a single 6-step generation
 * and required 6 sequential network round-trips to the registry DO before each
 * step could start. Reservation is now done once at generation start via
 * budget.reserveGeneration(); this proxy only tracks the provider call count.
 */
export function meteredModel<T extends object>(model: T, onCall: () => void = () => {}): T {
  return new Proxy(model, { get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if ((property === 'doStream' || property === 'doGenerate') && typeof value === 'function') return async (options: { maxOutputTokens?: number }) => {
      onCall();
      return value.call(target, options);
    };
    return value;
  } });
}
