# ISSUES.md — skipped, destructive, or out-of-scope actions

Nothing destructive has been run. Log format: `I-NN · [SEVERITY] issue · action taken / skipped`.

## I-01 · [MEDIUM] Pre-existing client-only projects are claimed first-come

Before auth existed, projects existed only in a user's localStorage with unguessable random ids
(`proj-xxxxxx-…`). On their first authenticated connect, the project is claimed by that user. If two
users somehow share an id, whoever connects first wins and the other is locked out.

**Mitigation in place**: claim is an atomic `INSERT ... ON CONFLICT DO NOTHING` followed by a re-read,
so there is no race window. Ids are 128-bit-of-entropy random, so collision requires a leaked URL.

**Not done (would be destructive)**: a bulk back-migration of every localStorage project to a named
owner cannot be done server-side — the server cannot know which client owns which local project, and
reassigning them could lock the true owner out. Left as-is; users naturally claim their own.

## I-02 · [INFO] Production secret must be set out-of-band

`SESSION_SECRET` is a Wrangler *secret*, not a file. It has to be provisioned with
`npx wrangler secret put SESSION_SECRET` before deploy. Not set here — putting a real secret in
`wrangler.toml` or committing `.dev.vars` would be worse than leaving it unset. Without it, sessions
do not survive isolate restart (see DECISIONS D-02).

## I-03 · [INFO] Sandbox has no outbound network to brainhalf.com

All Playwright/E2E verification runs against `npx wrangler dev --local --port 8788 --ip 127.0.0.1`
(see memory `auth-gate-playwright-runs`). Specs pointed at production fail on network, not on code,
and are not evidence of anything. Test results in TEST_RESULTS.md state explicitly which backend
they ran against.

## I-04 · [BLOCKED] No production data touched, no force-push

Per the manifest: no `git push --force`, no production deploy, no destructive SQL, no user-data
deletion. All DB work is against local miniflare SQLite only.

## I-05 · [FIXED] Production bundle would not have built after Phase 3

`vite build` failed on `src/agent.ts` with "Unterminated regular expression" because
the U+2028/U+2029 escaping used the literal characters inside regex literals (see
DECISIONS D-19). Detected in this session by importing agent.ts from a unit test for
the first time; fixed, and `vite build` is now green. Recorded so the audit trail
shows the gap between "tsc passes" and "the artifact builds".

## I-06 · Preview store singleton shared across projects (fixed, D-23)

`executeBackendRequest` defaulted to a module-level `globalPreviewStore`. Any two
agent Durable Objects in the same isolate shared one simulated backend database, so
project A's preview could read project B's simulated `/api/*` rows. Fixed by giving
the agent its own store instance; no signature change.

## I-07 · Silent duplicate-id overwrite in the preview data store (fixed, D-25)

`create` with an explicit existing id overwrote the row and still returned 201, and
the auto-increment counter was reset to 1 by every non-numeric id, so later auto ids
collided. Both fixed; a duplicate now yields 409.

## I-08 · No TTL on stored sessions (mitigated, D-22)

`sessions` rows were never deleted after expiry. The table grows one row per login.
A sweep now runs on login over a new index on `expires_at`. This bounds growth only
as well as logins happen — a registry that stops receiving logins keeps its expired
rows. A true periodic sweep would want Durable Object alarms; not done, because it
adds a lifecycle path for a job one indexed statement already handles.

## I-09 · Unbounded `files_snapshot` frames (mitigated, D-24)

Both snapshot sites shipped every project file in one WebSocket frame with no
row or byte cap. Now bounded per page (200 rows / 8 MiB) with additive paging
fields. Note the mitigation is a ceiling, not full streaming: a workspace larger
than the ceiling receives a truncated snapshot on the post-extraction broadcast,
and the client does not yet page to recover the remainder — it pages only if it
asks for `limit`/`offset` explicitly, which the current UI does not do.
