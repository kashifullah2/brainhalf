# Platform audit and implementation plan

## Architecture inspected

- React 19 and Vite implement the IDE; component-local inline styles and a large global stylesheet both influence the UI.
- A Cloudflare Worker routes authenticated requests to per-project ChatAgent Durable Objects; SQLite stores project files and conversations. Registry, R2 backups and publication are separate concerns.
- The AI SDK handles tool-capable providers; Workers AI also supports text-based file operations. Existing write epochs protect against cancelled generations, but tool edits currently require whole-file replacement.
- An opaque-origin browser preview transpiles generated frontend modules. Its API simulator does not execute generated backend code. There is no provisioned process sandbox, migration runner or generated-project type-checking service.
- ZIP/GitHub exports preserve source. Existing backend scaffolding is JavaScript with an in-memory database and does not install its dependencies.

## Priorities and dependencies

1. **P0 — Honest execution and validation.** Stop describing syntax checks as compilation or a running backend. Make simulated APIs explicit rather than silently substituting them for generated routes. Preserve isolated preview security.
2. **P0 — Safe incremental edits.** Add exact, conflict-detecting edit tools; preserve unrelated source, reject ambiguous edits and syntax errors, and require inspection before overwriting existing files. Strengthen project-awareness and TypeScript guidance.
3. **P1 — Coherent product UI.** Keep the familiar split workspace, with quiet slate surfaces, teal reserved for primary actions, consistent sans/monospace roles, 4/8px spacing and usable touch targets. Replace decorative landing mockups with concrete project guidance, remove unavailable controls, improve mobile sizing and make runtime limitations visible where users need them.
4. **P1 — Functional full-stack starting point.** Replace the in-memory scaffold with a typed, exportable backend with a real database, migration, validation, authorization and run instructions. Preserve existing framework, application source and configuration. The runtime target is a product decision, not something to silently fake.
5. **P1 — Validation and review.** Exercise agent tools behaviorally; type-check/build and run the generated scaffold locally; cover responsive interactions and runtime states in browser tests. Review desktop/mobile screenshots after changes.

## Baseline and constraints

The previous repair passes 58 local browser tests, typecheck, lint and production builds. Vitest has 621 passing tests and two pre-existing landing assertions that inspect CSS text rather than rendered elements; this UI work will update the affected assertions to match behavior.

Before screenshots: `/tmp/brainhalf-before-{landing,landing-mobile,workspace,workspace-mobile}.png`. Audit fixtures never call paid inference or production APIs. The mobile layout animates from its desktop width, briefly clipping chat controls; controls also fall below comfortable touch sizes. Landing copy incorrectly promises automatic full-stack deployment without configuration.

No live credentials, paid infrastructure or deployment is assumed. Exportable source and local tests do not establish that arbitrary frameworks can run in the hosted browser preview. Remaining infrastructure or live-provider validation must be reported explicitly.

## Implemented

- Replaced the decorative landing mockup, glow and unavailable input controls with project guidance and a labelled creation action. Improved contrast, touch targets, mobile sizing, chat wrapping, progress styling and toolbar consistency. Kept the existing navigation and split-pane layout.
- Corrected copy, readiness logs and deployment settings: they no longer promise a running backend, a successful build, automatic deployment or a hardcoded framework. Clipboard success waits for the actual operation; pending destructive dialogs cannot be dismissed accidentally.
- Added exact incremental editing with complete-read and stale-file guards for tool writes. Text edits reject ambiguous matches. Generation instructions cover architecture discovery, strict TypeScript, real persistence, shared contracts and standalone routing rather than preview-only assumptions.
- Unified fresh workspace seeding around a strict TypeScript starter. Replaced the old memory-only backend scaffold with Node/SQLite, migrations, session authentication, authorization, validation, typed client code and tests. Untouched starter projects receive a connected account/items UI; existing UI and framework configuration are preserved.
- Disabled automatic API simulation in both browser interception and the edge API handler. Explicit demo mode survives filtered preview snapshots without exposing private manifest fields. The preview identifies temporary demo data versus backend-not-running status.

## Validation status

Generated frontend and backend type checks, generated frontend production build and real local HTTP/SQLite integration tests pass. Integration checks cover signup/login, invalid credentials, duplicate accounts, persistence through an independent database connection, CRUD ownership, CSRF origin rejection, bounded request bodies and logout. Model-tool tests exercise the installed SDK with mocked inference, including exact edits and concurrent file changes.

Final local verification completed successfully:

- `npm run verify`: platform TypeScript checks, 646 Vitest tests, 9 Node deployment-script tests, lint and production builds for the IDE and preview runtime.
- `npx playwright test --workers=1 --reporter=list`: all 62 Chromium browser tests passed, including responsive layouts, chat lifecycle, preview isolation, recovery, confirmation dialogs and explicit API simulation.
- `npm run wrangler -- deploy --dry-run --outdir /tmp/brainhalf-product-worker`: Worker compilation and binding inspection passed; nothing was deployed.
- `git diff --check`: passed.

Screenshots in `/tmp/brainhalf-after-*.png` show the reviewed desktop and mobile layouts. Nonfatal warnings remain for the large Monaco bundle and Node 22's experimental SQLite API. Browser tests use controlled local fixtures and model-tool tests use mocked inference; no live model inference or production deployment was performed.

The platform still needs an explicitly provisioned execution service to run arbitrary generated backends, install their dependencies or automatically execute their test suites inside the hosted workspace. The SQLite starter is a functional starting point, not a guarantee that any generated application or production integration is complete. Provider credentials, model availability and deployed behavior require staging verification.
