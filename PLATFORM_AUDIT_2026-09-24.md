# Brainhalf platform audit — 24 September 2026

## Result

Platform repairs are deployed at https://brainhalf.com. The final rollout includes starter dependency repairs and the optional-analytics verification fix. The full-stack Task Board is published at https://96f64707e493d216204ad9c6819e1a3c.apps.brainhalf.com using project `proj-0978089d-6817-4a1c-a648-03ca63075d39`. This report does not claim that every possible bug or endpoint has been exhaustively tested.

## Repairs

- Concurrent runtime-status callers share a fetch but cancel only their own wait. This fixes Publish failing when another panel aborts its request.
- Preview events preserve active generation status. Text-only responses no longer reload previews, and generation errors no longer falsely mark an existing preview broken.
- WebSocket messages recheck authorization after logout, removing the previous 30-second authorization-cache window. The real agent smoke test verifies immediate revocation.
- Opening an untouched workspace no longer reserves a hosting slot. Validated jobs and explicit preview tickets reserve slots instead. A serialized admission/recovery queue prevents races; quota errors retain their proper status rather than resetting the Durable Object.
- Legacy reservations are released only when there are no jobs, releases, databases, active deployments, current jobs, unexpired sessions, managed users, email records, or inbox records. Existing projects, source, settings and data are preserved. Two unused reservations were checked in both environments; new job admission subsequently succeeded.
- Updated managed-starter esbuild to `^0.28.0`, compatible with the current Vite peer requirement. The real cloud install exposed the previous conflict that local builds using existing dependencies did not catch.
- Updated starter and preview React Router references to 7.18.4, addressing GHSA-wrjc-x8rr-h8h6 and GHSA-337j-9hxr-rhxg. The prepared app now installs, builds, passes its SQLite CRUD suite, and reports zero npm audit vulnerabilities.
- Publication verification ignores only the optional Cloudflare analytics beacon at `static.cloudflareinsights.com/beacon.min.js`. Required local and external scripts/styles remain release blockers. Real app API/database/browser checks had passed before this optional beacon caused a false failure.

## Completed platform rollout

The final rollout passed 969 application tests, 92 runtime tests, 36 script tests, 114 platform browser cases on their first attempt, two cases after retry, and 39 public-page browser tests. It also passed typechecking, lint, production build/SEO, Worker/Docker dry runs, real runtime/agent smokes, and secret checks.

| Service | Version |
| --- | --- |
| Main | `5da75690-e970-46be-bbfc-dd37a8aa6c43` |
| Runtime | `9d880168-29e9-4137-8679-32faa9181248` |

Both versions were confirmed at 100% traffic. Log: `/tmp/brainhalf-platform-final-audit-deploy.log`. The final two retry-dependent cases cover streaming refresh recovery and mobile publishing-error display. Receipt: `audit-artifacts/platform-audit-2026-09-24/final-release-validation.json`; source digest `207c846d5bae426800bc49500c3b95d24fa5c573255531e5ef8db5957cb073fe`.


## Live performance and endpoint checks

After the final rollout, all 13 route expectations passed across three requests each (39 total). They cover public assets, authenticated API rejection, and unknown-API 404 behavior. Nine internal links at each viewport returned 200; the login dialog opened successfully.

| Browser viewport | LCP | Navigation TTFB | Load event |
| --- | --- | --- | --- |
| Desktop, 1440 px | 1,392 ms | 849 ms | 3,204 ms |
| Mobile width, 390 px | 1,204 ms | 597 ms | 3,188 ms |

Both runs recorded no uncaught JavaScript errors, no observed layout shifts and no horizontal overflow. These are small, unthrottled Chrome samples from one machine, not global latency percentiles, real mobile-device measurements, throughput benchmarks or proof of performance under load. Earlier requests had occasional approximately 1.5-second response times.

Evidence: `audit-artifacts/platform-audit-2026-09-24/public-audit.json`, `public-audit-before.json` and homepage screenshots.

## Full-stack applications

