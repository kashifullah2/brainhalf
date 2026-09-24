# Full-stack integration work

Implementation follows the agreed Workers-first plan. Existing projects remain intact.

Current live state, 23 September 2026: managed Workers/D1 hosting is **enabled for the selected pilot account**. The new account-owned token passed live permissions checks. Two apps completed preview, Browser Run verification and production publication; 40 app-verification checks passed, and four isolated development/production databases retained distinct values. Temporary resources were cleaned up. Managed auth/email runtime version: `3fee8cd6-c00d-4e91-909a-723c77f41714`. See [the live pilot report and evidence](MANAGED_DATABASE_PILOT_2026-09-23.md). Managed authentication/email are now deployed: [implementation and live validation](MANAGED_AUTH_EMAIL_IMPLEMENTATION.md). Actual Google consent, delivered production email and public-rollout cost measurement remain pending.

## Implemented in source

- [x] Isolated Sandbox jobs, acknowledged cancellation, saved-source retry, bounded logs
- [x] Per-project development/production D1, additive migration receipts, table inspection
- [x] Immutable Workers artifacts/releases, private preview tickets, public app APIs, schema-compatible rollback
- [x] Browser Run verification runner with revision-specific reports/screenshots and disposable D1
- [x] User-provided Resend and Google credentials, encrypted storage, captured test inbox, OAuth/PKCE
- [x] Settings UI, environment separation, production verification gate, deletion cleanup
- [x] Dashboard deep links and close confirmation with acknowledged server shutdown

## Live rollout gates

- [x] Cloudflare provisioning token installed; live D1/Workers create, query, upload and delete operations validated
- [x] Cloudflare account ID and encryption master key configured
- [x] Runtime Worker, Sandbox container application, service binding, and artifact bucket deployed
- [x] Pilot owner ID allowlist configured
- [x] Wildcard Worker route `*.apps.brainhalf.com/*` deployed and recorded in Wrangler
- [x] Proxied wildcard app DNS `*.apps.brainhalf.com` configured
- [x] Advanced Certificate Manager enabled
- [x] Wildcard app TLS certificate issued and active; public HTTPS and runtime routing verified
- [x] Two live reference apps validated, including Browser Run, R2, four isolated D1 databases, publication and cleanup
- [ ] Measured pilot costs and general-user rollout
- [ ] Live Google consent and delivered production email validation

Credentials must be entered in project settings, never in chat or generated source. Live testing must distinguish provider acceptance from delivery and mocked OAuth from completed Google consent.

## Pilot defaults

Three projects, two active sandboxes, one browser session, ten-minute command timeouts, five-minute idle shutdown, and a kill switch. Public resource provisioning remains gated until usage has been measured.

## Validation performed

Additional complex-app validation, 2026-09-23: the reviewed Waypoint travel planner passed **27 API/database checks and 14 browser checks** against real local workerd, persistent D1/SQLite, and BrainHalf's actual local contact inbox. This includes concurrency, idempotency, injected-write rollback, restart persistence, and browser input handling. See [the full test report](COMPLEX_FULLSTACK_TEST_2026-09-23.md). These local results do not complete the live rollout gates above.

The generated Workers starter builds and executes real SQLite tests for create/read/delete, validation, and user isolation. Runtime tests exercise SQLite-backed state with mocked external providers: encryption scope, private preview tickets, captured contact messages, OAuth state/replay protection, job phases, disconnect cleanup, deletion, and quota concurrency. These tests do not establish live Google consent, Cloudflare resource provisioning, or email delivery.

The full existing suite passed: 734 unit tests and 9 script checks, after running HTTP/subprocess tests outside the filesystem sandbox. Twelve runtime tests separately cover the new service, including direct-D1 persistence proof instead of trusting API success alone. Across the dashboard/workspace browser runs, 57 relevant tests passed, including the corrected dashboard navigation/focus tests and a new dashboard-project reload test. The Cloudflare deployment dry run built the pinned container image and runtime Worker successfully. Typechecking, lint, frontend build, and SEO checks passed. Live HTTP verification caught the Assets binding's `/index.html` canonical redirect; dashboard shell routing now fetches the root asset directly.

