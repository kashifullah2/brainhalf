# App validation — September 23, 2026

Created **Harbor Notes**, a React/TypeScript notes app with real SQLite persistence, account sessions and an uploaded PNG. Source is in `app/`; `harbor-notes.zip` contains the runnable source without dependencies, build output or a populated database.

The app was assembled locally using BrainHalf's actual starter, backend generator, upload validator and asset generator. **It was not created through a live model or the browser composer.**

## Bug found and fixed

The upload tool emitted JavaScript URL modules without TypeScript declarations. Importing an uploaded image into a strict TypeScript app failed with TS7016 and prevented the app build.

`src/lib/builder-attachments.ts` now generates a matching `.d.ts` next to the asset entry point. A regression test uses the real ZIP exporter, compiles the extracted project, runs a Vite build and verifies that both preview imports and exported modules reconstruct the original image and a document spanning multiple chunks.

## Completed checks

| Check | Result |
| --- | --- |
| Harbor frontend TypeScript + production build | Passed; 20 modules built |
| Harbor backend TypeScript | Passed |
| Harbor handler suite | **22 passed, 0 failed; 77 requests** |
| Agent generation, builder service and uploaded-asset export tests | **38 passed** across 3 files |
| Preview-module asset regression added to the export test | Passed on rerun |
| BrainHalf app and runtime TypeScript | Passed |
| BrainHalf lint | Passed with an existing `no-control-regex` warning in `src/runtime/uploads.ts:82` |
| BrainHalf production build | Passed, including preview bundle, prerender and SEO checks |
| Tracked diff whitespace check | Passed |

The handler suite runs the real Node request handlers, request/response streams, scrypt password derivation, session storage, SQLite migrations and typed frontend API client through an in-process adapter. It does not listen on a network port.

Covered flows: migration idempotence; database health; registration and email normalization; valid/invalid login; duplicate accounts; hashed credentials; owner-scoped create/list/get/update/delete; committed data visible through a separate SQLite connection; account isolation; invalid/oversized JSON; origin checks; rate limits; logout and expiry; original image integrity. Expected 4xx responses are asserted. **No unexpected 500 responses or application server errors were observed.**

Machine-readable evidence: `handler-results.json`. Node 22's expected experimental SQLite warning is recorded separately. The main BrainHalf build also reports bundle-size and plugin-timing warnings; these are not build failures.

## Not verified

- Browser interactions, responsive appearance, console errors and real HTTP transport.
- A live model creating an app through BrainHalf's composer, actual remote MCP services, or pilot hosting deployment.
- Production behavior on brainhalf.com. These changes have not been deployed.

Playwright was attempted with `tests/agent-tools.spec.ts` and `tests/managed-runtime.spec.ts`. The local server requires permission in this environment. **Automatic approval review failed with HTTP 404 because its configured API deployment was unavailable; the requested command was not executed.** This was a review-service failure, not a finding that the action was unsafe. The boundary was not bypassed.

After the approval service is repaired, run:

```sh
npx playwright test tests/agent-tools.spec.ts tests/managed-runtime.spec.ts --workers=1
npm run verify
```

In the sample app, `npm run test:api` checks its actual HTTP listener. Follow `app/README.md` to start it and check registration, notes, search, reload persistence, logout and mobile layout in a browser. A successful build and in-process checks cannot guarantee an error-free end-to-end application.

## Logs

- `build.log`, `handlers.log` beside this report.
- `/tmp/brainhalf-upload-regression.log`
- `/tmp/brainhalf-upload-preview-regression.log`
- `/tmp/brainhalf-app-validation-typecheck.log`
- `/tmp/brainhalf-app-validation-lint.log`
- `/tmp/brainhalf-app-validation-build.log`
