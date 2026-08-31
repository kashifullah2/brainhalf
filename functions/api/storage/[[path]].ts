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

  // Passing the request headers lets R2 evaluate If-None-Match / If-Modified-Since
  // itself. When the client's copy is current it returns the object without a
  // body and we answer 304 instead of streaming the page image again — these are
  // the largest responses the app serves, and the batch list requests one per row.
  const object = await env.DOCUMENTS.get(objectPath, { onlyIf: request.headers });
  if (!object) return fail('Not found.', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Private: the response is user-specific, so no shared cache may keep it.
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  // These are user-supplied files; never let one execute in our origin.
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");

  // No body means the precondition matched.
  const body = 'body' in object ? object.body : null;
  if (!body) return new Response(null, { status: 304, headers });

  return new Response(body, { headers });
};