## Deployment state

### Follow-up review, 2026-09-22

The second review found and fixed failures missed by the original checks:

- Runtime polling retries temporary errors and times out hung requests instead of permanently abandoning heartbeats.
- Shutdown drains pending provisioning, uploads and browser launches before acknowledgement. Durable upload intents allow cleanup of an interrupted deployment; stale alarm writes cannot resurrect a stopped job or overwrite a renewed heartbeat.
- Agent and runtime stop requests run independently, so an agent failure cannot skip container shutdown.
- Reconnected Browser Run clients explicitly send `Browser.close`. Cleanup retains the quota slot until the provider no longer lists that session, and recovers when a saved session has already expired.
- Rollback compares the release to the current migration receipts, including migrations applied without a release.
- Adding a Workers backend refreshes stale npm locks, declares its TypeScript compiler, and reports incompatible existing backends/manifests instead of silently reporting success. Resource cleanup accepts empty 204/404 responses.
- Deleted projects cannot re-register and consume pilot quota. Expected quota failures cross Durable Object RPC as structured data, preserving the 429 response and useful error message.

Fresh validation: **739 main tests, 19 runtime tests, and 9 script tests passed (767 total)**. **All 58 dashboard/workspace browser tests passed in one run**, including polling recovery, environment-separated settings, project reload, and acknowledged close/retry. Typechecks, lint, build, SEO and the runtime/container deployment dry run passed.

Added `npm run runtime:smoke` (run `npm run runtime:check` first). It executes the actual bundled Worker in local workerd with real service-entrypoint RPC, Durable Object SQLite and local R2. It verifies pilot access, secret redaction, private preview, one-use tickets, captured contact messages, environment isolation, deletion, quota reuse and 429 errors. External network access is disabled in this test. This proves local platform behavior; it does **not** prove live Sandbox, D1/WFP provisioning, Browser Run, Google consent or Resend delivery.

Evidence: `/tmp/brainhalf-review-verify-final.log`, `/tmp/brainhalf-review-browser.log`, and `/tmp/brainhalf-review-runtime-check.log`.

The `brainhalf-runtime` Worker and `brainhalf-runtime-sandbox` container application are deployed, with `RUNTIME_ENABLED=false` and an empty pilot allowlist. `brainhalf-runtime-artifacts` exists. A fresh encryption master key was piped directly into the runtime's `PROJECT_SECRETS_KEY` Cloudflare secret; no plaintext copy was placed in source or chat. BrainHalf's dashboard, settings, and shutdown changes were also deployed with the runtime service binding.

After the follow-up review, deployed BrainHalf version: `5be219c7-8635-4ac9-a5ae-be0b2f3c0de9`; runtime version: `cab4b9fd-401b-46ac-9ee6-eea1d188bf38`. The existing container image was unchanged. The runtime remains disabled and its encryption secret was preserved. Post-deployment HTTP checks confirmed `/` returns 200, `/dashboard` returns 200 without a redirect and with `noindex`/no-store headers, and an unauthenticated project-runtime request returns 401. The final deployment gate passed 739 main tests, 19 runtime tests, 9 script checks, typechecking, lint, production build, and SEO checks. Deployment logs: `/tmp/brainhalf-review-main-deploy.log` and `/tmp/brainhalf-review-runtime-deploy.log`.

## Activation procedure

Activation completed for the selected pilot, 2026-09-23: the account-owned token is active and the real provisioning, browser, storage, publication and isolation checks passed. `RUNTIME_ENABLED=true` and `PILOT_OWNER_IDS=usr_GjkBFAup0hlHmg1HJXRgtVdR` are deployed in runtime version `21861ca7-2e58-4678-b969-24085ec8604f`. No further token installation is required. The earlier diagnostic failures and initial setup procedure below are historical.

