# Release validation — September 23, 2026

**Status: implemented locally; deployment blocked by incomplete environment-dependent checks.** The user explicitly authorized full deployment after validation. No production deployment, live model run, real email delivery or authenticated production mutation was performed during this work.

## Completed changes

- The homepage hero contains one accessible, expandable prompt bar and its submit button. Its visible H1, supporting content and FAQs remain below the hero. The midnight-blue theme is preserved. Restored shared section-label styling and updated obsolete browser assertions.
- Workers AI now receives the validated project inspection and editing tools previously available only to the native SDK. Upload, skill and MCP tools remain available, with existing ownership, cancellation, stale-write and source validation controls.
- Raw DSML wrappers no longer appear in chat or create phantom tool summaries. A prose-only build receives one file-output retry on the same selected model with tools disabled. A failed final retry emits an error and records a failed generation instead of also claiming completion.
- Public authentication endpoints enforce their intended HTTP methods. Login does not return a cookie/token unless its session was persisted; registry failures return a controlled service-unavailable response. Logout reports unconfirmed revocation while clearing the local cookie. Malformed percent-encoded project IDs return validation errors instead of throwing.
- Child-process verification checks now await actual process completion, and the deployment wrapper rejects subprocess errors even if a status value looks successful.

## Latest verification

| Check | Result |
| --- | --- |
| Application and runtime TypeScript | Passed |
| Application tests | **854 passed, 1 failed, 855 total** across 82 files |
| Remaining application test | Generated Node app HTTP/SQLite integration requires a local listener; this sandbox denies localhost listening. Unsandboxed rerun was blocked by approval-service HTTP 404. It was not skipped or marked successful. |
| Runtime tests | **46 passed** across 2 files |
| Deployment/provisioning script tests | Both test files passed |
| Focused public endpoint tests | **161 passed** across 5 files before two additional malformed-project-ID cases; both extra cases passed in the final application suite |
| Lint | Passed with an existing `no-control-regex` warning in `src/runtime/uploads.ts` |
| Production build | Passed; existing large editor-bundle warnings remain |
| Prerender/SEO | Passed: 15 rendered pages, 10 indexable URLs, metadata, schema, sitemap revision dates, llms.txt, links, robots and social image |
| Main Worker deployment dry run | Passed against the final production build; no upload/deployment performed |
| Full runtime/container dry run | Blocked: Wrangler could not launch Docker to build its image. The Docker CLI exists and reports version 29.7.2; container execution/daemon access remains unverified. |
| Workspace diff whitespace check | Passed |
| Local browser suite | **105 scenarios discovered, not executed**; server/Chrome escalation blocked |
| Public/account/SEO browser suite | **24 scenarios discovered, not executed** |
| Remote secrets/configuration | Not verified; read-only escalation blocked |

Logs are in [audit-artifacts/2026-09-23/release-validation](audit-artifacts/2026-09-23/release-validation/). These are test-handler and build results, not a claim that every production endpoint has been exercised.

## Endpoint coverage

Tests use real request/response handlers and temporary SQLite where applicable. External inference, email, OAuth, storage and container services are controlled test doubles; their live service availability is not established by these results.

