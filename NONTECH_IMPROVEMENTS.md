# Brainhalf self-service improvements

Goal: make describe → preview → publish dependable for a nontechnical creator. Preserve existing projects, data, deployment guards and authorization.

Deployed in main 093cb357-69bf-4328-933b-94d6e8b169fa and runtime 93411930-4855-4ce4-9a81-6dee44055fd8 (both confirmed at 100%):
- Removed duplicate browser hosting preflight; added cheap authenticated server readiness.
- Added truthful generation stages and account-scoped browser timing without prompt/source storage.
- Enabled focused context by default while preserving explicit existing preferences.
- Honored optional reasoning settings on documented DeepSeek V4 Pro and GLM 5.3 Flash tool turns.
- Preserved tool results in the final response after the tool-round limit.
- Corrected frontend-demo/no-backend intent classification while preserving existing backends.
- Collapsed advanced settings and diagnostics, removed manually asserted publication success.
- Added explicit publishing repair action; repairs do not automatically republish.
- Hosted sign-in waits for configuration and clearly handles Google-only apps.

Validation: 979 application, 94 runtime, 36 script and 160 browser tests passed for the first rollout. No browser retries were needed in the final run. The lifecycle test was updated for server-side admission, and queued cancellation uses a controlled connection gate.

Live baseline: default model took about 6.3 minutes to its first tool call and did not complete within ten minutes. GLM comparison returned no app files after about three minutes and triggered recovery. Its old harness incorrectly treated an intermediate terminal event as completion; this is not successful app-generation evidence. No measured production speedup is claimed yet.

Existing published Task Board passed 18 publication checks, including CRUD and isolation. That app was prepared from factories, not produced successfully by this live AI journey. Email readiness passed; inbox delivery remains untested.

Live deployed evidence: a fresh default-model frontend app produced text after 3.550s, its first tool call after 5.186s, first files after 38.276s and completed after 102.265s. It needed a separate styling follow-up (89.413s). Its form validation, valid submission, mobile preview and workspace reload passed. These are individual samples, not latency guarantees.

Publication uncovered a capacity issue: one failed dependency-installation preview still occupied a hosted-project slot. A narrow recovery fix now preserves source/logs and releases only terminal pre-hosting build/preview attempts with no database, release or managed-user state; later failures remain reserved. All 102 runtime tests passed. Full guarded rollout and a live publication retry are in progress.

Final rollout: main `145d2aa9-91a2-4e09-bb15-6b89358a4973`, runtime `b4854308-5da4-495c-ac7e-a44476629545`, both confirmed at 100%. Final checks: 979 application, 102 runtime, 36 script, 121 platform-browser and 39 public-browser tests passed without browser retries.

Capacity recovery succeeded in production without deleting the failed project. The generated Cedar Cuts frontend demo published in 79.754s: https://deb260c733cb9b82876ea09cda516d76.apps.brainhalf.com . Public empty-field validation, valid confirmation, mobile layout and reload all passed. Requests are intentionally not sent or saved online; this frontend sample is distinct from the previously verified full-stack Task Board.

Evidence: `audit-artifacts/nontechnical-journey/final-release-validation.json`, `final-release.log`, `after-default.json`, `polish.json`, `generated-inspection.json`, and `generated-publication.json`. Remaining limits: first-prompt visual completeness still needed a follow-up; live speed measurements are individual samples; inbox delivery and concurrent-user load are not tested.
