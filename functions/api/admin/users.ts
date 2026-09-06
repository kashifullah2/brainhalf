import { json, fail, type AppEnv } from '../../../server/http';
import { requireAdmin, isAdminEmail } from '../../../server/admin';

export interface UserSummaryRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  picture_url: string | null;
  google_sub: string | null;
  email_verified: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  total_batches: number;
  total_documents: number;
}

export interface UsersMetricsRow {
  total_users: number;
  verified_users: number;
  google_users: number;
  password_users: number;
  active_7d: number;
}

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim().toLowerCase() || '';
  const filter = url.searchParams.get('filter')?.trim().toLowerCase() || 'all';
  const limitParam = parseInt(url.searchParams.get('limit') || '200', 10);
  const limit = Math.max(1, Math.min(limitParam || 200, 500));

  try {
    // 1. Overall user metrics summary
    const summaryStmt = env.DB.prepare(`
      SELECT
        COUNT(*) AS total_users,
        COALESCE(SUM(email_verified = 1), 0) AS verified_users,
        COALESCE(SUM(google_sub IS NOT NULL), 0) AS google_users,
        COALESCE(SUM(google_sub IS NULL), 0) AS password_users,
        COALESCE(SUM(last_login_at >= datetime('now', '-7 days')), 0) AS active_7d
      FROM users
    `);

    // 2. Build filtered query for user list
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (q) {
      conditions.push(`(LOWER(u.email) LIKE ? OR LOWER(u.first_name) LIKE ? OR LOWER(u.last_name) LIKE ?)`);
      const term = `%${q}%`;
      bindings.push(term, term, term);
    }

    if (filter === 'google') {
      conditions.push(`u.google_sub IS NOT NULL`);
    } else if (filter === 'password') {
      conditions.push(`u.google_sub IS NULL`);
    } else if (filter === 'verified') {
      conditions.push(`u.email_verified = 1`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const usersSql = `
      SELECT
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.picture_url,
        u.google_sub,
        u.email_verified,
        u.created_at,
        u.updated_at,
        u.last_login_at,
        COALESCE(b.batch_count, 0) AS total_batches,
        COALESCE(d.doc_count, 0) AS total_documents
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS batch_count FROM batches GROUP BY user_id
      ) b ON b.user_id = u.id
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS doc_count FROM documents GROUP BY user_id
      ) d ON d.user_id = u.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT ?
    `;

    bindings.push(limit);

    const [summaryResult, usersResult] = await env.DB.batch<Record<string, unknown>>([
      summaryStmt,
      env.DB.prepare(usersSql).bind(...bindings),
    ]);

    const summaryRow = (summaryResult.results?.[0] || {}) as unknown as UsersMetricsRow;
    const rawUsers = (usersResult.results || []) as unknown as UserSummaryRow[];

    // Map rows with helper fields
    let users = rawUsers.map((u) => {
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Anonymous';
      const isAdmin = isAdminEmail(env, u.email);
      const authProvider = u.google_sub ? ('google' as const) : ('password' as const);

      return {
        id: u.id,
        email: u.email,
        firstName: u.first_name || '',
        lastName: u.last_name || '',
        fullName,
        pictureUrl: u.picture_url,
        authProvider,
        emailVerified: Boolean(u.email_verified),
        createdAt: u.created_at,
        updatedAt: u.updated_at,
        lastLoginAt: u.last_login_at,
        totalBatches: Number(u.total_batches || 0),
        totalDocuments: Number(u.total_documents || 0),
        isAdmin,
      };
    });

    if (filter === 'admins') {
      users = users.filter((u) => u.isAdmin);
    }

    return json({
      summary: {
        totalUsers: Number(summaryRow.total_users || 0),
        verifiedUsers: Number(summaryRow.verified_users || 0),
        googleUsers: Number(summaryRow.google_users || 0),
        passwordUsers: Number(summaryRow.password_users || 0),
        active7d: Number(summaryRow.active_7d || 0),
      },
      users,
      count: users.length,
    });
  } catch (error) {
    console.error('[admin/users] query failed:', error);
    return fail('Could not load user data.', 500);
  }
};