| Endpoint family | Coverage |
| --- | --- |
| `/api/auth/signup`, `/verify-email`, `/resend-verification` | Public Worker signup-to-verification flow, unverified-login denial, single-use and replaced links, validation, rate limiting and mocked delivery failure |
| `/api/auth/login`, `/session`, `/logout`, `/ws-ticket` | Password and cookie/bearer sign-in, persisted session, wrong credentials, one-use tickets, logout revocation, unavailable registry/session storage, unsupported methods and untrusted origins |
| `/api/auth/forgot-password`, `/reset-password` | Public Worker reset flow, invalid/expired/replayed tokens, password validation, prior-session revocation and account-existence privacy |
| `/api/auth/google/start`, `/callback`, `/complete` | PKCE, browser-bound state, one-use completion, cancellation, wrong/expired state, unverified accounts, missing configuration and mocked provider failures |
| `/api/contact` | Public Worker valid/invalid submission, fixed recipient, escaped content, cross-origin/body limits and mocked delivery failure; no real messages sent |
| `/api/projects`, project rename/delete/publication/stop/runtime routes | Ownership, isolation, cleanup failures, publication/revocation, malformed identifiers, trusted runtime identity and shutdown handling |
| Agent/WebSocket, builder uploads/MCP/skills, usage/history/files | Authentication gates, session revocation, validated project tools, attachment byte preservation/export, selected MCP tools, credentials, cancellation, checkpoints and source synchronization |
| `/preview/*`, `/p/*`, tenant API forwarding | Private/public access, source isolation, no fabricated backend responses, credential stripping, safe preview headers and backend availability |
| Managed app runtime auth/contact/storage/services/database/jobs | Runtime tests cover authentication, email captures/templates/retry, Google state, uploads/quota/deletion, database persistence/recovery, build verification, stop/rollback and pilot limits |
| `/api/test/{simple,medium,hard}` | Authentication, rate limiting, model allowlist/provider gate and error handling using tests; no paid/live model call performed |
| Public HTML, assets, robots, sitemap and llms | Build/prerender/SEO checks passed; actual HTTP/cache/compression/browser verification remains pending |

The chat-app regression uses the user's exact React/WebSocket/presence prompt with deterministic model responses. It proves tool wiring and retry behavior; it is **not** a live-generated or deployed chat app.

## Required finish

1. Repair the environment's automatic approval service, which returns HTTP 404 for its configured API deployment. Authorization is already present; do not bypass the review boundary.
2. Run `npm run verify` with permission to open localhost listeners. Resolve any actual test failures.
3. Run `npx playwright test` and `npx playwright test --config playwright.seo.config.ts`, inspect the new input-hero screenshots in both themes, and fix any browser errors. These suites include sign-in, contact and account UI checks with mocked external services.
4. Resolve Wrangler's Docker/container execution failure and pass `npm run runtime:check`. Confirm runtime and platform deployment targets/bindings and the existing pilot policy.
5. Complete read-only remote configuration checks. In addition to model/session prerequisites, confirm email and Google configuration needed by the public flows (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) without printing secret values. Verify runtime provider/credential bindings before a runtime rollout.
6. Deploy the authorized release using the guarded `npm run deploy` workflow (including its predeploy verification), and coordinate any required runtime/container rollout. Do not substitute a partial rollout for the user's requested complete deployment.
7. Smoke-test deployed public pages/assets and API status/method/auth protections, then verify controlled authenticated flows and a real app generation. Email delivery to real people requires messaging authorization; the tests here deliberately mock delivery.

No approval request is pending and no deployment process is running.

## Deployment retry follow-up

The user again requested fixing everything and deploying. An unsandboxed `npm run verify` was attempted again; automatic approval review still returned HTTP 404 before executing the command. This is an environment failure, not an application response, and cannot be fixed by changing BrainHalf's source. Deployment remains authorized but not performed.

The release guard now enforces `REQUIRED_PUBLIC_SERVICES = "email,google"` in the production Wrangler configuration. It requires the sender/contact settings and email/Google credentials used by the visible account and contact flows, rejects credentials in public vars, validates public email settings, and does not treat local shell values as proof of deployed configuration. Deployment tests cover missing service configuration preventing the publish command, valid vars, invalid settings and credential handling. Both script-test files and lint passed after this change. The known runtime lint warning remains.

See `release-retry-scripts.log`, `release-retry-lint.log`, and `release-retry-dryrun.log` in the release-validation artifact directory for this follow-up. The previous application/runtime results still apply to unchanged application source; environment-dependent validation is still outstanding. Google Console callback registration and real Resend delivery also remain unverified.
