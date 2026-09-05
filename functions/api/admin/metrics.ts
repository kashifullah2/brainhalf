import { json, type AppEnv } from '../../../server/http';
import { authHeaders } from '../../../server/guard';
import { requireAdmin } from '../../../server/admin';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../../../server/threshold';
import { STUCK_AFTER_MINUTES } from '../../../server/stuck-documents';

/**
 * Real platform metrics for the admin console.
 *
 * The console used to render invented ones: a hardcoded 1,428 documents
 * processed, "99.2%" accuracy, a four-row "Recent Platform Activity Stream" of
 * document ids that never existed, and a "Credentials & Secrets" panel printing
 * the first five and last three characters of the AWS access key and secret.
 * None of it came from the system, and the credential fragments were a genuine
 * disclosure to whoever could reach the page -- which, before server/admin.ts,
 * was anybody who signed up with the right first name.
 *
 * Everything below is counted in the database at request time. Provider
 * configuration is reported as presence only: never a value, never a fragment of
 * one.
 */
export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env);
  if (auth instanceof Response) return auth;

  const [users, documents, batches, recent, confidence, stuck] = await env.DB.batch<
    Record<string, number | null>
  >([
    env.DB.prepare(`SELECT COUNT(*) AS total FROM users`),
    env.DB.prepare(
      `SELECT COUNT(*)                              AS total,
              COALESCE(SUM(status = 'queued'), 0)     AS queued,
              COALESCE(SUM(status = 'processing'), 0) AS processing,
              COALESCE(SUM(status = 'completed'), 0)  AS completed,
              COALESCE(SUM(status = 'failed'), 0)     AS failed
         FROM documents`,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM batches`),
    env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM documents
        WHERE completed_at IS NOT NULL
          AND completed_at >= datetime('now', '-1 day')`,
    ),
    env.DB.prepare(
      `SELECT AVG(overall_confidence) AS mean,
              COALESCE(SUM(overall_confidence < ?), 0) AS below_threshold
         FROM documents
        WHERE status = 'completed' AND overall_confidence IS NOT NULL`,
    ).bind(DEFAULT_CONFIDENCE_THRESHOLD),
    env.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM documents
        WHERE status = 'processing'
          AND created_at < datetime('now', ?)`,
    ).bind(`-${STUCK_AFTER_MINUTES} minutes`),
  ]);

  const first = <T>(result: { results?: T[] }): T | undefined => (result.results ?? [])[0];
  const documentCounts = first(documents) ?? {};
  const confidenceRow = first(confidence) ?? {};

  const completed = Number(documentCounts.completed ?? 0);
  const failed = Number(documentCounts.failed ?? 0);
  const finished = completed + failed;

  return json(
    {
      counts: {
        users: Number(first(users)?.total ?? 0),
        batches: Number(first(batches)?.total ?? 0),
        documents: Number(documentCounts.total ?? 0),
        queued: Number(documentCounts.queued ?? 0),
        processing: Number(documentCounts.processing ?? 0),
        completed,
        failed,
        completedLastDay: Number(first(recent)?.total ?? 0),
        stuck: Number(first(stuck)?.total ?? 0),
      },
      quality: {
        /** Null until at least one document has been scored. */
        meanConfidence:
          confidenceRow.mean === null || confidenceRow.mean === undefined
            ? null
            : Number(Number(confidenceRow.mean).toFixed(4)),
        belowThreshold: Number(confidenceRow.below_threshold ?? 0),
        threshold: DEFAULT_CONFIDENCE_THRESHOLD,
        /** Null rather than 100% when nothing has finished yet. */
        successRate: finished === 0 ? null : Number((completed / finished).toFixed(4)),
      },
      // Presence, never values. A configured provider is reported as `true` and
      // nothing more -- not a prefix, not a suffix, not a length.
      providers: {
        defaultTier: env.HUNYUAN_API_KEY
          ? 'hunyuan'
          : env.OPENAI_API_KEY || env.OCR_API_KEY
            ? 'openai'
            : null,
        escalationTier: env.OPENAI_API_KEY || env.OCR_API_KEY ? 'openai' : null,
        awsConfigured: Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
        awsRegion: env.AWS_REGION || null,
        bedrockModel: env.AWS_BEDROCK_MODEL || null,
        googleSignIn: Boolean(env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID),
        transactionalEmail: Boolean(env.RESEND_API_KEY),
      },
      bindings: {
        database: Boolean(env.DB),
        storage: Boolean(env.DOCUMENTS),
        /** False means batches are extracted in the browser, not by the worker. */
        queue: Boolean(env.OCR_QUEUE),
      },
      generatedAt: new Date().toISOString(),
    },
    200,
    authHeaders(auth),
  );
};
