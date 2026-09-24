# Platform validation — September 22, 2026

## Changes

- Cloudflare DeepSeek V4 Pro (`@cf/deepseek-ai/deepseek-v4-pro-0813`) is the explicit browser, server, and Cloudflare delegation-tool default. The identifier was verified against Cloudflare's live catalog and model documentation.
- Dahl MiniMax M2.7 was removed from the picker and server allowlist. Other provider credentials were preserved.
- Fixed the new-project preview 404: the preview iframe now waits for the server's authorized session history before requesting the project URL. Previously it raced the WebSocket's project registration. Failed authorization leaves the preview waiting and retains the selected project.
- Added regression coverage for preview startup and keeping the same WebSocket while switching Code/Chat tabs. Updated initialization checks to expect the authorization wait state.
- Corrected outdated theme assertions and an analytics-test cleanup race. The full browser suite uses the configured local origin (port 5173), as required by the preview security policy.

## Live model validation

Every selectable model received a real prompt through the production chat UI in a new private audit project. Each generated counter was tested in the platform preview: increment, decrement, negative values, reset, and reload persistence. No provider response was mocked. The test prompt requested a single JSX counter, which required the native tool-using models to reconcile that request with the TypeScript starter.

| Model | Provider | Generation and preview result |
| --- | --- | --- |
| DeepSeek V4 Pro | Cloudflare | Passed; approximately 24 seconds |
| GPT-OSS 120B | Cloudflare | Passed; approximately 24 seconds |
| Kimi K2.7 Code | Cloudflare | Passed; approximately 27 seconds |
| Qwen 3.8 27B | Cloudflare | Passed; approximately 25 seconds |
| Claude Sonnet picker option | Bedrock (`us.anthropic.claude-sonnet-4-6`) | Passed; approximately 34 seconds |
| Kimi K3 | Bedrock | Passed after exceeding the initial four-minute observation window |
| Atria Dawn Preview | Atria | Passed after exceeding the initial four-minute observation window |

Kimi K3 and Atria were initially recorded as unfinished after four minutes. Later server histories confirmed completion; a separate browser run verified their buttons and reload behavior. Their exact total generation times were not captured. A passing simple counter is not evidence that every complex prompt will succeed or that a generated backend runs in the hosted preview.

The live sweep reproduced the startup 404 for every fresh project. Successful runs opened one project socket during generation and another for the intentional reload; the slow runs kept one socket during the initial observation. The reported connection messages alone did not indicate a reconnect loop.

Sanitized evidence: [model-agent-validation.json](audit-artifacts/2026-09-22/model-agent-validation.json). Generated source, screenshots, and raw audit observations remain in `/tmp/brainhalf-model-agent-audit/`; authentication state is stored separately and is not included in repository artifacts.

## Automated validation

- 720 application tests and 9 deployment-tool tests passed.
- 86 complete workspace browser checks passed, covering account isolation, editing, snapshots, cancellation, recovery, export/publication controls, previews, project changes, responsive layout, and session behavior.
- All 20 public/account/analytics browser cases passed across the full run and focused analytics rerun. The initial analytics failure was a route callback outliving its test request context; cleanup now waits for active routes.
- Typecheck, lint, production build, and SEO checks passed (14 prerendered pages, 9 indexable URLs).
- A separate direct Cloudflare binding check generated valid React via DeepSeek streaming, and the generated app passed Chrome interaction checks.

## Verification limits

Google account consent and actual Resend email delivery were not exercised. Account and contact browser tests mock email delivery; server email tests use mocked Resend with real Registry SQLite. Generated Node servers/databases still require their own runtime; the hosted preview does not execute them.

## Final release

Deployed to `brainhalf.com` and `www.brainhalf.com`: version `5c3bde99-5095-4da0-b0ad-a30cad44f236`.

The post-deployment browser check created a fresh private project and used DeepSeek without changing the model picker. It completed generation in approximately 27 seconds, passed increment/decrement/reset and reload checks, and recorded **zero HTTP errors, zero agent errors, and zero browser runtime errors**. The preview startup 404 did not recur. Evidence is in [postdeploy-agent-validation.json](audit-artifacts/2026-09-22/postdeploy-agent-validation.json).
