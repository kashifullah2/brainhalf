import { fail, json, type AppEnv } from '../../../../server/http';
import { authHeaders, intParam, requireSession } from '../../../../server/guard';
import { getBatchSummary } from '../../../../server/batches';

export const onRequestGet: PagesFunction<AppEnv> = async ({ request, env, params }) => {
  const auth = await requireSession(request, env);
  if (auth instanceof Response) return auth;

  const batchId = intParam(params.batchId);
  if (batchId === null) return fail('Invalid batch id.', 400);

  const summary = await getBatchSummary(env, auth.user.id, batchId);
  if (!summary) return fail('Batch not found.', 404);

  return json(summary, 200, authHeaders(auth));
};
