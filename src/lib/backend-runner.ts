/**
 * BrainHalf Full-Stack Backend Runner
 * 
 * Provides an Express/FastAPI-compatible request dispatcher, in-memory/SQLite
 * data store, environment variable parser, auto-CRUD routing, auth scaffolding,
 * and distinct error attribution (Backend vs Frontend).
 */

import { transform } from 'sucrase';
import { hashPassword, parsePasswordHash, verifyPassword } from './crypto.ts';

export interface BackendRequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
}

export interface BackendResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
  layer: 'backend';
  error?: string;
  file?: string;
  details?: any;
}

export interface ProjectFiles {
  [path: string]: string;
}

/**
 * Parses a .env file content into key-value pairs.
 */
export function parseEnvFile(envContent: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!envContent) return env;

  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Remove surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

/**
 * Checks for unsupported features (out of scope) and returns a friendly error message if detected.
 */
export function checkUnsupportedBackendFeatures(promptOrConfig: string): { supported: boolean; reason?: string } {
  const lower = promptOrConfig.toLowerCase();

  if (
    lower.includes('multi-region') ||
    lower.includes('multi region') ||
    lower.includes('multiple regions')
  ) {
    return {
      supported: false,
      reason: 'Multi-region deployment is not yet supported. BrainHalf currently deploys to Cloudflare edge global workers with low-latency execution.'
    };
  }

  const unsupportedRuntimes = ['golang', 'go lang', 'rust', 'ruby on rails', 'php', 'c#', '.net', 'elixir'];
  for (const runtime of unsupportedRuntimes) {
    const escapedRuntime = runtime.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|\\W)${escapedRuntime}(?=$|\\W)`).test(lower)) {
      return {
        supported: false,
      reason: `Custom backend runtime "${runtime}" is not yet supported. Preview provides simulated API routes; custom servers need their own runtime.`
      };
    }
  }

  if (
    lower.includes('migration tool') ||
    lower.includes('manual migration') ||
    lower.includes('flyway') ||
    lower.includes('alembic migration')
  ) {
    return {
      supported: false,
      reason: 'Manual database schema migration tools are not yet supported. BrainHalf automatically creates and manages SQLite/in-memory schemas for preview and deployment.'
    };
  }

  return { supported: true };
}

/**
 * In-memory / SQLite table store for preview and edge execution.
 *
 * Bounded in both directions: a generated app with a runaway insert loop would
 * otherwise grow these maps until the Durable Object hit its memory limit,
 * taking the whole project down. The ceilings are generous for any real demo
 * app and the failure is a 507 the app's own UI can show, not a silent OOM.
 */
const MAX_TABLES = 64;
const MAX_ROWS_PER_TABLE = 10_000;

export class InMemoryDataStore {
  private tables: Map<string, Map<string, any>> = new Map();
  private autoIds: Map<string, number> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.tables.clear();
    this.autoIds.clear();
  }

  private getTable(name: string): Map<string, any> {
    const tableKey = name.toLowerCase();
    if (!this.tables.has(tableKey)) {
      if (this.tables.size >= MAX_TABLES) {
        const err: any = new Error(`Too many tables (limit ${MAX_TABLES})`);
        err.status = 507;
        err.code = 'STORE_FULL';
        throw err;
      }
      this.tables.set(tableKey, new Map());
      this.autoIds.set(tableKey, 1);
    }
    return this.tables.get(tableKey)!;
  }

  findAll(table: string): any[] {
    return Array.from(this.getTable(table).values());
  }

  findById(table: string, id: string | number): any | null {
    const item = this.getTable(table).get(String(id));
    return item || null;
  }

  create(table: string, data: any): any {
    const tbl = this.getTable(table);
    const tableKey = table.toLowerCase();

    // A table that has hit the ceiling refuses further inserts. Seeding and
    // reads keep working, so an app at the limit degrades rather than crashing.
    if (tbl.size >= MAX_ROWS_PER_TABLE) {
      const err: any = new Error(`${table} is full (limit ${MAX_ROWS_PER_TABLE} rows)`);
      err.status = 507;
      err.code = 'STORE_FULL';
      throw err;
    }

    // An explicit id that is already taken used to overwrite the existing row
    // silently — a POST that looked like a 201 success while clobbering data.
    // It now fails with a status the caller can surface as 409.
    const id = data.id !== undefined ? data.id : this.nextAutoId(tableKey);
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id).trim() === '' || (typeof id === 'number' && !Number.isSafeInteger(id))) {
      throw Object.assign(new Error('Record id must be a nonempty string or a safe integer'), { status: 400 });
    }
    // A caller-supplied numeric id must still push the auto counter past it,
    // otherwise a later auto id would collide with this row.
    if (typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id))) {
      const asNum = Number(id);
      this.autoIds.set(tableKey, Math.max(this.autoIds.get(tableKey) ?? 1, asNum + 1));
    }
    if (tbl.has(String(id))) {
      const err: any = new Error(`${table} with id ${String(id)} already exists`);
      err.status = 409;
      err.code = 'CONFLICT';
      throw err;
    }

    const record = {
      ...data,
      id,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    tbl.set(String(id), record);
    return record;
  }

  /**
   * Next auto-increment id for a table. The old code did
   * `autoIds.set(key, Number(id) + 1)` on every create, including creates with a
   * non-numeric id — `Number('evt_abc')` is NaN, so `NaN || 0 + 1` reset the
   * counter to 1 and the *next* auto id collided with an existing row. Only a
   * numeric id may advance the counter, and it must never move backwards.
   */
  private nextAutoId(tableKey: string): number {
    const next = this.autoIds.get(tableKey) ?? 1;
    this.autoIds.set(tableKey, next + 1);
    return next;
  }

  update(table: string, id: string | number, data: any): any | null {
    const tbl = this.getTable(table);
    const existing = this.findById(table, id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...data,
      id: existing.id,
      updatedAt: new Date().toISOString()
    };
    tbl.set(String(existing.id), updated);
    return updated;
  }

  delete(table: string, id: string | number): boolean {
    const tbl = this.getTable(table);
    const existing = this.findById(table, id);
    if (!existing) return false;
    return tbl.delete(String(existing.id));
  }

  seed(table: string, items: any[]) {
    for (const item of items) {
      this.create(table, item);
    }
  }
}


/**
 * Removes credentials a generated app has no reason to receive in a response.
 *
 * The auto-CRUD layer answers `GET /api/users` with whatever the row holds, and
 * the row holds a password digest and `GET /api/sessions` holds live tokens. A
 * digest is not a password, but shipping it to the browser is still handing a
 * verifiable offline-guessing target to any script at the preview origin, so it
 * does not leave the store. Login and /auth/me return the fields the app needs
 * and never these.
 */
const SECRET_RESPONSE_FIELDS = ['password', 'token'] as const;

export function stripSecrets<T>(item: T): T {
  if (!item || typeof item !== 'object') return item;
  if (Array.isArray(item)) return item.map(stripSecrets) as unknown as T;
  const copy: Record<string, any> = { ...(item as Record<string, any>) };
  for (const field of SECRET_RESPONSE_FIELDS) delete copy[field];
  return copy as T;
}

/**
 * Validates backend files for syntax and structure errors.
 * Returns error with attribution if broken, or null if healthy.
 */
export function validateBackendFiles(files: ProjectFiles): { error?: string; file?: string } | null {
  const serverFiles = Object.keys(files).filter(isBackendPath);
  
  if (serverFiles.length === 0) {
    // No backend files present - not an error, frontend-only app
    return null;
  }

  for (const filePath of serverFiles) {
    const content = files[filePath];
    if (/\.(?:js|ts|mjs|cjs)$/.test(filePath)) {
      try {
        // Robust syntax check using Sucrase parser (handles ESM imports, exports, TS, and avoids CSP eval)
        transform(content, { transforms: ['typescript', 'imports'] });
      } catch (e: any) {
        return {
          error: `[Backend Error] Syntax error in ${filePath}: ${e.message}`,
          file: filePath
        };
      }
    }
  }

  return null;
}

/**
 * Checks if a project contains full-stack backend files.
 */
export function isFullStackProject(files: ProjectFiles): boolean {
  if (files['/worker/index.ts'] || files['worker/index.ts']) return true;
  return Object.keys(files).some(isBackendPath);
}

function isBackendPath(path: string): boolean {
  return /^\/?server(?:\/|\.(?:js|ts|mjs|cjs)$)/.test(path);
}

function backendError(status: number, message: string): BackendResponse {
  return { status, headers: { 'Content-Type': 'application/json' }, body: { error: message, layer: 'backend' }, layer: 'backend', error: message };
}

/**
 * Simulates executing a backend API request against the project's server structure
 * with automatic CRUD routing and in-memory SQLite store.
 */
export async function executeBackendRequest(
  files: ProjectFiles,
  req: BackendRequestOptions,
  store: InMemoryDataStore
): Promise<BackendResponse> {
  const method = req.method.toUpperCase();
  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname.replace(/^\/(?:preview|p)\/[^/]+/, ''); // normalize
  const searchParams = urlObj.searchParams;

  if (req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body))) {
    return backendError(400, 'Request body must be a JSON object');
  }

  // Handle Health check: /api/health
  if (pathname === '/api/health' && method === 'GET') {
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { status: 'ok', service: 'brainhalf-backend', timestamp: new Date().toISOString() },
      layer: 'backend'
    };
  }

  // Helper to resolve authenticated user and organization from token
  const authHeader = req.headers?.['authorization'] || req.headers?.['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.replace(/^Bearer\s+/, '').trim() : '';
  let currentUser: any = null;
  if (token) {
    const session = store.findAll('sessions').find(s => s.token === token && s.active !== false);
    if (session) {
      const user = store.findById('users', session.userId);
      if (user && user.status !== 'removed') {
        currentUser = { ...user, token, orgId: user.orgId || session.orgId || 1 };
      }
    }
  }

  // --- AUTH ENDPOINTS ---
  // 1. Signup / Register: POST /api/auth/signup or POST /api/auth/register
  if ((pathname === '/api/auth/signup' || pathname === '/api/auth/register') && method === 'POST') {
    const { email, password, username, orgName, name } = req.body || {};
    const identity = email || username;
    const userEmail = typeof identity === 'string' ? identity.toLowerCase().trim() : '';
    if (typeof password !== 'string' || !password.trim()) return backendError(400, 'Password is required');
    if ((orgName !== undefined && typeof orgName !== 'string') || (name !== undefined && typeof name !== 'string')) return backendError(400, 'Name and organization must be strings');
    if (!userEmail) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Email is required', layer: 'backend' },
        layer: 'backend',
        error: 'Email is required'
      };
    }

    // Check for duplicate email across all users
    const existing = store.findAll('users').find(u => (u.email || '').toLowerCase() === userEmail);
    if (existing) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Email already registered', code: 'EMAIL_EXISTS', layer: 'backend' },
        layer: 'backend',
        error: 'Email already registered'
      };
    }

    const passwordDigest = await hashPassword(password);
    if (store.findAll('users').some(u => (u.email || '').toLowerCase() === userEmail)) {
      return backendError(409, 'Email already registered');
    }

    // Create Organization
    const resolvedOrgName = orgName || `${userEmail.split('@')[0]}'s Organization`;
    const org = store.create('organizations', {
      name: resolvedOrgName,
      slug: resolvedOrgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      createdAt: new Date().toISOString()
    });

    // Create Admin User. The digest is what is stored — a plaintext password in
    // this table was readable by the generated app itself through GET /api/users,
    // and by anything that later dumped the store.
    const user = store.create('users', {
      email: userEmail,
      name: name || userEmail.split('@')[0],
      password: passwordDigest,
      orgId: org.id,
      role: 'admin',
      status: 'active',
      createdAt: new Date().toISOString()
    });

    // Generate Session Token
    const sessionToken = 'bh_token_' + crypto.randomUUID();
    store.create('sessions', {
      token: sessionToken,
      userId: user.id,
      orgId: org.id,
      role: 'admin',
      active: true,
      createdAt: new Date().toISOString()
    });

    return {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: {
        success: true,
        token: sessionToken,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: org.id },
        org
      },
      layer: 'backend'
    };
  }

  // 2. Login: POST /api/auth/login
  if (pathname === '/api/auth/login' && method === 'POST') {
    const { email, password, username } = req.body || {};
    const identity = email || username;
    const userEmail = typeof identity === 'string' ? identity.toLowerCase().trim() : '';
    if (!userEmail) return backendError(400, 'Email is required');
    if (typeof password !== 'string' || !password.trim()) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Password is required', layer: 'backend' },
        layer: 'backend',
        error: 'Password is required'
      };
    }

    // Lookup user in store
    const user = store.findAll('users').find(u => (u.email || '').toLowerCase() === userEmail && u.status !== 'removed');
    let org: any = null;

    if (!user) {
      return backendError(401, 'Invalid email or password');
    } else {
      // The password used to be ignored here: any password logged any existing
      // account in. A row from before digests existed still compares directly and
      // is upgraded in place, so an in-flight demo keeps working.
      const stored = String(user.password ?? '');
      const isDigest = parsePasswordHash(stored) !== null;
      const ok = isDigest ? await verifyPassword(password, stored) : stored === password;
      if (!ok) {
        return {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'Invalid email or password', layer: 'backend' },
          layer: 'backend',
          error: 'Invalid email or password'
        };
      }
      if (!isDigest) {
        store.update('users', user.id, { password: await hashPassword(password) });
      }
      org = store.findById('organizations', user.orgId);
    }

    const sessionToken = 'bh_token_' + crypto.randomUUID();
    store.create('sessions', {
      token: sessionToken,
      userId: user.id,
      orgId: user.orgId,
      role: user.role,
      active: true,
      createdAt: new Date().toISOString()
    });

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        success: true,
        token: sessionToken,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId },
        org: org || { id: user.orgId, name: 'Default Org' }
      },
      layer: 'backend'
    };
  }

  // 3. Logout: POST /api/auth/logout
  if (pathname === '/api/auth/logout' && method === 'POST') {
    if (token) {
      const sessions = store.findAll('sessions').filter(s => s.token === token);
      for (const s of sessions) {
        store.update('sessions', s.id, { active: false });
      }
    }
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { success: true, message: 'Logged out successfully' },
      layer: 'backend'
    };
  }

  // 4. Current User Profile / Session: GET /api/auth/me or GET /api/auth/session
  if ((pathname === '/api/auth/me' || pathname === '/api/auth/session') && method === 'GET') {
    if (!currentUser) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Unauthorized: Session invalid or expired', layer: 'backend' },
        layer: 'backend',
        error: 'Unauthorized'
      };
    }
    const org = store.findById('organizations', currentUser.orgId);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        id: currentUser.id,
        email: currentUser.email,
        name: currentUser.name,
        role: currentUser.role,
        orgId: currentUser.orgId,
        user: { id: currentUser.id, email: currentUser.email, name: currentUser.name, role: currentUser.role, orgId: currentUser.orgId },
        org
      },
      layer: 'backend'
    };
  }

  // --- MULTI-TENANT ORG MANAGEMENT ENDPOINTS ---
  // 5. Org Members List: GET /api/org/members
  if (pathname === '/api/org/members' && method === 'GET') {
    if (!currentUser) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Unauthorized', layer: 'backend' },
        layer: 'backend',
        error: 'Unauthorized'
      };
    }
    const members = store.findAll('users')
      .filter(u => u.orgId === currentUser.orgId && u.status !== 'removed')
      .map(({ password: _password, ...m }) => m);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: members,
      layer: 'backend'
    };
  }

  // 6. Invite Member: POST /api/org/invite
  if (pathname === '/api/org/invite' && method === 'POST') {
    if (!currentUser) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Unauthorized', layer: 'backend' },
        layer: 'backend',
        error: 'Unauthorized'
      };
    }
    if (currentUser.role !== 'admin') {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Forbidden: Only administrators can invite members', layer: 'backend' },
        layer: 'backend',
        error: 'Forbidden'
      };
    }
    const { email, role } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Email is required', layer: 'backend' },
        layer: 'backend',
        error: 'Email is required'
      };
    }
    const invited = store.create('users', {
      email,
      name: email.split('@')[0],
      orgId: currentUser.orgId,
      role: role || 'member',
      status: 'active',
      createdAt: new Date().toISOString()
    });
    const { password: _password, ...safeInvited } = invited;
    return {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: { success: true, member: safeInvited },
      layer: 'backend'
    };
  }

  // 7. Remove Member: DELETE /api/org/members/:id
  const memberDeleteMatch = pathname.match(/^\/api\/org\/members\/([a-zA-Z0-9_-]+)$/);
  if (memberDeleteMatch && method === 'DELETE') {
    if (!currentUser) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Unauthorized', layer: 'backend' },
        layer: 'backend',
        error: 'Unauthorized'
      };
    }
    if (currentUser.role !== 'admin') {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Forbidden: Only administrators can remove members', layer: 'backend' },
        layer: 'backend',
        error: 'Forbidden'
      };
    }
    const memberId = memberDeleteMatch[1];
    const targetUser = store.findById('users', memberId);
    if (!targetUser || targetUser.orgId !== currentUser.orgId) {
      return {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Member not found in this organization', layer: 'backend' },
        layer: 'backend',
        error: 'Not Found'
      };
    }

    // Mark user removed and revoke active sessions
    store.update('users', memberId, { status: 'removed' });
    const targetSessions = store.findAll('sessions').filter(s => String(s.userId) === String(memberId));
    for (const s of targetSessions) {
      store.update('sessions', s.id, { active: false });
    }

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { success: true, message: 'Member removed successfully' },
      layer: 'backend'
    };
  }

  // --- MULTI-TENANT SERVER-SIDE ANALYTICS ENDPOINT ---
  // 8. Server-Side Aggregation: GET /api/analytics
  if (pathname === '/api/analytics' && method === 'GET') {
    if (!currentUser) {
      return {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Unauthorized: Authentication required', layer: 'backend' },
        layer: 'backend',
        error: 'Unauthorized'
      };
    }

    // Cross-tenant protection: check if caller attempted to access a different org
    const requestedOrg = searchParams.get('orgId') || searchParams.get('org_id');
    if (requestedOrg && String(requestedOrg) !== String(currentUser.orgId)) {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Forbidden: Cross-tenant data access denied', layer: 'backend' },
        layer: 'backend',
        error: 'Forbidden'
      };
    }

    // Query events scoped strictly to user's org
    let events = store.findAll('events').filter(e => e.orgId === currentUser.orgId);

    // Filter by date range (startDate, endDate)
    const startDate = searchParams.get('startDate') || searchParams.get('start_date');
    const endDate = searchParams.get('endDate') || searchParams.get('end_date');
    if (startDate) {
      events = events.filter(e => new Date(e.timestamp || e.createdAt) >= new Date(startDate));
    }
    if (endDate) {
      events = events.filter(e => new Date(e.timestamp || e.createdAt) <= new Date(endDate));
    }

    // Filter by category
    const categoryFilter = searchParams.get('category');
    if (categoryFilter && categoryFilter !== 'all') {
      events = events.filter(e => (e.category || '').toLowerCase() === categoryFilter.toLowerCase());
    }

    // Compute server-side aggregations
    const totalEvents = events.length;
    const totalValue = events.reduce((sum, e) => sum + (Number(e.value) || 0), 0);
    const activeMembers = store.findAll('users').filter(u => u.orgId === currentUser.orgId && u.status !== 'removed').length;

    // Daily totals aggregation: { date: 'YYYY-MM-DD', count: number, totalValue: number }
    const dailyMap = new Map<string, { count: number; totalValue: number }>();
    for (const ev of events) {
      const d = (ev.timestamp || ev.createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const cur = dailyMap.get(d) || { count: 0, totalValue: 0 };
      cur.count += 1;
      cur.totalValue += Number(ev.value) || 0;
      dailyMap.set(d, cur);
    }
    const dailyTotals = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, count: data.count, totalValue: Math.round(data.totalValue * 100) / 100 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Category breakdown aggregation: { category: string, count: number, totalValue: number }
    const catMap = new Map<string, { count: number; totalValue: number }>();
    for (const ev of events) {
      const cat = ev.category || 'Uncategorized';
      const cur = catMap.get(cat) || { count: 0, totalValue: 0 };
      cur.count += 1;
      cur.totalValue += Number(ev.value) || 0;
      catMap.set(cat, cur);
    }
    const categoryBreakdown = Array.from(catMap.entries())
      .map(([category, data]) => ({ category, count: data.count, totalValue: Math.round(data.totalValue * 100) / 100 }))
      .sort((a, b) => b.totalValue - a.totalValue);

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        kpis: {
          totalEvents,
          totalValue: Math.round(totalValue * 100) / 100,
          activeMembers
        },
        dailyTotals,
        categoryBreakdown,
        filters: { startDate, endDate, category: categoryFilter }
      },
      layer: 'backend'
    };
  }

  // Handle Generic Resource CRUD: /api/:resource or /api/:resource/:id
  const apiMatch = pathname.match(/^\/api\/([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?$/);
  if (apiMatch) {
    const resource = apiMatch[1].toLowerCase();
    const resourceId = apiMatch[2];
    if (resource === 'sessions') return backendError(403, 'Sessions are managed through authentication endpoints');

    // Enforce authentication if Bearer header is supplied (preventing use of revoked/invalid tokens)
    // or if accessing secured multi-tenant resources like events
    if ((authHeader && authHeader.startsWith('Bearer ')) || resource === 'events') {
      if (!currentUser) {
        return {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'Unauthorized: Missing, invalid, or expired session token', layer: 'backend' },
          layer: 'backend',
          error: 'Unauthorized'
        };
      }
    }

    try {
      if (!resourceId) {
        // Collection operations: GET /api/:resource or POST /api/:resource
        if (method === 'GET') {
          let items = store.findAll(resource);

          // Tenancy scoping: if authenticated user exists, filter records matching user's orgId
          if (currentUser && (resource === 'events' || items.some(i => i.orgId !== undefined))) {
            items = items.filter(item => item.orgId === currentUser.orgId);
          }

          // Date range filtering
          const startDate = searchParams.get('startDate') || searchParams.get('start_date');
          const endDate = searchParams.get('endDate') || searchParams.get('end_date');
          if (startDate) {
            items = items.filter(item => new Date(item.timestamp || item.createdAt) >= new Date(startDate));
          }
          if (endDate) {
            items = items.filter(item => new Date(item.timestamp || item.createdAt) <= new Date(endDate));
          }

          // Category filtering
          const categoryFilter = searchParams.get('category');
          if (categoryFilter && categoryFilter !== 'all') {
            items = items.filter(item => (item.category || '').toLowerCase() === categoryFilter.toLowerCase());
          }

          // Filter by other query parameters if provided
          const queryEntries = Array.from(searchParams.entries()).filter(([k]) =>
            !['page', 'limit', 'startDate', 'endDate', 'start_date', 'end_date', 'category'].includes(k)
          );
          if (queryEntries.length > 0) {
            items = items.filter(item => {
              return queryEntries.every(([k, v]) => String(item[k]).toLowerCase() === v.toLowerCase());
            });
          }

          // Sort newest first
          items.sort((a, b) => new Date(b.timestamp || b.createdAt).getTime() - new Date(a.timestamp || a.createdAt).getTime());

          // Pagination support
          const hasPagination = searchParams.has('page') || searchParams.has('limit');
          const total = items.length;
          const page = Number(searchParams.get('page') ?? '1');
          const limit = Number(searchParams.get('limit') ?? '10');
          if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ROWS_PER_TABLE) {
            return backendError(400, `Page and limit must be positive integers; limit cannot exceed ${MAX_ROWS_PER_TABLE}`);
          }
          const totalPages = Math.ceil(total / limit) || 1;
          const paginatedItems = hasPagination ? items.slice((page - 1) * limit, page * limit) : items;

          // For frontend compatibility, provide structured object if pagination is requested
          const responseBody = hasPagination
            ? { [resource]: paginatedItems.map(stripSecrets), items: paginatedItems.map(stripSecrets), total, page, limit, totalPages }
            : paginatedItems.map(stripSecrets);

          return {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Total-Count': String(total),
              'X-Page': String(page),
              'X-Total-Pages': String(totalPages)
            },
            body: responseBody,
            layer: 'backend'
          };
        }

        // Special handler: POST /api/upload
        if (resource === 'upload' && method === 'POST') {
          const { filename, contentType } = req.body || {};
          const isDangerous = /\.(html|htm|js|mjs|svg|sh|bat|exe)$/i.test(filename || '') ||
            /^(text\/html|application\/javascript|image\/svg\+xml)/i.test(contentType || '');
          if (isDangerous) {
            return {
              status: 415,
              headers: { 'Content-Type': 'application/json' },
              body: { error: 'Unsupported or executable file type rejected', layer: 'backend' },
              layer: 'backend',
              error: 'Unsupported Media Type'
            };
          }
          return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: { success: true, filename },
            layer: 'backend'
          };
        }

        if (method === 'POST') {
          if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
            return {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
              body: { error: 'Malformed or empty request body', layer: 'backend' },
              layer: 'backend',
              error: 'Bad Request'
            };
          }

          const bodyData = { ...req.body };
          if (currentUser && bodyData.orgId !== undefined && bodyData.orgId !== currentUser.orgId) {
            return backendError(403, 'Forbidden: Cross-tenant creation denied');
          }
          if (currentUser) {
            bodyData.orgId = currentUser.orgId;
          }

          // Atomic inventory management for e-commerce orders
          let orderedProduct: any = null;
          let orderedQuantity = 0;
          if (resource === 'orders') {
            const { productId, quantity = 1 } = bodyData;
            if (!Number.isSafeInteger(quantity) || quantity < 1) return backendError(400, 'Quantity must be a positive integer');
            if (productId !== undefined) {
              const product = store.findById('products', productId);
              if (currentUser && product?.orgId !== undefined && product.orgId !== currentUser.orgId) return backendError(403, 'Forbidden: Cross-tenant product access denied');
              if (!product || (product.stock !== undefined && product.stock < quantity)) {
                return {
                  status: 400,
                  headers: { 'Content-Type': 'application/json' },
                  body: { error: 'Out of stock or invalid product', layer: 'backend' },
                  layer: 'backend',
                  error: 'Out of Stock'
                };
              }
              orderedProduct = product;
              orderedQuantity = quantity;
            }
          }

          const created = store.create(resource, bodyData);
          if (orderedProduct?.stock !== undefined) {
            store.update('products', orderedProduct.id, { stock: orderedProduct.stock - orderedQuantity });
          }
          return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: stripSecrets(created),
            layer: 'backend'
          };
        }
      } else {
        // Special sub-resource: POST /api/forms/submit
        if (resource === 'forms' && resourceId === 'submit' && method === 'POST') {
          const bodyData = { ...(req.body || {}), submittedAt: new Date().toISOString() };
          const created = store.create('form_responses', bodyData);
          return {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
            body: { success: true, responseId: created.id, data: created },
            layer: 'backend'
          };
        }

        // Individual item operations: GET, PUT, PATCH, DELETE /api/:resource/:id
        if (method === 'GET') {
          const item = store.findById(resource, resourceId);
          if (!item) {
            return {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
              body: { error: `${resource} with id "${resourceId}" not found`, layer: 'backend' },
              layer: 'backend',
              error: 'Not Found'
            };
          }
          if (currentUser && item.orgId && item.orgId !== currentUser.orgId) {
            return {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
              body: { error: 'Forbidden: Cross-tenant data access denied', layer: 'backend' },
              layer: 'backend',
              error: 'Forbidden'
            };
          }
          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: stripSecrets(item),
            layer: 'backend'
          };
        }

        if (method === 'PUT' || method === 'PATCH') {
          if (currentUser && req.body?.orgId !== undefined && req.body.orgId !== currentUser.orgId) return backendError(403, 'Forbidden: Cross-tenant update denied');
          const existing = store.findById(resource, resourceId);
          if (!existing) {
            return {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
              body: { error: `Cannot update: ${resource} with id "${resourceId}" not found`, layer: 'backend' },
              layer: 'backend',
              error: 'Not Found'
            };
          }
          if (currentUser && existing.orgId && existing.orgId !== currentUser.orgId) {
            return {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
              body: { error: 'Forbidden: Cross-tenant update denied', layer: 'backend' },
              layer: 'backend',
              error: 'Forbidden'
            };
          }
          const updated = store.update(resource, resourceId, req.body || {});
          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: stripSecrets(updated),
            layer: 'backend'
          };
        }

        if (method === 'DELETE') {
          const existing = store.findById(resource, resourceId);
          if (!existing) {
            return {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
              body: { error: `Cannot delete: ${resource} with id "${resourceId}" not found`, layer: 'backend' },
              layer: 'backend',
              error: 'Not Found'
            };
          }
          if (currentUser && existing.orgId && existing.orgId !== currentUser.orgId) {
            return {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
              body: { error: 'Forbidden: Cross-tenant deletion denied', layer: 'backend' },
              layer: 'backend',
              error: 'Forbidden'
            };
          }
          store.delete(resource, resourceId);
          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { success: true, message: `${resource} ${resourceId} deleted successfully` },
            layer: 'backend'
          };
        }
      }
    } catch (dbErr: any) {
      // The store throws errors carrying their own HTTP status (e.g. 409 for a
      // duplicate id). Fall back to 500 only when it does not.
      const status = typeof dbErr.status === 'number' ? dbErr.status : 500;
      return {
        status,
        headers: { 'Content-Type': 'application/json' },
        body: { error: dbErr.message, layer: 'backend' },
        layer: 'backend',
        error: dbErr.message
      };
    }
  }

  // If no route matches:
  return {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
    body: {
      error: `[Backend Error] Route not found: ${method} ${pathname}`,
      layer: 'backend',
      message: `The server does not have an endpoint configured for ${method} ${pathname}. Please check /server/routes/ or auto-generated endpoints.`
    },
    layer: 'backend',
    error: `[Backend Error] Route not found: ${method} ${pathname}`
  };
}
