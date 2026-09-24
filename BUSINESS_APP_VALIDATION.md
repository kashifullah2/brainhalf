# Small-business app validation and outcome measurement

Implemented on 2026-09-23, with release fixes and successful deployment of both services on 2026-09-24 (Asia/Karachi). The user completed `npm run deploy:platform`, including all release gates and both real uploads. That baseline release includes the publishing and business-app changes and the bodyless shutdown fix. **Live model generation and the five-app journey still require separate validation.** The subsequent single-app and project-diagnosis browser attempts ended before authentication; neither is still awaiting sign-in. See [the subsequent upload, publishing and streaming repair](UPLOAD_PUBLISHING_REPAIR_2026-09-24.md) for the latest rollout and affected-project build evidence.

| Service | Baseline deployed version | Route |
| --- | --- | --- |
| Main application `brainhalf` | `3e3ec799-a093-42ce-ad0f-a34a00e4b061` | `brainhalf.com`, `www.brainhalf.com` |
| Hosting runtime `brainhalf-runtime` | `afb70618-e9a3-4c34-ab8f-888d7820676a` | `*.apps.brainhalf.com/*` |

These version IDs appear in the user's successful deployment output and were independently confirmed through Cloudflare's deployment API, each receiving 100% of traffic. Runtime activation was `2026-09-23T19:44:25Z`; main activation was `2026-09-23T19:45:40Z`. Sanitized metadata is saved in `audit-artifacts/releases/2026-09-24/deployment-check.json`. The runtime container image already existed remotely; Wrangler reported no container application changes. Runtime access remains available to all signed-in owners within existing account limits.

## Start with one simple app

Run this as one terminal command:

```sh
node scripts/test-live-model-apps.mjs --run
```

Chrome opens visibly. Sign in, or create an account and verify its email, then keep the browser open. The runner checks the real server session and an authenticated page in any tab of that Chrome window, including the dashboard or workspace. On sign-in failure it records the HTTP status and sanitized page locations, plus a masked screenshot when possible; it does not save session bodies or OAuth URLs. It creates one private task app using the default model, checks the actual model/provider request, captures the response and generated-file evidence, then tests adding, completing, reopening, deleting and mobile layout. It preserves the project and writes results/screenshots under `audit-artifacts/live-model-apps/<run>/`.

`--all-models` explicitly expands the run. The default checks just one model. The earlier `--signup`/`--headless` suggestion was withdrawn: a fabricated mailbox cannot complete real email verification. This runner neither creates sessions internally nor stores login credentials. A closed sign-in window is an authentication blocker, not evidence of an LLM failure.

## Five real business applications

Both services and their local smoke checks have passed. To validate the five production journeys, run:

```sh
npm run test:business:apps
```

The runner generates all five apps sequentially with the default model. It uses real production APIs, publishing jobs and D1 reads, without mocked success responses. A shared API contract makes the checks repeatable; each app must implement its own business rules.

| App | Required domain behavior |
| --- | --- |
| Inventory | Products, SKU, quantities, reorder level, stock adjustments; negative quantities rejected |
| Booking | Customers, start/end times, cancellation; overlaps and concurrent double bookings rejected |
| CRM | Contacts, valid emails, private notes and allowed sales stages |
| Tasks | Due dates, priorities, completion and open/completed filters |
| Customer portal | Private customer requests, message updates and owner isolation |

The journey checks generation, one-click publishing, publishing after closing the workspace, app signup/email verification/login, UI record creation, independent production database persistence, invalid input, another account’s read/update/delete denial, anonymous denial, owner-ID spoofing, reopening, mobile layout, an AI-generated update, republishing, data preservation and deletion.

Use your own controlled test mailboxes. The browser pauses for real authentication for two distinct users in each newly published app. Complete email verification in the corresponding controlled Chrome tab. The first app-user account must exercise signup, verification and login; reusing an existing session does not satisfy that check. Platform sign-in alone is reported as sign-in, not as proof of platform signup. Google consent and email delivery are never simulated by this runner.

Source ZIPs and screenshots are saved before the runner deletes only the projects it created. This allows five sequential cases within the existing three-hosted-project cap. Other account limits remain enforced; quota refusals remain visible failures. Test data is confined to these new projects. Results are written incrementally to `audit-artifacts/business-apps/<run>/results.json`; unexecuted cases remain `not-run`.

## Beginner experience

The default path is describe → try → Publish. Detailed or long app briefs now generate code instead of silently entering planning mode; planning requires an explicit request. Model selection, agent tools and hosting settings are under **Advanced** in the composer. Existing expert tools and supported-backend publishing remain available. The landing page and SEO metadata focus on small-business internal tools. The interactive inventory example is explicitly sample data and uses no large hero photograph or embedded app runtime.

## Outcome metrics

