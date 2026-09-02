import { json, type AppEnv } from '../../../server/http';
import {
  maybeSweepExpiredAuthRows,
  resolveSession,
  sessionCookie,
} from '../../../server/session';

/**
 * The single source of truth for "am I signed in?". The client no longer decides
 * this for itself — it asks here on load, and the answer depends on a session
 * row the browser cannot forge.
 */
export const onRequestGet: PagesFunction<AppEnv> = async ({
  request,
  env,
  waitUntil,
}) => {
  // Every page load calls this endpoint, which makes it the cheapest place to
  // hang the expired-row sweep off. waitUntil keeps it off the response path,
  // so the one-in-fifty request that sweeps is no slower than the rest.
  waitUntil(maybeSweepExpiredAuthRows(env));

  const session = await resolveSession(request, env);

  if (!session) {
    // Note: googleClientId is public by design. Do not add private server config here.
    return json({ user: null, googleClientId: env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID }, 200);
  }

  const headers = session.refreshedToken
    ? { 'Set-Cookie': sessionCookie(request, session.refreshedToken) }
    : undefined;

  return json({ user: session.user, googleClientId: env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID }, 200, headers);
};
