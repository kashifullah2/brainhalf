# Browser release follow-up — 23 September 2026

**Latest status: all 12 tests in the three corrected spec files passed across two focused runs.** The user supplied the lifecycle/critical-remediation result (**7 passed in 28.6s**, 4 workers). The subsequent saved HTML report confirms managed-runtime (**5 passed in 19.2s**, no failures, retries or skips); its contents are archived in `browser-followup-latest.json`. This is focused regression evidence, not a new full-suite release result.

The user's completed `npx playwright test --workers=1 --retries=0` run reported **109 passed, 3 failed, 0 flaky, 0 skipped** in 398 seconds. These results were read from the saved Playwright HTML report. The report summary and failure contexts are archived beside this file before a rerun can overwrite them.

## Corrections saved after this run

| Failure | Cause | Correction |
| --- | --- | --- |
| Lifecycle: deletion, reload, mobile generation and reconnection | The previous test edit expected `/dashboard` after deleting the active project. Deletion selects the remaining project and updates the URL to `/dashboard?project=lifecycle-beta`; reload correctly opens that workspace. | Restore direct remaining-project URL/history/file-isolation checks through `assertProjectView`. Keep durable deletion, mobile generation and reconnection assertions. |
| Critical remediation: failed deletion and authenticated retry | The same incorrect `/dashboard` assertion after reload. | Check the remaining project ID and deleted files, navigate Home → Dashboard, then assert the remaining card is visible and the deleted card absent. |
| Managed runtime: delayed hosting check after switch | The delayed route returned only `enabled` and `availability`. New-project runtime polling consumed this response and attempted to read the absent `jobs` array. | Return a complete `RuntimeStatus` fixture with the requested project and environment, empty job/release arrays, capabilities and nullable resources. Keep cancellation and exact prompt-delivery assertions. |

The first two failures were introduced by an incorrect test expectation in the previous repair; the application behavior is preserved.

## Verified and pending

- Lint passed after these corrections.
- Playwright discovery found all 12 tests in the three affected spec files. Discovery does not execute browser assertions.
- The previous UI fixes for tool selection/rollback, mobile composer layout and project-console visibility, and authenticated dashboard fixtures passed in the 109-test result.
- Focused browser reruns have passed. The user's first command was split by a newline, so only lifecycle and critical-remediation ran; the remaining managed-runtime file passed separately afterward. The complete focused command is:

  ```bash
  npx playwright test tests/ai-ide-e2e-001-lifecycle.spec.ts tests/critical-remediation.spec.ts tests/managed-runtime.spec.ts --workers=1 --retries=0
  ```

- Full guarded release and live model inference remain unverified. The user already deployed the earlier model fixes under reported Worker version `49885a45-fb2a-47ec-b333-2eed45b308b7`; the later UI fixes still need a successful guarded deployment.

After these browser runs, the intentional preview URL import was annotated with `/* @vite-ignore */` to remove Vite's dynamic-import analysis warning. It remains a native browser import of the selected dependency URL.

This agent session cannot open local TCP listeners. Its previous expanded-access request failed before execution because the approval service returned HTTP 404. No new browser execution or deployment is claimed here.

Post-annotation validation: **13 preview tests passed in 2 files; lint and production build (including SEO checks) passed**. The build retains its existing large-chunk advisory. Logs: `/tmp/brainhalf-final-preview-tests.log`, `/tmp/brainhalf-final-preview-lint.log`, `/tmp/brainhalf-final-preview-build.log`. The annotation has not been deployed by this agent.
