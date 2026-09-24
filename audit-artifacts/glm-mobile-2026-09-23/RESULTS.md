# GLM model and mobile composer changes

These changes are saved locally. They have **not been deployed**, and no live app-generation result is claimed.

## Model addition

The installed official `@cloudflare/workers-types` catalog identifies the model as **GLM 5.3 Flash**, with the exact binding ID `@cf/zai-org/glm-5.3-flash`. Its types use `ChatCompletionsInput` / `ChatCompletionsOutput`. The platform now allows that ID and displays the correct variant name in the picker. The initial output cap is a conservative 8,192 tokens, not a claim about the provider's maximum. Vision is not enabled without verified image support.

Regression coverage verifies exact provider routing, rejection of an invented non-Flash alias, token capping, SSE handling and persistence of generated files. Mocked binding tests do not establish live Cloudflare account availability.

## Send/Stop on mobile

The composer reserves a separate grid column for its action button. Send and Stop share square dimensions and have 44px mobile hit targets. The model selector shrinks and truncates its text within the remaining space. Both controls stay within the composer's padding instead of extending through its right border.

The existing browser regression now checks button containment, square shape, minimum mobile size, prompt delivery and Stop delivery at 320, 360, 390, 768 and 1440px. The user ran this updated regression successfully: **1 passed in 27.8s** (8.9s test execution), covering all five widths and both button states:

```bash
npx playwright test -g "chat controls and content fit narrow" --workers=1 --retries=0
```

## Live app checks

The old multi-model spec seeds a development token and cannot validate authenticated production. The new `scripts/test-live-model-apps.mjs` runner opens Chrome at brainhalf.com for interactive sign-in, then creates one new task tracker per selectable model (eight entries including GLM). It never silently selects another model when an option is missing.

It checks the outgoing model/provider/project identity, generated file updates, a unique rendered app, task creation/completion/deletion, persistence after reload, mobile overflow, and composer buttons. Each model receives a result and screenshots; the test projects remain available through recorded project URLs. A partial or failed run exits unsuccessfully and preserves its report. The runner uses a real session without storing credentials on disk or recording auth headers or ticket URLs.

After passing the local browser check, deploy through the guarded command, then run the live suite:

```bash
npm run deploy
npm run test:live:apps
```

These are two sequential commands. Run the second only after deployment succeeds. Sign in through the Chrome window that the runner opens. Results are saved at `audit-artifacts/live-model-apps/<run-id>/results.json`.

## Environment limitation

The agent attempted to open brainhalf.com in Chrome, but Chrome failed at `setsockopt: Operation not permitted`. Fetching Cloudflare documentation failed DNS resolution. The expanded-access documentation request was not executed because automatic approval review returned HTTP 404 for its missing API deployment; this was a service failure, not an unsafe-action rejection. The user's normal terminal is required for deployment and browser execution while that limitation remains.

Validation: **77 model/related tests passed**, **3 runner evidence tests passed**, TypeScript and lint passed, production build including SEO checks passed, and the updated mobile browser regression passed in the user terminal. Existing build size/timing advisories remain. Full guarded release and live app generation remain pending. Logs are in `/tmp/brainhalf-glm-validation.log`, `/tmp/brainhalf-glm-typecheck.log`, `/tmp/brainhalf-glm-lint.log`, `/tmp/brainhalf-live-runner-tests.log`, and `/tmp/brainhalf-glm-composer-build.log`.
