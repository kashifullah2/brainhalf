# Platform remediation — 23 September 2026

The seven audited issues have implementation fixes in this working tree. **Release validation remains incomplete because this environment cannot run the required localhost/browser/container checks. Nothing was deployed.** Existing unrelated work was preserved.

## Fixes

| Audited issue | Implemented behavior | Main files |
| --- | --- | --- |
| Project tools and the managed release journey were unreachable | Project actions → Project console exposes build, development preview, verification, confirmed production publication, rollback, database, uploads, authentication/email, custom providers, source history, monitoring, and AI usage. Publication requires a passing check for the same source revision; the server enforces it independently. Source-dependent actions wait for generation to finish. | `src/components/ProjectConsole.tsx`, `ProjectConnections.tsx`, `Workspace.tsx`, `TopNav.tsx` |
| Backend generation preceded discovery of unavailable hosting | Backend-intent detection checks account hosting availability before inference. Unavailable hosting requires an explicit downloadable-app choice; the server checks independently. Export prompts request a standalone backend with setup instructions. Checks are cancelled on Stop, project change, or unmount; the agent rechecks authorization after readiness waits. | `src/lib/generation-target.ts`, `src/components/ChatPanel.tsx`, `src/agent.ts`, `src/lib/system-prompt.ts` |
| Response completion was presented as application success | Model history labels response completion explicitly. Generation records save source revisions, and AI usage shows matching application verification separately from response outcome. Provider usage includes both Workers AI tool calls and the final stream without double-counting repeated totals. | `src/lib/model-reliability.ts`, `src/components/ProjectAgentUsage.tsx`, `src/lib/migrations.ts`, `src/agent.ts` |
| No durable account inference allowance; rate checks failed open | Owner-specific Registry objects atomically enforce 60 provider calls/day, 2,000,000 maximum output tokens reserved/day, and two concurrent generations. All projects, provider retries, SDK steps, delegated calls, and model tests share the allowance. Unavailable allowance/rate storage denies new inference. | `src/lib/ai-budget.ts`, `src/registry.ts`, `src/worker.ts`, `src/lib/model-tester.ts` |
| Release checks omitted browser/runtime validation and reproducible source | The guarded deployment command requires application checks, both local browser suites, container build, and fresh Worker smoke checks. It fingerprints source and built assets, rejects changed inputs, records the selected deployment target, and preserves an exact source archive including uncommitted app files. CI runs validation and retains evidence without deploying. | `scripts/verify-release.mjs`, `scripts/deploy.mjs`, `.github/workflows/validate.yml`, `package.json` |
| Sonnet picker label did not match its provider model | The visible label is Claude Sonnet 4.6. The historical client key remains compatible with stored sessions. | `src/components/ChatPanel.tsx`, `src/lib/models.ts`, `src/components/ProjectAgentUsage.tsx` |
| Project deletion left agent storage and ignored failed backup deletion | DELETE atomically revokes access and queues durable cleanup, returning 202 accepted. Registry alarms retry persisted runtime → agent → backup cleanup stages. Agent erasure stops generation, closes sockets, waits for in-flight backups, erases storage, and refuses later SQL writes. The dashboard reports pending/completed cleanup. | `src/lib/project-cleanup.ts`, `src/registry.ts`, `src/agent.ts`, `src/worker.ts`, `src/components/DashboardPage.tsx` |

## Verification evidence

Final results and logs are recorded in `audit-artifacts/platform-remediation-2026-09-23/`. `implementation-state.json` records the final source and built-asset hashes with `releaseVerified: false`; it is not a release approval receipt.

| Check | Result |
| --- | --- |
| Application Vitest suite | 870 passed; 1 HTTP/SQLite integration test could not complete in the restricted environment; 871 total across 86 files |
| Runtime Vitest suite | 46 passed across 2 files |
| Deployment/release/provisioning script tests | All 3 test files passed |
| Application and runtime TypeScript | Passed |
| Lint | Passed without warnings |
| Production build and SEO validation | Passed; Vite still reports large editor/PDF chunks |
| Main Worker fresh dry run | Passed; no deployment |
| Local browser discovery | 109 tests discovered across 11 files; discovery is not execution |
| Browser execution | Blocked: the configured local web server could not start |
| Real local Agent smoke | Blocked: `listen EPERM` on `127.0.0.1` |
| Runtime/container dry run | Blocked: Wrangler could not launch Docker |
| Runtime smoke/full release gate | Not completed; requires the container build and localhost access |

The application integration failure is the generated Node HTTP/SQLite test in `src/__tests__/product-quality.test.ts`. Independent local Worker execution also confirms the sandbox's localhost-listener restriction. This test was not removed, skipped, or changed to bypass that restriction.

An attempt to obtain normal unsandboxed validation through the approval mechanism failed before execution: the automatic approval-review service returned HTTP 404 from its configured API. This was a review-service failure, not a determination that the tests were unsafe. No bypass was attempted.

## Finish release validation

Restore the approval service or use a development/CI environment with Node from `.node-version`, localhost listeners, Chrome, network access for required build dependencies, and a functioning Docker daemon. Run:

```sh
npm ci
npx playwright install --with-deps chrome
npm run verify:release
```

The release command runs the required checks in order and stops on failure. Inspect browser traces/screenshots, resolve any actual failures, and rerun the full gate. A successful run produces `.release/validation.json` and `.release/source-<hash>.tar.gz`. Until then, this work must not be described as fully verified or ready for production.

## Operating details

- AI allowances protect resource use; they are not currency billing or actual token-usage totals. Each call reserves its maximum output, including failed calls. Daily allowances reset at midnight UTC. Crash leases expire after 15 minutes.
- Backend-intent detection is conservative and heuristic. Exported backends require the user's own hosting and configuration. Node apps support managed development builds/previews; managed production publication currently requires a Workers app.
- Source hashing normalizes file paths and uses deterministic ordering across environments. If an older verification hash differs, verify the current source again before publication.
- Deletion is asynchronous. A pending status means cleanup has not finished. Minimal ownership tombstones prevent reuse of deleted project IDs; completed cleanup status is retained for 30 days.
- Controlled browser fixtures check UI and request behavior. They do not prove live provider delivery, cloud provisioning, live resource erasure, or production publication. No live cloud resources were changed for this task.
