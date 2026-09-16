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
