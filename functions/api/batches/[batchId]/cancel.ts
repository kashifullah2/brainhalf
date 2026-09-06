import { fail, json, type AppEnv } from '../../../../server/http';
import { authHeaders, intParam, requireSession } from '../../../../server/guard';
import { cancelBatch } from '../../../../server/batches';

/**
 * Stops a batch that is still being worked on.
 *
 * The product had no way to do this. A user who started a hundred documents with
 * the wrong extraction mode could either wait for all of them or delete the batch
 * outright, which throws away the ones that had already succeeded. This is the
 * middle: unfinished documents become 'cancelled', finished ones keep their
 * extracted fields, and the batch stops reporting itself as in flight so the
 * client stops polling it.
 *
 * A cancelled document is not a dead end -- POST .../documents/:id/retry puts it
 * back to 'queued' and re-enqueues it.
 *
 * POST rather than DELETE: nothing is deleted, and DELETE on this path already
 * means "destroy the batch".
 */
export const onRequestPost: PagesFunction<AppEnv> = async ({
  request,
  env,
  params,
}) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const batchId = intParam(params.batchId);
  if (batchId === null) return fail('Invalid batch id.', 400);

  const outcome = await cancelBatch(env, auth.user.id, batchId);

  // 404 for both "missing" and "someone else's", so the response cannot be used
  // to probe which batch ids exist.
  if (!outcome) return fail('Batch not found.', 404);

  return json(outcome, 200, authHeaders(auth));
};
