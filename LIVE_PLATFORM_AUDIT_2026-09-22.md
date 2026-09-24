# BrainHalf live platform audit — 22 September 2026

**Result: live checks completed, with confirmed platform/model failures.** All seven selectable model/provider paths received real authenticated generation requests. Six returned source that passed the platform's syntax validation; Atria failed. MiniMax's syntax-valid output then crashed at runtime. Browser checks also found a broken Kimi K2.7 delete action and accessibility defects. The complex application initially failed both a real backend request and its production build.

A corrected, complete source export is available below and saved in the private production audit project. It passes its build, 26 route/SQLite checks, 3 database concurrency scenarios, all 15 real HTTP tests, and the tested browser workflows. The hosted frontend renders correctly, but its API returns **501 BACKEND_NOT_RUNNING** because BrainHalf does not run this generated Node server in the browser preview. The earlier approval blocker no longer prevented execution under the updated session settings.

- [Production UI export — complete verified app](audit-artifacts/2026-09-22/stockroom-production-export.zip)
- [Corrected source archive](audit-artifacts/2026-09-22/stockroom-qa-reviewed.zip)
- [App setup, API contract, and verification limits](audit-artifacts/2026-09-22/STOCKROOM_README.md)
- [Artifact manifest and SHA-256](audit-artifacts/2026-09-22/artifact-manifest.json)
- [Model results](audit-artifacts/2026-09-22/model-results.json)

## Scope and method

Used the actual production signup UI and a dedicated audit account. Created private test projects through the production platform and invoked `/api/test/medium` for every selectable model. No fake login, mocked provider replies, or demo API was used to establish live results. Existing source changes from earlier platform/UI work were preserved. This audit did not deploy platform changes.

Cloudflare deployment inspected: `105b7552-d336-451b-a549-5c0f8cfe0d9f`, deployed at `2026-09-22T05:39:40Z`. All 478 captured tail events referenced that version. The tail was filtered to the audit IP, so it does not represent all customer traffic or a complete historical log search.

Private production projects (require the audit account):

