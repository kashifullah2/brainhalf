# App preview release — 2026-09-25

The workspace's embedded design preview cannot execute server code. Existing full-stack projects previously lacked a clear start action, and the toolbar opened the design-only URL even when a managed development app was available.

Changes:
- Add Start app preview, Update app preview and Open app preview controls with plain-language guidance for testing sign-in and saved data.
- Open a ready full-stack preview through its authenticated development ticket. Preserve the isolated embedded preview and the managed sign-in page's framing protections.
- Keep design refresh independent from the running app's availability.
- Give mobile guidance its own row above the controls, and show saved development releases as running even when an older preview job is stopped.
- Restore the start action after failed requests; report blocked popups before requesting a ticket; close pending preview tabs when switching projects.
- Only auto-start the backend after a completed generation. Loading a saved conversation must not start or rebuild a development app.
- Keep unsupported local API requests explicit: no simulated database writes or successful form submissions.

Regression coverage includes saved-project start, one development job with current source, toolbar and button navigation, popup blocking, project switching during ticket issuance, retry after failed requests, mobile layout, and existing automatic generation behavior.

Deployed main version `45c8cd07-4173-4ae2-ae71-8f265dcada27`, confirmed at 100% of production traffic. Hosting runtime `b4854308-5da4-495c-ac7e-a44476629545` remains at 100%; this release has no new runtime source changes.

Guarded validation passed: 981 application tests, 102 runtime tests, 36 deployment-script tests, 128 platform browser tests and 42 public-page browser tests. Both browser suites passed without retries. Type checks, lint, build, SEO validation, runtime dry build, local runtime/agent smoke tests, secret checks and release digest checks also passed.

Evidence: `audit-artifacts/preview-flow-2026-09-25/validation.json`, `deployment.json`, `deploy.log`, and `live-smoke.json`.

Live checks passed on the existing Task Board project: the workspace opens its managed development app, the real backend health endpoint responds, anonymous access to private records is denied, and email/Google sign-in controls load. Mobile guidance and actions fit the viewport, no browser page errors were observed, and the project source digest was unchanged. These checks do not claim email inbox delivery, completion of a Google OAuth login, load testing, or verification of every generated project.
