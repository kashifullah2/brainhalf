# Full app publishing

Implemented for every signed-in project owner, with the existing usage limits. These changes are local; the platform and runtime have not been deployed during this task.

## Build from a prompt

Managed full-stack requests automatically prepare a Workers backend, D1 migration, production build script, backend tests and verification plan before the model customizes the app. The original frontend is preserved. Existing frontend tests also run alongside the added backend tests. Common app requests such as inventory, booking, CRM and task management trigger this setup without requiring the user to specify a database or framework.

The generator receives the prepared source and instructions to connect the frontend to real APIs and adapt the schema, tests and verification to the requested workflows. Existing server architectures and explicit standalone export choices are preserved. The normal ownership, availability, generation and hosting limits continue to apply.

## Publish behavior

- One click on the workspace Publish button starts the production `publish` job and opens its progress panel. The source is pinned when clicked. An active development preview is stopped automatically before publishing; an existing publish job is displayed without resubmission. Opening publication management from the project console does not publish anything.
- The server installs dependencies, builds once, runs configured tests, collects the artifact, and verifies it in a disposable development environment. Workers apps require a test script. `brainhalf.verify.json` defines app-specific API, database, permission and browser checks; older Workers apps retain the existing starter CRUD verification fallback.
- The same verified artifact is deployed with a separate production D1 database, additive migrations and managed service bindings. Enabled production authentication/email providers must be ready. Database and backend health checks run before activation.
- Successful activation and completed job status are committed together. Failed or cancelled candidates never replace the previous active release. Additive migrations already applied to production are retained even if later checks fail; production data is never replaced with development test records.
- Publishing survives closing the workspace, subject to the existing ten-minute job deadline. Progress, errors, cancellation and the confirmed public URL are visible in the publishing dialog.
- Later edits require publishing again. Taking the app offline removes the active production release and disables public frontend, API, authentication and storage routes while retaining the database and release history. Existing public preview links retain their own privacy control.

## Supported projects and access

Static builds must produce `dist/index.html`. Workers projects declare `brainhalf.runtime: "workers"` in `package.json` and produce `dist/` plus `dist-worker/index.js`. Health checks default to `/api/health`; a read-only API health path can be configured with `brainhalf.healthPath`.

Detected Node and other unsupported server apps are blocked from incomplete frontend-only publication. “Prepare backend for publishing” asks the existing project agent to convert the app while preserving its features and adding migrations, tests and verification. The owner must publish again after conversion. Conversion has not been exercised against a live model in this task.

`wrangler.runtime.jsonc` sets `RUNTIME_ACCESS` to `all`. Ownership checks, the runtime kill switch and infrastructure readiness remain enforced. Operator provisioning diagnostics keep their operator allowlist.

The three-hosted-project allowance is enforced per account, with an index migration for existing registrations. Existing account daily limits remain 30 jobs, 25,000 requests, 50 emails and 100 MiB of uploaded files. Existing per-project limits and shared concurrency limits (two sandboxes, one browser) remain enforced.

## Validation and rollout

- TypeScript, lint, production build and generated SEO checks pass.
- The main application Worker dry-run also passes after the automatic backend setup changes. Focused tests cover the one-click request, stopping previews, pinned source, account/generation changes, and reopening a live release without starting another job.
- Runtime suite: 63 tests pass, including real SQLite state, release activation, failed verification/health checks, cancellation, offline routes, missing frontend resources, per-account quotas and non-pilot access.
- Application suite: 922 pass; one generated Node HTTP/SQLite integration test fails in this restricted environment. An independent local listener check reports `listen EPERM`; this environment cannot bind localhost ports.
- Deployment script suite: all four test files pass.
- The Worker dry-run bundle passes with `--containers-rollout=none`. Docker is unavailable, so the container build is not validated here.
- Browser specs cover publication, reopening after completion, immutable source, offline controls, legacy preview privacy, ownership errors and mobile layout. They could not run because the local server cannot bind its port. An escalation attempt failed because automatic approval review returned a 404 service error; this was an approval-service failure, not a safety rejection.

Before rollout, run the browser specs and full container validation in a suitable environment, then deploy both the runtime and main application. Validate a real signed-in owner publishing a Workers app, exercising its API/database and configured providers, updating it, and taking it offline. No live cloud resources were created and no provider delivery or OAuth flow was claimed as tested by this task.
