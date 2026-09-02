import { fail, json, readJson, type AppEnv } from '../../server/http';
import { authHeaders, requireSession } from '../../server/guard';

import { DEFAULT_CONFIDENCE_THRESHOLD } from '../../server/threshold';
const MIN_THRESHOLD = 0.5;
const MAX_THRESHOLD = 0.95;

interface Body {
  confidenceThreshold?: unknown;
}

/**
 * Per-user preferences. Previously in localforage, so the review-queue threshold
 * silently differed between a user's laptop and phone.
 */
export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const row = await env.DB.prepare(
    `SELECT confidence_threshold FROM user_settings WHERE user_id = ?`,
  )
    .bind(auth.user.id)
    .first<{ confidence_threshold: number }>();

  return json(
    { confidenceThreshold: row?.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD },
    200,
    authHeaders(auth),
  );
};

export const onRequestPatch: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const body = await readJson<Body>(request);
  const value = body?.confidenceThreshold;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('confidenceThreshold must be a number.', 400);
  }
  if (value < MIN_THRESHOLD || value > MAX_THRESHOLD) {
    return fail(
      `confidenceThreshold must be between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}.`,
      400,
    );
  }

  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, confidence_threshold)
     VALUES (?, ?)
     ON CONFLICT (user_id)
       DO UPDATE SET confidence_threshold = excluded.confidence_threshold,
                     updated_at = datetime('now')`,
  )
    .bind(auth.user.id, value)
    .run();

  return json({ confidenceThreshold: value }, 200, authHeaders(auth));
};
