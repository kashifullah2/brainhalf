import { fail, type AppEnv } from '../../../server/http';
import { requireSession } from '../../../server/guard';

/**
 * Serves an uploaded document back to its owner — thumbnails on the batch list
 * and the page image in the document viewer.
 *
 * Ownership is enforced twice: the key must sit under the caller's user-id
 * prefix, AND a documents row must link that key to the caller. Either check
 * alone would be enough; both is cheap.
 */
export const onRequestGet: PagesFunction<AppEnv> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const objectPath = segments.filter(Boolean).join('/');

  if (!objectPath) return fail('No object path given.', 400);
  // Reject traversal outright rather than relying on R2 key normalisation.
  if (objectPath.includes('..')) return fail('Invalid object path.', 400);

  if (!objectPath.startsWith(`${auth.user.id}/`)) {
    // Same 404 as a genuinely missing object: never confirm that someone else's
    // key exists.
    return fail('Not found.', 404);
  }

  const owned = await env.DB.prepare(
    `SELECT 1 AS hit FROM documents WHERE user_id = ? AND object_path = ? LIMIT 1`,
  )
    .bind(auth.user.id, objectPath)
    .first<{ hit: number }>();

  if (!owned) return fail('Not found.', 404);

  const object = await env.DOCUMENTS.get(objectPath);
  if (!object) return fail('Not found.', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Private: the response is user-specific, so no shared cache may keep it.
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  // These are user-supplied files; never let one execute in our origin.
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

  return new Response(object.body, { headers });
};
