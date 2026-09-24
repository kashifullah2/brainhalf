# Agent, chat and preview repair

September 22, 2026. Changes are local and build on the pre-existing working tree. No deployment, commit, paid inference, or production mutation was performed.

## Repaired behavior

### Generation

- Updated tool input schemas and step limits to the installed AI SDK API. Behavioral tests exercise the real SDK with a mock model and real SQLite, including multiple tool steps.
- Preserve the full streamed answer across steps and save generated files before sending completion. Tool-only file changes count as output.
- Stop and timeout release stalled provider requests and generation locks. Failed requests can retry without being permanently rejected as duplicates.
- Workers AI handles fragmented UTF-8, provider error frames and the end-of-stream sentinel; unrelated failures no longer trigger token-limit retry storms.
- Preserve explicitly generated entry paths, apply file/edit/delete operations in order, treat replacement text literally and avoid replacing working files with incomplete output.
- Keep provider selection strict and remove older-model fallback retries. Explicit catalog aliases remain unchanged. Continuation notices no longer terminate a turn, and the client queues continuation until completion.
- Match implementation size to requested features and explain the runtime's actual capabilities in the system prompt.

### Chat and workspace files

- Queued prompts retain their user message during history hydration. Error/stop/unmount paths cancel pending token frames and sends.
- Server file events own file updates; chat parsing no longer replays edits or echoes generated files back into a competing write.
- Ignore redacted file updates without deleting locally held content. Clear Chat preserves files; Stop preserves completed writes.
- Negotiate server snapshots before uploading cached files on reconnect. Differing local applications remain intact until the user selects the server or local version.
- Check the current revision before accepting a local overwrite, serialize normal writes and preserve server-only secrets. Prompts on the new protocol use the server workspace rather than uploading another full cached copy.
- Preserve project identity for initial prompts and asynchronous callbacks.

### Preview

- Run plain HTML/CSS/JavaScript projects alongside React JSX/TSX projects, including local scripts, modules, CSS and SVG assets.
- Resolve dynamic, CommonJS and side-effect imports; load reachable dependencies and their declared versions/subpaths without creating a second React instance.
- Install API interception before generated React effects. Preserve Request/URL inputs, methods, headers, bodies and cancellation; leave unrelated remote APIs untouched.
- Report script, promise, dependency and render errors. Expected API validation failures remain available to the generated app's own UI.
- Reload HTML documents on updates to reset global declarations and event handlers. Embedded previews require a matching snapshot from their parent workspace.
- Maintain opaque-origin execution, platform API rejection and secret-file filtering. No same-origin sandbox permission was added.

### Simulated APIs and export

- Ordinary text mentioning a programming language no longer causes API requests to be rejected.
- Empty collections remain empty instead of silently creating sample records. Pagination validates input and returns the requested resource plus `items`.
- String/numeric aliases for record IDs cannot create conflicting records at the same URL. Repeated event submissions are preserved.
- Validate signup input, reject unknown-user login, prevent concurrent duplicate signups, issue distinct random sessions and prohibit generic session creation.
- Reject cross-organization writes and invalid order quantities. Failed order inserts leave stock unchanged.
- Validate root backend entry files. ZIP exports preserve TypeScript entries, existing Vite configuration and project README files, and avoid injecting React into plain HTML projects.
- Model test endpoints authorize their preview project and report syntax or persistence failures instead of advertising a successful preview.

## Runtime limits

The supported interactive preview is browser JavaScript: React JSX/TSX and HTML/CSS/JS. React dependencies share the runtime's bundled React instance. This does not establish support for every framework or arbitrary application.

Generated Node, Python, native/mobile, SSR, database-driver and package-script code needs an appropriate external execution environment. The built-in API simulator does not run arbitrary generated backend route implementations. CSS modules, `import.meta` and top-level `await` are not implemented in the module evaluator.

Preview storage and simulated API data are temporary. Reloading resets the document's local/session storage shim and backend state; IndexedDB access is unavailable in the opaque preview origin. Production authentication, persistence, integrations and deployment require separate verification.

Provider credentials, model access and catalog alias targets have not been verified against live inference. For example, the existing client name `claude-sonnet-6` maps to the configured Bedrock ID `us.anthropic.claude-sonnet-4-6`; a picker label is not proof of the provider's model version.

Deploy the matching client, preview bundle and Worker together to use the new synchronization protocol. Legacy servers retain legacy client behavior.

## Validation

- TypeScript, lint, production client/preview builds and whitespace checks pass. Wrangler 4.135.0 successfully compiles the Worker using `deploy --dry-run`; nothing was deployed.
- Full Vitest run: 621 passed, 2 failed out of 623. Both failures also occurred before this repair, in `src/__tests__/landing-unauthenticated.test.ts`: CSS text causes an auth-buttons string assertion to fail, and a scrolling assertion expects a literal `overflow: auto`. These unrelated assertions were left unchanged.
- The deployment-script test runner passes separately; `npm test` stops at the two Vitest failures before reaching it.
- Full local Playwright suite: 58 passed, including reconnect conflict resolution, rapid revision-checked saves, queued continuation, HTML/React preview recovery, API effects, account isolation and lifecycle checks. The platform model-picker check now uses its actual accessible `option` role and verifies exactly one selected model.
- Local browser tests use fixtures; they are not live model or production deployment verification. Provider credentials, external services and production behavior still require staging validation.