Historical diagnostic update, 2026-09-23: the previous token was active but denied D1 and Workers for Platforms access. Runtime version `e38f4cd4-d9d9-4712-9f71-c63a1d258bb6` was deployed disabled with a private read-only `/provisioning-check` endpoint. Both failed disposable projects were cleaned up. This issue was resolved by installing the correctly scoped account-owned token.

Latest activation attempt, 2026-09-23: the selected pilot account is configured as `usr_GjkBFAup0hlHmg1HJXRgtVdR`. The real Sandbox build, app SQLite tests, artifact collection, pilot restrictions and unverified-publication gate passed. The installed token was rejected with HTTP 401 on the D1 list request, before database creation. The temporary project was cleaned up and runtime execution disabled again, retaining the allowlist. Main deployment: `c8660452-8f83-47e9-bb0c-d51c309e22a8`; final runtime: `6c16b33d-fab4-4389-b5f0-7913b26d1a39`. See [the pilot report](MANAGED_DATABASE_PILOT_2026-09-23.md). The earlier installation-only update below is historical.

Update after token installation, 2026-09-23: Wrangler's secret listing now confirms `CF_API_TOKEN` and `PROJECT_SECRETS_KEY` on `brainhalf-runtime`. The installed token's D1/Workers for Platforms permissions still require live validation. The pilot account email is pending; `RUNTIME_ENABLED=false` and the empty allowlist remain unchanged. The latest local validation passed 764 main tests, 30 runtime tests, 9 script checks, typechecking, lint, build/SEO, runtime/container dry-run, and local workerd smoke checks. These checks made no live provisioning calls.

1. Keep `RUNTIME_ENABLED` set to `false` while preparing the service. `CF_ACCOUNT_ID` is already set to the selected account. Set comma-separated `PILOT_OWNER_IDS` in `wrangler.runtime.jsonc` to the pilot BrainHalf user IDs. Do not put API credentials in this file.
2. The artifact bucket and disabled service are already deployed. Subsequent runtime updates use `npm run wrangler -- deploy --config wrangler.runtime.jsonc`. The Docker image and npm SDK are pinned to the same preview release.
3. Install the scoped account token with `npm run wrangler -- secret put CF_API_TOKEN --config wrangler.runtime.jsonc`. It needs D1 administration and Workers for Platforms script upload/delete access for this account. Enter it in the terminal prompt, never chat. Do not repurpose Wrangler's temporary OAuth credential.
4. `PROJECT_SECRETS_KEY` is already configured securely. Do not replace it during activation: changing the master key without re-encryption makes existing integration settings unreadable.
5. The Worker route `*.apps.brainhalf.com/*` is deployed and recorded in `wrangler.runtime.jsonc`. Proxied wildcard DNS and Advanced Certificate Manager are configured. Wildcard certificate pack `5482fc93-2431-4763-b777-b18f11c890f9` is active; public HTTPS and routing were verified on ordinary, hashed-project, and `dev-` app hosts on 2026-09-23. These requests return the runtime's intentional 503 while execution is disabled. A certificate covering only `*.brainhalf.com` does not cover this deeper app hostname. Keep app origins isolated from the IDE.
6. BrainHalf is deployed with the private `RuntimeControl` service binding; the public runtime endpoint never accepts administrative requests. Set `RUNTIME_ENABLED=true` only for the configured pilot owners after the prerequisites are ready, then redeploy the runtime.
7. In a pilot project, add the Workers backend, build, create a development release, and open its private preview. Verify the same revision, inspect its disposable-database/browser report, then publish production. Production always receives a separate D1 database.
8. Open Authentication & email in project Settings. BrainHalf-managed Google and email are the defaults; custom Resend and Google credentials are optional. Verify the owner's BrainHalf account email at `/resend-verification` before sending production email. Development contact and authentication messages are captured in the private project inbox. The labeled production email test goes only to the verified project owner. Check the recipient inbox/provider dashboard before recording delivery. Complete Google consent in a real browser before recording live OAuth success.

## Cloudflare domain setup follow-up