The local React/Node/SQLite application builds and passes frontend/backend typechecking and real authentication/database tests. Eight browser checks pass: registration, task creation, reload persistence, cancelled deletion, mobile layout, confirmed deletion, logout, and subsequent login with deletion persisted. Local API samples were 3–40 ms for reads/deletes/logout, 140 ms registration and 182 ms login. Source and evidence are under `fullstack-app/`, `fullstack-local-source.zip` and `fullstack-local-browser.json`.

The managed React/Workers/D1 Task Board is built from Brainhalf's backend factory plus a connected frontend. Source: `managed-example/`; archive: `managed-example-source.zip`. It uses Google sign-in in production because the Brainhalf owner's email is unverified. Password signup, magic links, welcome mail and production email are disabled for this example; enabling them requires completing email verification and readiness checks.

In the real cloud publication attempt, frontend/backend installation, build and backend tests passed. Verification passed page loading, anonymous rejection, task creation, direct D1 persistence, cross-user deletion denial, reading, deletion, direct D1 deletion, captured development contact, browser creation and reload persistence, and absence of browser exceptions. The earlier optional analytics-resource failure was corrected. The final publication passed and activated production release `f8a3f691-d941-4a67-a6f3-ac16ce036521`, revision `b667b99da87ac338ecc92774d70edccec22c506e85383cee3d79d9636cf8152e`. Publication took 109.7 seconds after the automatic development release finished. All 18 final verification checks passed. The production database has its own applied migration and starts without verification records. The source archive includes the tested package lockfile. Initial public probes returned health 200 (5,283 ms) and anonymous task access 401 (409 ms); the first health sample is a latency outlier requiring further observation, not proof of uniformly fast service.

Test-runner corrections included waiting for registration, keeping the saved fixture and browser cache consistent, waiting for automatic preview jobs, and filtering for the current publication job. A source ZIP download attempt was interrupted by browser closure; the separately generated source archive remains available. These corrections are not represented as successful tests of the failed download attempt.

## AI generation and remaining limits

Two earlier live AI generation attempts timed out after 12 minutes without a completed published app. An instrumented attempt observed first visible text 472,627 ms after its first request, across two generation requests. This is elapsed browser-test time, not isolated model latency. Only eight baseline files remained saved afterward. Diagnostics identified hosting quota exhaustion, and the test helper had selected the downloadable-app fallback. These attempts do not establish successful managed AI generation.

The prepared Task Board is a separately constructed acceptance app, not a successful AI-generated result. Email verification, intermittent refresh-recovery failures, and a fresh successful end-to-end AI generation remain distinct from platform deployment. Evidence is retained under `audit-artifacts/platform-audit-2026-09-24/`.

## Final hosted acceptance

The published task board opens its managed Google sign-in page, fits a 390-pixel mobile viewport, and produced no uncaught browser exceptions. Follow-up health requests returned 200 in 951, 406 and 330 ms; anonymous task requests returned 401 in 365, 323 and 332 ms. These small samples do not explain the initial 5.3-second health request or establish a latency percentile.

Production OAuth completion with a real Google account was not automated. Authenticated CRUD and isolation were exercised against the actual deployed verification artifact with disposable users and D1, and separately in the local browser suite. Google configuration and the live sign-in control were verified. The Google-only page also displays a generic unavailable-method notice because password sign-in is disabled.

Final evidence: `managed-publication/fullstack-live.json`, `managed-publication/hosted-check.json`, published screenshots, `final-release-validation.json` and `final-release.log`. Earlier source and runner failures remain documented; no claim of universal bug-freedom or successful AI generation is made.

## Email activation update — 16:12 UTC

The owner email is now verified. Production email, password signup/recovery and magic-link sign-in were enabled in the published Task Board. The live auth configuration confirms emailReady, passwordEnabled, magicLinkEnabled and googleReady are true, and the corresponding sign-in-page controls are visible. These live settings do not require a code redeployment. No test email was sent; provider readiness is not an inbox-delivery test. Evidence: `managed-publication/email-enabled.json`. This supersedes the earlier Google-only configuration and email-verification limitation.
