import { fail, type AppEnv } from '../../server/http';

/**
 * Turns an unhandled exception in any /api route into our JSON error shape.
 *
 * Thirteen of the twenty-four endpoints under this directory have no try/catch
 * of their own, which is reasonable — most of them are a guard, a query and a
 * `json()`. What is not reasonable is what happened when one of them did throw:
 * a D1 error, a malformed row, an R2 hiccup. Pages answers an unhandled
 * exception with its own 500 and a non-JSON body, so the client fell into its
 * "that wasn't JSON" branch and told the user either "The server returned an
 * unreadable response" or, on the auth calls, "The API is not running. Start the
 * app with `pnpm dev:api`" — advice that is actively wrong in production.
 *
 * Same failure class as the sign-out bug: a real fault reaching the user as a
 * message about something else. One wrapper here covers every current endpoint
 * and every future one, and the real error still goes to the logs where it is
 * useful.
 *
 * Scoped to /api on purpose. A `_middleware.ts` at the functions root would
 * route every static asset request through the Worker as well.
 */
/** Methods that change something, and therefore need the origin check below. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Defence in depth against cross-site requests.
 *
 * The session cookie is SameSite=Lax, which already stops a cross-site form POST
 * from carrying it, so this is not the only thing standing in the way -- but it
 * was the ONLY thing, and there was no second check anywhere. Lax is a browser
 * behaviour we do not control and has had bypasses; a server-side assertion costs
 * nothing.
 *
 * Deliberately rejects only what it can prove is cross-site:
 *
 *   * `Sec-Fetch-Site` present and not same-origin -- browsers set this on every
 *     request and a page cannot forge it.
 *   * `Origin` present and not our own -- browsers attach it to every mutating
 *     request, including same-origin ones.
 *
 * A request with NEITHER header is not treated as an attack. That shape is a
 * non-browser client (curl, a future API integration), and CSRF requires a
 * browser to make the request in the first place. Rejecting it would break
 * legitimate tooling to defend against something that cannot happen.
 */
function crossSiteRejection(request: Request, url: URL): Response | null {
  if (!MUTATING_METHODS.has(request.method)) return null;

  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    console.warn(
      `[api] refused ${request.method} ${url.pathname}: Sec-Fetch-Site=${fetchSite}`,
    );
    return fail('This request did not come from the application.', 403);
  }

  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) {
    console.warn(
      `[api] refused ${request.method} ${url.pathname}: Origin=${origin} (expected ${url.origin})`,
    );
    return fail('This request did not come from the application.', 403);
  }

  return null;
}

export const onRequest: PagesFunction<AppEnv> = async ({ request, next }) => {
  const url = new URL(request.url);

  const rejected = crossSiteRejection(request, url);
  if (rejected) return rejected;

  let response: Response;
  try {
    response = await next();
  } catch (error) {
    console.error(`[api] unhandled error in ${request.method} ${url.pathname}:`, error);
    // Deliberately generic: the message reaches the user, and an exception
    // string can name tables, columns and bindings.
    return fail('Something went wrong on our end. Please try again.', 500);
  }

  // An /api path that no function claims falls through to the static assets,
  // where `/* /index.html 200` in public/_redirects hands back the SPA shell —
  // so a typo or a retired endpoint answered 200 with a page of HTML. The
  // client dutifully failed to parse it and blamed the wrong thing: "The API is
  // not running. Start the app with `pnpm dev:api`", in production.
  //
  // /api/storage is exempt: it streams whatever was uploaded, and an uploaded
  // file may legitimately be text/html.
  if (
    !url.pathname.startsWith('/api/storage/') &&
    (response.headers.get('content-type') ?? '').includes('text/html')
  ) {
    return fail('Not found.', 404);
  }

  return response;
};
