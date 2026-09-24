/** First-party outcome counts. Never accepts prompts, code, emails or credentials. */
export type OutcomeKind = 'generation_started' | 'generation_completed' | 'generation_failed' | 'verification_passed' | 'publish_started' | 'publish_passed' | 'publish_failed';
export interface OutcomeEvent { id: string; ownerId: string; projectId: string; kind: OutcomeKind; at: number; revision?: string }
type Storage = { sql: { exec(query: string, ...values: any[]): { toArray(): any[] } } };
const kinds: OutcomeKind[] = ['generation_started', 'generation_completed', 'generation_failed', 'verification_passed', 'publish_started', 'publish_passed', 'publish_failed'];
const day = 86_400_000;
export class ProductOutcomes {
  constructor(private storage: Storage) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS product_outcomes (id TEXT NOT NULL, owner_id TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, revision TEXT, PRIMARY KEY(owner_id,project_id,id,kind))');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS outcomes_owner_time ON product_outcomes(owner_id,at)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS outcomes_revision ON product_outcomes(owner_id,project_id,revision,kind,at)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS outcomes_kind ON product_outcomes(kind,owner_id,at)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS product_cohorts (owner_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, returned_week_one INTEGER NOT NULL DEFAULT 0)');
  }
  activity(ownerId: string, now = Date.now()) {
    this.storage.sql.exec('INSERT OR IGNORE INTO product_cohorts(owner_id,started_at) VALUES (?,?)', ownerId, now);
    this.storage.sql.exec('UPDATE product_cohorts SET returned_week_one=1 WHERE owner_id=? AND ? >= started_at+? AND ? < started_at+?', ownerId, now, 7 * day, now, 14 * day);
  }
  record(event: OutcomeEvent, now = Date.now()) {
    if (!event || ![event.id, event.ownerId, event.projectId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) || !kinds.includes(event.kind) || !Number.isSafeInteger(event.at) || event.at <= 0 || event.at > now + 60_000 || (event.revision !== undefined && !/^[a-f0-9]{64}$/.test(event.revision))) throw new Error('Invalid product outcome');
    this.storage.sql.exec('INSERT OR IGNORE INTO product_outcomes(id,owner_id,project_id,kind,at,revision) VALUES (?,?,?,?,?,?)', event.id, event.ownerId, event.projectId, event.kind, event.at, event.revision || null);
    if (event.kind === 'generation_started') this.activity(event.ownerId, event.at);
  }
  report(ownerId?: string, now = Date.now()) {
    const sql = this.storage.sql;
    const scope = ownerId ? ' AND o.owner_id=?' : '';
    const params = ownerId ? [ownerId] : [];
    const count = (kind: OutcomeKind) => Number(sql.exec(`SELECT COUNT(*) AS n FROM product_outcomes o WHERE kind=?${scope}`, kind, ...params).toArray()[0].n);
    const generations = count('generation_started');
    // Join exact revisions, not merely a successful model response or a different release.
    const working = Number(sql.exec(`SELECT COUNT(*) AS n FROM product_outcomes o WHERE o.kind='generation_completed'${scope} AND EXISTS (SELECT 1 FROM product_outcomes v WHERE v.owner_id=o.owner_id AND v.project_id=o.project_id AND v.revision=o.revision AND v.kind='verification_passed' AND v.at>=o.at) AND EXISTS (SELECT 1 FROM product_outcomes s WHERE s.owner_id=o.owner_id AND s.project_id=o.project_id AND s.id=o.id AND s.kind='generation_started')`, ...params).toArray()[0].n);
    const published = count('publish_passed'); const attempts = count('publish_started');
    const firstLive = sql.exec(`SELECT MIN(o.at)-c.started_at AS ms FROM product_cohorts c JOIN product_outcomes o ON o.owner_id=c.owner_id AND o.kind='publish_passed' WHERE o.at>=c.started_at${scope} GROUP BY c.owner_id ORDER BY ms`, ...params).toArray().map(row => Number(row.ms));
    const mature = sql.exec(`SELECT COUNT(*) AS n,COALESCE(SUM(returned_week_one),0) AS returned FROM product_cohorts WHERE started_at<=?${ownerId ? ' AND owner_id=?' : ''}`, now - 14 * day, ...params).toArray()[0];
    const middle = Math.floor(firstLive.length / 2);
    return {
      measuredAt: now, generations, completedGenerations: count('generation_completed'), verifiedWorkingGenerations: working,
      workingAppsPerGeneration: generations ? working / generations : null,
      publishAttempts: attempts, published, failedPublishes: count('publish_failed'), publishingSuccessRate: attempts ? published / attempts : null,
      medianTimeToFirstLiveMs: firstLive.length ? (firstLive[middle] + firstLive[Math.floor((firstLive.length - 1) / 2)]) / 2 : null, firstLiveAccounts: firstLive.length,
      matureWeekOneAccounts: Number(mature.n), returnedWeekOneAccounts: Number(mature.returned), weekOneRetention: mature.n ? Number(mature.returned) / Number(mature.n) : null,
    };
  }
}

export async function recordProductOutcome(env: any, event: OutcomeEvent) {
  try {
    const response = await env.REGISTRY.get(env.REGISTRY.idFromName('auth')).fetch('https://registry/outcomes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Outcome storage unavailable');
    return true;
  } catch { return false; }
}