First-party measurements are separate from public-page Google Analytics. They contain account/project IDs, event IDs, revision hashes and timestamps, never prompts, code, emails, credentials or customer data. Generation and runtime events use durable outboxes; retries are idempotent. Publication success is recorded in the same transaction that activates the checked production release.

| Measure | Definition |
| --- | --- |
| Working apps per generation | Completed generation attempts whose exact revision later passed app verification, divided by started non-planning generation attempts. Unverified completions do not count as working. |
| Publishing success | Successfully activated production publishing jobs / accepted production publishing jobs. Failed and stopped jobs remain in the denominator. Rejections before job admission, including quota and client validation failures, are outside this metric. |
| Time to first live app | First successful activation minus first observed workspace activity. Aggregate reporting uses the median across accounts that published. Existing accounts are observed from instrumentation rollout, not backfilled. |
| Week-one return | Account active again during days 7–13 after first observed workspace activity. Only cohorts with a complete 14-day observation window enter the denominator. Immature or empty cohorts return `null`. |

These are verification-based operational measurements, not a guarantee of every generated workflow or proof of improved retention. No success percentages or retention improvements are claimed before real data exists.

Account reports appear under Project console → AI usage. `GET /api/account/outcomes` is authenticated and always scoped to the caller. `GET /api/admin/outcomes` returns aggregate counts only to authenticated IDs explicitly configured in the main Worker's comma-separated `PRODUCT_METRICS_OWNER_IDS` variable; an empty configuration denies access. Registry ingestion is internal and validates project ownership. The runtime reuses the trusted `ManagedProviders` service binding. Privacy documentation discloses these measurements and retention of outcome records after project deletion.

## Validation in this environment

- The successful user-run release passed **934 application tests, 78 runtime tests, 36 script tests, 114 application browser tests and 38 Worker/SEO browser tests**, plus typechecking, lint and the production build/SEO checks.
- The full runtime Docker build and Worker dry run passed. Actual local workerd runtime and agent smoke checks passed both standalone and inside the guarded release, including bodyless stop, authenticated sockets, checkpoint restore, session revocation, private preview, generated-app authentication and deletion. These local checks called no cloud providers.
- Both remote secret checks passed, then the runtime and main application uploaded successfully in that order. Expected stderr from deliberately failing unit-test scenarios did not indicate a failed release.
- `.release/validation.json` records verification at `2026-09-23T19:43:36.047Z`, source digest `765899a1522beea7276094bbb37692196e5f69d8a328969f904be2e9fe407280` and built-asset digest `20ad701d2a4d336d6e169c4b1e89272fadf8b65b69bef8a747bb346f1ac78aa2`. The source archive is `.release/source-765899a1522beea7276094bbb37692196e5f69d8a328969f904be2e9fe407280.tar.gz`. The assistant independently confirmed that current source and built assets still match this receipt after deployment.
- The bodyless shutdown regression is resolved: zero-byte request streams are accepted by the stop endpoint, while its 256-byte limit, object validation and job-ID protection remain enforced. Other JSON endpoints retain strict body requirements. The original bodyless smoke request now passes in workerd.
- Earlier browser failures were resolved with hosting/outcomes fixtures and current landing selectors. Bundled SEO cases were split into independent cases while retaining assertions and the 30-second deadline. The complete successful browser run covers these fixes.
- The live runner now accepts a real authenticated server session plus a signed-in dashboard/workspace in any same-origin tab. The business runner targets `Publish application`. Both the earlier live run at `audit-artifacts/live-model-apps/2026-09-23T18-13-56-812Z/` and the post-deployment run at `audit-artifacts/live-model-apps/2026-09-23T19-52-53-485Z/` ended before authentication and generation. The later project-diagnosis browser also ended before authentication. The owner subsequently supplied actual build logs, and the saved affected-project source was retrieved for a real local build check.

## Public production checks

The assistant checked production at approximately `2026-09-23T19:53Z` (2026-09-24 in Asia/Karachi):

| Request/check | Observed result |
| --- | --- |
| `GET /` | HTTP 200; current business heading and title; all four entry asset references match local `dist/index.html` |
| `HEAD /assets/index-CDOcKg_K.js` | HTTP 200; JavaScript; one-year immutable cache |
| `HEAD /assets/index-VmbFWCzn.css` | HTTP 200; CSS; one-year immutable cache |
| `HEAD https://www.brainhalf.com/` | HTTP 301 to `https://brainhalf.com/` |
| Anonymous `GET /api/auth/session` | HTTP 401, `No valid session`, `Cache-Control: no-store` |
| Anonymous `GET /api/account/outcomes` | HTTP 401, `Authentication required`, `Cache-Control: no-store` |
| `HEAD /release-check-missing-page` | HTTP 404 |

Public HTTP checks establish deployment reachability and basic routing/access behavior. The single live app, five production journeys, real deliverability, and week-one cohorts still need actual results; these checks do not substitute for those journeys.
