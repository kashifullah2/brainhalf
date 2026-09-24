export const REQUEST_MONITOR_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS app_request_metrics (day TEXT NOT NULL, environment TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, total_ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,environment))',
  'CREATE TABLE IF NOT EXISTS app_request_events (id INTEGER PRIMARY KEY AUTOINCREMENT, environment TEXT NOT NULL, method TEXT NOT NULL, route TEXT NOT NULL, status INTEGER NOT NULL, duration_ms INTEGER NOT NULL, created_at INTEGER NOT NULL)',
];

/** Only known route groups are retained; no user IDs, arbitrary paths, queries or headers. */
export function monitoredRoute(pathname: string): string {
  if (/^\/api\/auth(?:\/|$)/.test(pathname)) return '/api/auth/*';
  if (pathname === '/api/contact') return '/api/contact';
  if (pathname === '/api/health') return '/api/health';
  if (/^\/api\/uploads(?:\/|$)/.test(pathname)) return '/api/uploads/*';
  if (pathname.startsWith('/api/')) return '/api/*';
  if (pathname.startsWith('/__brainhalf/')) return '/__brainhalf/*';
  return 'page / asset';
}

export function recordAppRequest(sql: { exec: (query: string, ...params: (string | number)[]) => unknown }, environment: string, request: Request, status: number, startedAt: number) {
  const now = Date.now(); const day = new Date(now).toISOString().slice(0, 10); const duration = Math.max(0, now - startedAt);
  sql.exec('INSERT INTO app_request_metrics(day,environment,requests,errors,total_ms) VALUES (?,?,1,?,?) ON CONFLICT(day,environment) DO UPDATE SET requests=requests+1,errors=errors+excluded.errors,total_ms=total_ms+excluded.total_ms', day, environment, status >= 500 ? 1 : 0, duration);
  sql.exec('INSERT INTO app_request_events(environment,method,route,status,duration_ms,created_at) VALUES (?,?,?,?,?,?)', environment, request.method.slice(0, 12), monitoredRoute(new URL(request.url).pathname), status, duration, now);
  sql.exec('DELETE FROM app_request_events WHERE id NOT IN (SELECT id FROM app_request_events ORDER BY id DESC LIMIT 200)');
  sql.exec('DELETE FROM app_request_metrics WHERE day < ?', new Date(now - 7 * 86400_000).toISOString().slice(0, 10));
}