- [Stockroom QA — Atria attempt](https://brainhalf.com/?project=proj-jfoevc-muc93q6m)
- [Stockroom QA — Sonnet attempt](https://brainhalf.com/?project=proj-mcolt6-muc9oisd)

Audit login credentials and browser session are retained only in `/tmp/brainhalf-live-20260922/credentials.private.json` and `session.private.json`, with restrictive permissions. No credentials or raw request headers are included in this report or its artifacts.

## Model results

Times below are the platform's reported generation durations, not total browser interaction times. A syntax pass does not establish feature correctness or successful backend generation.

| Picker/model label | Provider / concrete ID | Generation | Browser result |
|---|---|---|---|
| GPT-OSS 120B | Cloudflare / `@cf/openai/gpt-oss-120b` | HTTP 200; syntax pass; 13.0 s | Create, complete, filter, delete passed. Checkbox/filter controls lack keyboard semantics. |
| Kimi K2.7 Code | Cloudflare / `@cf/moonshotai/kimi-k2.7-code` | HTTP 200; syntax pass; 77.0 s | Create, complete, search, filter passed. **Delete failed.** |
| Qwen 3.8 27B | Cloudflare / `@cf/qwen/qwen3.8-27b` | HTTP 200; syntax pass; 163.2 s | Create, complete, filter, delete passed. |
| Claude Sonnet 6 | AWS / `us.anthropic.claude-sonnet-4-6` | HTTP 200; syntax pass; 39.0 s | Create, complete, filter, delete passed. Icon controls lack accessible names; delete is hover-only. Mobile content overflowed 396px in a 348px preview. |
| Kimi K3 | AWS / `us.moonshotai.kimi-k3` | HTTP 200; syntax pass; 89.2 s | Create, complete, Active/Completed filtering, and delete passed. |
| Atria Dawn Preview | Atria / `Atria-Dawn-Preview` | **HTTP 422; syntax failed; 300.0 s** | No passing app. Syntax error: `Unexpected token, expected ";" (110:18)`. |
| MiniMax M2.7 | Dahl / `MiniMaxAI/MiniMax-M2.7` | HTTP 200; syntax pass; 300.0 s | **Runtime failure: `use is not defined`.** Source was truncated at `const [newTaskCategory, setNewTaskCategory] = use`; syntax validation accepted the incomplete app. |

The Sonnet picker label does not match its provider model ID. This audit records both rather than treating the label as independent evidence of model identity.

Kimi's delete action uses `window.confirm()`, which is blocked by the preview iframe's sandbox. Browser console evidence:

> Ignored call to 'confirm()'. The document is sandboxed, and the 'allow-modals' keyword is not set.

Its “Clear completed” code also uses `window.confirm`; that path was identified in source but not separately verified in the browser. The appropriate generated-app repair is an accessible in-app confirmation flow. The iframe sandbox was not weakened during this audit.

MiniMax reached the 300-second model-test ceiling, yet the endpoint returned success. Its generated function ends in an unresolved `use` expression and returns no application. This demonstrates that a syntax-only success flag is insufficient. [Runtime screenshot](audit-artifacts/2026-09-22/minimax-runtime-error.png) and [result](audit-artifacts/2026-09-22/minimax-ui.json).

Interaction evidence: [Kimi K3](audit-artifacts/2026-09-22/kimi-k3-ui.json), [GPT](audit-artifacts/2026-09-22/gpt-ui.json), [Kimi](audit-artifacts/2026-09-22/kimi-ui.json), [Sonnet](audit-artifacts/2026-09-22/sonnet-ui.json), [Qwen](audit-artifacts/2026-09-22/qwen-ui.json).

Mobile checks at a 390px platform viewport produced a 348px app viewport: GPT-OSS, Kimi K2.7, Kimi K3, and Qwen fit without document overflow. Sonnet overflowed by 48px. [Measurements](audit-artifacts/2026-09-22/model-mobile-results.json).

## Complex application: Stockroom QA

The test specification required a real React/Express/SQLite equipment desk with inventory search/category filters, product creation and versioned edits, reservations, confirmation/cancellation, and audit history. Edge cases included duplicate SKUs, invalid emails, negative/fractional quantities, overselling, idempotency keys, stale edits, concurrency, atomic rollback, and persistence.

### What the live platform produced

1. Atria initially returned a plan and asked for confirmation. After an explicit instruction to implement, it timed out after 600 seconds without a completed app. The UI displayed the timeout message twice. [Screenshot](audit-artifacts/2026-09-22/atria-timeout.png).
2. Sonnet wrote backend files and some frontend components, then hit unfinished-file continuation flows. The saved initial `App.tsx` was still the starter. Reservations, audit screens, and a product form were missing. [Initial preview](audit-artifacts/2026-09-22/stockroom-initial-preview.png).
3. Running the initial export locally returned 200 from health and product-list endpoints, but a valid reservation returned **500: `db.transaction is not a function`**. The generated code used a better-sqlite3 method against Node's `DatabaseSync`, which does not provide that method. [Real HTTP evidence](audit-artifacts/2026-09-22/api-initial.json).
4. The initial generated test script also failed with the same transaction error. Its tests duplicated database logic instead of exercising the HTTP application.
5. Building the initial saved export failed: `src/components/Inventory.tsx(5,30): TS2307: Cannot find module './ProductFormModal'`.
6. A live follow-up requested transaction repair and version increments. The platform's response stated that its backend files were repaired. After live access resumed, the resulting files were retrieved: reservation routes did use `withTransaction`, while `App.tsx` remained the starter. The full corrected export was then saved through the authenticated project-file synchronization path. The archived initial files remain the evidence for the observed failures.

### Corrected export

Codex completed a separate local copy after live access was interrupted, then saved the corrected files in the existing private Sonnet audit project after access resumed. The archive includes all four screens, product/reservation forms, light/dark themes, explicit offline errors, real API calls, server code, SQLite persistence, startup instructions, and independent tests. localStorage is used only for the theme preference.

Backend repairs replace the nonexistent transaction method with `BEGIN IMMEDIATE`, `COMMIT`, and `ROLLBACK`; put stock changes, reservations, and audit writes in transactions; advance product versions on stock changes; validate numeric types; preserve idempotency under concurrent calls; validate audit pagination; and allow metadata edits when available stock is lower than reserved stock. Product writes and their audit records commit before success responses.

The production Export project button downloaded a valid ZIP containing all 31 expected files, with no content differences from the verified source. [Export check](audit-artifacts/2026-09-22/stockroom-export-results.json). The workspace correctly prompted to choose server files when the old browser cache differed; selecting the saved corrected version resolved that expected conflict. A fresh browser context loaded it directly.

The corrected app is a local audit fixture, without application authentication. Its API binds to loopback. This is not a deployed customer application.

| Validation | Corrected export result |
|---|---|
| TypeScript and Vite production build | Passed on Node 22.23.2. [Final build result](audit-artifacts/2026-09-22/reviewed-build-final.json). |
| Actual Express route handlers with real SQLite | **26/26 passed**. Includes deliberate database failures proving rollback. [Results](audit-artifacts/2026-09-22/independent-reviewed.json). |
| Independent workers sharing one database | **3/3 passed**: competing for the last item, identical idempotency retries, simultaneous cancellation. [Log](audit-artifacts/2026-09-22/reviewed-concurrency.log). |
| Light/dark text-color token contrast | **16/16 pairs meet 4.5:1**, minimum 5.49:1. This is a token calculation, not a full accessibility audit. [Results](audit-artifacts/2026-09-22/reviewed-contrast.json). |
| Full HTTP integration suite | **15/15 passed**, including simultaneous requests, malformed JSON, and HTTP server/SQLite restart. [Results](audit-artifacts/2026-09-22/reviewed-http-results.json). |
| Browser behavior and mobile layout | Product CRUD, search/category filters, reservation lifecycle, audit, theme persistence, overselling errors, and stale-edit errors passed. All four views fit a 390px viewport without document overflow; no page errors captured. Light/dark screenshots visually reviewed. [Results](audit-artifacts/2026-09-22/stockroom-browser-results.json). |
| Production project synchronization | Corrected files saved; API snapshot comparison and a fresh authenticated browser context verify server persistence. [Evidence](audit-artifacts/2026-09-22/stockroom-persistence.json). |

The same final 26 route checks against the original export produced 9 passes and 17 failures. Several reservation failures share the transaction-method root cause; this is not a claim of 17 distinct bugs. [Baseline results](audit-artifacts/2026-09-22/independent-initial.json).

The route checks invoke the actual handlers and SQLite, but bypass HTTP transport and Express middleware. The worker tests establish concurrent database behavior, not browser/network behavior. The HTTP suite separately exercises the real transport and middleware; browser checks then exercise the actual React frontend against that API.

## Hosted backend limitation

The deployed bindings include Workers AI, static assets, ChatAgent/REGISTRY Durable Objects, project-backup R2, and a dispatch namespace. Those bindings alone do not show that a generated Node server is executed.

The production shell explicitly displayed:

> Frontend preview only. Backend servers and databases are not running here.

The inspected workspace's `src/lib/preview-fetch.ts` returns HTTP 501 with `BACKEND_NOT_RUNNING` for local API requests unless demo simulation is enabled. The final app's actual `/api/health` request was captured inside the live iframe: **HTTP 501**, code **BACKEND_NOT_RUNNING**. The completed frontend displays its API-offline state. [API response](audit-artifacts/2026-09-22/stockroom-hosted-api.json) and [hosted screenshot](audit-artifacts/2026-09-22/stockroom-hosted-preview.png).

Do not enable the demo API and count its simulated responses as validation of Express/SQLite execution. A generated backend needs an actual supported runtime or external deployment to work in the hosted preview.

## Cloudflare and configuration

[Sanitized log summary](audit-artifacts/2026-09-22/cloudflare-summary.json):

- 478 captured events: 391 `ok`, 66 `canceled`, 21 `responseStreamDisconnected`.
- HTTP statuses where present: 381 × 200, 4 × 404, 3 × 401, 1 × 422; 89 events had no response status recorded.
- 0 captured Worker exceptions; 122 warning log entries.
- Some canceled/disconnected events occurred around navigation and stream closure. Counts alone do not identify provider failures or prove a production outage.
- The HTTP 422 corresponds to the failed Atria model test. Initial preview/auth transitions also produced 404/401 responses; these were not all persistent failures.

Secret-name and deployed-binding inspection found the configured model-provider credentials and session secret. **`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` were absent** from the inspected deployment. The workspace's Google sign-in implementation requires both. Google OAuth cannot be treated as production-verified by this audit; no Google configuration was created or changed.

No raw Cloudflare headers, cookies, tokens, or secret values are included in saved repository artifacts.

## Approval recovery and remaining product defects

Earlier attempts to restart the browser failed because the agent's automatic approval service returned `404 Not Found: The API deployment for this resource does not exist`. This was not a brainhalf.com response. Under the updated session approval settings, the same browser restart succeeded, and the previously blocked HTTP/browser checks were completed. No approval check was bypassed; the hosted Azure reviewer deployment itself was not changed by this audit.

Remaining product work is concrete:

1. Provision a supported runtime for generated backends, or clearly scope hosted projects to frontend previews. The exported Node/SQLite app works; the current hosted preview does not run its backend.
2. Reject incomplete model output and perform runtime validation before reporting model-test success. MiniMax was marked successful despite an immediate runtime failure.
3. Improve Atria timeout/syntax handling and prevent duplicate timeout messages.
4. Ensure full-app generation finishes every required file and passes build/API checks before claiming completion. Sonnet needed repairs and a manually completed export.
5. Guide generated apps away from sandbox-blocked `window.confirm`; use accessible in-app controls. Fix the observed keyboard/accessible-name defects and Sonnet sample's mobile overflow.
6. Configure the missing Google OAuth credentials before treating Google sign-in as production-ready. No credentials were fabricated or provisioned during this audit.
7. Persist project-name edits across browser sessions. The audit renamed its project through the UI, but the fresh authenticated context still displayed “Untitled Project,” while all 31 source files persisted correctly. The final hosted screenshot records this discrepancy.

The audit updated only its private test project and local audit artifacts. No BrainHalf platform deployment, account deletion, or user-data cleanup was performed.

Audit cleanup: the browser, Cloudflare tail, and local corrected-app servers were stopped. The earlier initial-app server was identified by its audit working directory and stopped before starting the corrected version. Private test projects were retained for review.
