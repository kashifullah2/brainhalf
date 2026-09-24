# Agent workflow changes — September 23, 2026

Implemented locally; not deployed. Preserve the existing shared, dirty working tree.

## Changes

- Removed the entire ProjectSettings component and stylesheet, its entry point, manual backend scaffolding controls, and the demo-API banner/confirmation flow.
- Both preview paths ignore legacy demo flags and return BACKEND_NOT_RUNNING rather than fabricated API success.
- Added Agent tools beside the chat composer: HTTPS Streamable HTTP MCP connections, discovered tool selection and enablement, skills entered/imported from Markdown/text, and a private upload library.
- MCP uses the official SDK, owner/project-scoped encrypted bearer credentials, public HTTPS checks, same-origin/no-redirect transport, timeout/response limits, selectable tools, and permission rechecks immediately before invocation. New connections start disabled. Credentials do not enter model context, client storage or exports. OAuth-only/local stdio servers are not supported.
- Added private uploads of PNG/JPEG/WebP/GIF, selectable-text PDF, DOCX main-document text, Markdown and UTF-8 text/source/CSV files. Five files per message, 5 MB each; project library limit 30 files/30 MB. Text excerpts are bounded to 120,000 characters; PDF limit 100 pages. Scanned/encrypted PDFs and unsupported binaries produce actionable errors. OCR is not implemented.
- Documents reach inference as bounded excerpts plus a paged read_attachment tool. use_attachment copies requested original bytes into portable JS URL modules for preview/ZIP/GitHub export. Private references are not automatically exported. Asset chunk bodies are excluded from baseline model context.
- Actual image parts reach verified vision models (Kimi K2.7 Code and the existing Claude Sonnet picker option). Other models can place an image in an app but receive an explicit instruction not to claim visual analysis; the composer explains model selection.
- Enabled skills and selected MCP tools apply to native AI SDK and Cloudflare Workers AI paths. Added a bounded real function-call loop for Workers AI, without model substitution. Cancellation and existing write-epoch controls protect source writes. Tool output is treated as untrusted data.
- Schema migration 6 adds builder attachments, MCP and skill storage to each project agent.
- Successful backend generations automatically request a development preview job only when managed hosting is ready. Pilot gates remain intact. No production job is started automatically. The workspace displays status, retry on failure, and Open running app for actual development releases/ready Node previews.
- Running Node previews are replaced when newer source needs a build. A conditional expectedJobId stop prevents an update from stopping a different runtime job. Preview readiness is explicit in runtime job status.
- Updated runtime error messages, starter documentation, and public guide text to remove obsolete settings-screen directions.

## Validation

- npm run typecheck: passed (application and runtime).
- npm run lint: passed; one pre-existing no-control-regex warning in src/runtime/uploads.ts.
- npm run build: passed, including prerender and SEO/cache checks.
- 54 focused application tests passed across agent generation, real mocked MCP transport, attachments, skills, transcript and browser policy. Includes actual installed AI SDK and Workers AI binding mock integration for asset use, cancellation, credential encryption and project isolation.
- 46 runtime tests passed, including conditional job-stop protection.
- Both script-test files passed with node --test scripts/__tests__/*.test.mjs.
- Full application run: 824 tests; 822 passed, two failed initially. The browser policy count was updated for the added fixture suite and its seven tests passed afterwards. The sole remaining application failure is the generated-app HTTP/SQLite integration test, whose local listen() is denied by this sandbox. A direct diagnostic confirms `EPERM: listen EPERM: operation not permitted 127.0.0.1`.
- Playwright discovers 103 local scenarios, including new PDF/DOCX/Markdown/image/MCP/skill and automatic-backend flows. They have NOT run: the sandbox prevents its development server from starting. No new visual screenshot is verified.
- npm run check:secrets is a remote Wrangler deployment-configuration check, not a local source scan. It could not complete in this environment; do not report deployment credentials as validated.
- npm install reported one high advisory; no audit fix was applied or advisory attribution verified.

## Required finish after environment approval is repaired

1. Run `npm run verify` outside the sandbox to allow the generated backend's localhost listener.
2. Run `npx playwright test tests/agent-tools.spec.ts tests/managed-runtime.spec.ts tests/workspace-clarity.spec.ts tests/audit-remediation.spec.ts tests/edge-preview-remediation.spec.ts` with permission to start the local server and Chrome; fix any failures and inspect new screenshots.
3. Run the read-only deployment secret-name check if deployment preparation is requested.
4. Deployment and paid/live provider tests were not authorized or performed.

Escalations for both full verification and Playwright were attempted. Automatic approval review failed with HTTP 404 because its configured API deployment was unavailable. The commands were not executed; this was a review-service failure, not an unsafe-action determination. Do not bypass the approval boundary.

Logs are under /tmp/brainhalf-agent-*.log. Latest build: /tmp/brainhalf-agent-final-build.log; focused tests: /tmp/brainhalf-agent-final-focused.log; runtime: /tmp/brainhalf-agent-final-runtime.log; full application: /tmp/brainhalf-agent-final-app-tests.log.

## Sample app validation follow-up

The user requested creating one app and checking for errors. Created Harbor Notes locally from the real TypeScript/backend starter and upload module generator. Source, a source ZIP and results are in `audit-artifacts/2026-09-23/agent-workflow-app/`; see `VALIDATION.md`. This is an explicit local fixture, not a live-model generation.

Found and fixed a real upload build bug: `attachmentModules` now supplies a sibling `.d.ts`, so strict TypeScript projects can import uploaded assets. Added `src/__tests__/attachment-export-build.test.ts`, which checks the real preview loader, ZIP export, extracted project compilation/build and original bytes (including multi-chunk documents).

Harbor frontend/backend typechecks and frontend build passed. Its 22 in-process checks made 77 real handler requests against temporary SQLite with no unexpected 500s or application errors. Agent generation, builder service and attachment export: 38 tests passed. BrainHalf typecheck, lint and build/SEO passed again. Expected Node SQLite, existing lint and bundle warnings are documented.

Browser/server escalation was attempted again and still failed at automatic approval review with API-deployment HTTP 404. HTTP transport, browser behavior, live model generation and deployment remain unverified. Do not present the in-process handler adapter as browser or HTTP listener coverage.