Completed, 2026-09-23: wildcard DNS, certificate activation, and public HTTPS routing are verified. Existing Wrangler OAuth deployed `*.apps.brainhalf.com/*` to `brainhalf-runtime`; runtime version is `25aa53eb-beaf-4321-8a3b-8048e97bbf82`, with execution still disabled and no container changes. Cloudflare reports `brainhalf.com` as an active full zone on an Enterprise Website plan. Deployment evidence: `/tmp/brainhalf-wildcard-route-deploy.log`.

The user supplied an API token with working zone DNS and certificate permissions after the existing Wrangler login lacked those permissions. The token is stored privately outside the repository and is not installed as a runtime provisioning secret. Created proxied A record `*.apps.brainhalf.com` → `192.0.2.1`, record ID `7d21c14b27178f80f19b3d0f2e09f23e`. Public DNS resolves test app hosts to Cloudflare edge addresses. The first certificate order was rejected because Advanced Certificate Manager was not enabled; the user subsequently enabled ACM. No subscription or billing settings were changed by the agent. The user was advised to rotate the token exposed in chat after setup.

Cloudflare then accepted certificate pack `5482fc93-2431-4763-b777-b18f11c890f9`, covering `brainhalf.com`, `*.brainhalf.com`, and `*.apps.brainhalf.com`, with Let's Encrypt, TXT validation, and a 90-day validity period. All three expected DNS validation values were publicly visible without manually adding TXT records. The pack and both leaf certificates now report `active`, with no validation errors; the current certificates expire on 2026-12-21. Keep the proxied wildcard DNS and ACM configuration in place for continued coverage and renewal.

Live verification used `curl` with certificate verification enabled (no `-k`):

- `https://setup-check.apps.brainhalf.com/`
- `https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps.brainhalf.com/`
- `https://dev-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps.brainhalf.com/`

All three completed TLS successfully and returned HTTP 503 with `{"error":"Runtime is temporarily unavailable."}`, matching the disabled runtime's response. This verifies HTTPS and routing, not full-stack application execution. `https://brainhalf.com/` returned HTTP 200 with successful TLS verification; `https://www.brainhalf.com/` redirected to the main site and returned HTTP 200 after following the redirect. The provisioning token, pilot allowlist, and live application/provider validation remain separate activation requirements.

## Supported contracts and limits

- Managed apps build `dist/` frontend assets and `dist-worker/index.js`. The starter sets `brainhalf.runtime` to `workers`. `/api/*` reaches its D1-backed Worker, while managed contact and auth routes stay in the privileged runtime.
- Verification currently targets the supplied starter contract: `/api/health`, authenticated `/api/items` create/read/delete, and `/api/contact`. Custom APIs need corresponding verifier extensions; a mismatched API fails verification rather than being reported as tested.
- Existing Node projects are not migrated automatically. The preview expects `server` and Vite `dev` scripts, an API honoring `PORT=3001`, and a Vite `/api` proxy to that port. Preview data is temporary. Production Node hosting is outside this rollout.
- Snapshot retry recovers source after container replacement; it cannot recover unsaved ephemeral Node database contents. Credentials are never sent to containers, generated Workers, source archives, or exports.
- Closing a project waits for server acknowledgement. Browser tab/window close uses the browser's native confirmation; its text cannot be customized. A lost agent socket receives a 10-second reconnect grace period; runtime heartbeat expiry is 45 seconds. Abort is propagated to Workers AI and provider SDKs; provider-side compute/billing termination cannot be independently guaranteed.
- Rollback changes code only when migration receipts match; it does not undo data. Additive migrations are required during the pilot. Project deletion revokes app access before retryable cleanup of databases, deployed scripts, encrypted settings, and R2 artifacts.
- The runtime is enabled for the selected pilot only. Live Workers/D1 app execution, browser verification, managed R2 uploads, publication and isolation have passed. Google consent and Resend delivery remain unvalidated. Measure container duration, browser duration, D1 operations/storage, Worker requests/CPU, and R2 storage/operations before selecting public limits; the current owner counters are not a provider-cost measurement.
