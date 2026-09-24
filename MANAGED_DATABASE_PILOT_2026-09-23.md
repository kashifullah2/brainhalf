# Managed database pilot validation

## Current state

The selected BrainHalf account is configured as the sole pilot owner: `usr_GjkBFAup0hlHmg1HJXRgtVdR` (`kashifullah919@gmail.com`). The newly installed **account-owned provisioning token is active**, and live D1 and Workers for Platforms reads both return HTTP 200. Runtime execution is **enabled for this pilot only**. Two disposable apps completed development builds, real Browser Run verification and production publication. Both apps passed all 20 verification checks, and four separate D1 databases passed persistence/isolation checks. All test resources were cleaned up. The earlier permission failures below are historical; do not ask for another token reinstall.

Main platform version: `c8660452-8f83-47e9-bb0c-d51c309e22a8`.
Temporarily enabled runtime version: `c951f1b2-2118-4922-b157-3d68910d9b94`.
Latest enabled pilot runtime version: `21861ca7-2e58-4678-b969-24085ec8604f`.
Previous disabled runtime version, including read-only diagnostics: `e38f4cd4-d9d9-4712-9f71-c63a1d258bb6`.

## Activation after installing the correct token

- Private runtime preflight confirms the account-owned token is active and both D1 listing and dispatch-script listing return HTTP 200. User-token verification returns 401 because this is an account-owned credential; account-token verification succeeds. Non-pilot diagnostic access returns 403.
- Deployed the runtime with the existing pilot owner only. Non-pilot access remains unavailable, and unverified production publication returns 409.
- Fresh disposable project `pilot-validation-20260923-ready1-a`, job `223b9c6d-b502-4aeb-a6e8-e849d22c5e85`, passed real Sandbox installation, build, app SQLite tests, artifact collection, database creation/migration and development Worker deployment. Revision: `367eb41de337942f186f32fc6e4b1e2dcf8099602a4247d0ac439e91f26e562c`.
- Both projects completed preview, verification and production deployment: six successful live jobs. Verification job IDs: `f803d106-f264-4633-b6c4-bf96b3b4a919` and `b1d2ba52-0661-49f4-8732-a1da52f22d5d`. Production release IDs: `8c30864b-bf47-4f3c-86cf-55e31240ea80` and `7624913a-7421-42ca-a70a-f7750464ca24`.
- Each app passed 20 checks: page load; authenticated CRUD; direct D1 persistence/deletion; other-user denial; captured development contact message; private R2 upload/download/list/delete with user isolation; browser form interaction; and proof that the browser write reached disposable D1. There were no uncaught browser errors. These runs did not send email or complete Google sign-in.
- Independent HTTP checks wrote four different values and reread them successfully. Anonymous development preview access, replayed preview tickets, cross-project preview cookies, and forged app-user headers were rejected. Code changed after successful verification was rejected by the production gate with 409.

| Test project | Environment | D1 database ID before cleanup |
|---|---|---|
| A | Development | `4924b3d2-ced4-4755-bf03-5888ecce241a` |
| A | Production | `d02a6877-8648-4e64-9f6e-6b3e95b83ae2` |
| B | Development | `dec4ce74-1ca7-40f6-b108-587a79bd789b` |
| B | Production | `db54e31f-f290-4859-ade4-8f0e507210d9` |

- Cleanup of both test projects returned 200; subsequent project status returned 410. The cleanup path removed their deployed scripts, development/production databases, uploaded files and artifacts. A separate `wrangler d1 list --json` returned `[]`, confirming no databases remained in the account after the test. The verification databases had already been removed by successful job cleanup. Test project IDs are now tombstoned.
- The temporary operator bridge was stopped and its local operator credential removed. Runtime remains enabled for the configured pilot; the encryption key was preserved.
- Runtime types were regenerated for the enabled configuration, both TypeScript checks passed, and `git diff --check` passed. No runtime implementation fix was needed during this live test.
- The owner usage snapshot recorded eight daily jobs (including two earlier failed attempts), 51 metered requests and two contact operations. Both contacts were captured development messages, not sent emails; uploaded-file storage was zero after the tests. These counters are not a Cloudflare cost measurement and do not complete public-rollout metering.

Evidence: [verification reports and isolation values](audit-artifacts/2026-09-23/managed-database-pilot/evidence.json), [project A screenshot](audit-artifacts/2026-09-23/managed-database-pilot/project-a.png), [project B screenshot](audit-artifacts/2026-09-23/managed-database-pilot/project-b.png), [A cleanup](audit-artifacts/2026-09-23/managed-database-pilot/cleanup-a.json), [B cleanup](audit-artifacts/2026-09-23/managed-database-pilot/cleanup-b.json).

## Remaining rollout work

Managed Workers/D1 hosting is available to the selected pilot account. Real Google consent, delivered production email, cost measurement and general-user rollout remain separate work. This test used the generated Workers starter contract with an additional persistence probe; it does not prove arbitrary generated applications or Node production hosting.

## Evidence

- Pre-deployment checks passed: 765 main tests, 30 runtime tests, 9 script tests, typechecking, lint, build and SEO validation. The current runtime also passed its container dry-run and local workerd smoke test.
- Added a private Registry account lookup returning only account ID and email. It does not create sessions or return passwords. Tests cover normalization, invalid/missing accounts, and absence of a public lookup route; a live request to `/api/admin/account` returned 404.
- The authenticated operator preview resolved the supplied account without obtaining its password or signing in as the user. The temporary bridge required a random operator credential and was stopped after testing; its local credential file was removed.
- Live runtime status was ready for the selected pilot, while a non-pilot scope was denied. Production publication without same-revision verification returned 409.
- Disposable project `pilot-validation-20260923-a`, job `6e2f3263-5d07-47b6-ac2e-85763ed2f880`, ran real Cloudflare Sandbox dependency installation, application build, a SQLite-backed private CRUD/user-isolation test, and artifact collection successfully.
- Provisioning then failed: `Cloudflare GET failed (401)` on `/accounts/{account}/d1/database?name=...&per_page=100`. The reported database resource remained null. This does not identify whether the cause is an invalid, expired, revoked, incorrectly scoped or otherwise restricted token.
- Project deletion returned 200, cleaning its R2 artifacts and releasing the pilot slot. Its ID is tombstoned; use a new disposable project ID on retry. No generated Worker or D1 database had been provisioned.
- After the disabled runtime deployment, the test app hostname returned the expected HTTP 503 with `Runtime is temporarily unavailable.` over validated HTTPS.

Logs: `/tmp/brainhalf-pilot-main-deploy.log`, `/tmp/brainhalf-pilot-runtime-deploy.log`, `/tmp/brainhalf-pilot-app-a-preview.log`, `/tmp/brainhalf-pilot-runtime-disable.log`.

## Retry after token reinstallation

- Temporarily enabled runtime `ef674f49-dd84-432f-8804-7555c19cefe7` and used fresh disposable project `pilot-validation-20260923-retry1-a`. Job `765a6a69-5a82-4bb5-a2d4-45fc555dc95c` passed the real Sandbox build, SQLite app tests and artifact collection, then again received HTTP 401 from D1. Cleanup returned HTTP 200; this project ID is now also tombstoned.
- Added `/provisioning-check` to the private `RuntimeControl` entrypoint, limited to configured pilot owners and available while runtime execution is disabled. It makes only bounded, read-only provider calls and does not register a project, start a Sandbox, or expose token values, API messages, account contents or project names.
- Live result: `/user/tokens/verify` returned HTTP 200 with status `active`; D1 listing returned 401/code 10000; dispatch-script listing returned 403/code 10000. This establishes a valid credential denied access to the required resources, rather than a missing or expired credential.
- Diagnostic verification passed 12 focused tests, both typechecks, lint, runtime/container dry-run, and local workerd smoke checks. Live diagnostic access for non-pilot accounts was checked separately.
- Latest code is deployed with `RUNTIME_ENABLED=false` and the pilot ID preserved. New token checks can now run without re-enabling hosting or repeating the paid Sandbox build.

Retry logs: `/tmp/brainhalf-pilot-retry1-a-preview.log`, `/tmp/brainhalf-pilot-runtime-retry1-deploy.log`, `/tmp/brainhalf-provisioning-runtime-check.log`, `/tmp/brainhalf-provisioning-types.log`.

## Historical token setup troubleshooting (resolved)

The user confirmed the edited token is **`brain_half`**. The most recently supplied value was described as a rolled **`worker`** token, explaining a likely mismatch; Cloudflare has not allowed reading that token's dashboard name. A fresh private runtime preflight still returned active token / D1 401 / dispatch scripts 403, and non-pilot diagnostic access remained denied. The temporary bridge was stopped and its operator credential file removed.

Prepared `scripts/setup-provisioning-token.mjs` so the user can supply the correct `brain_half` value directly in a hidden local terminal prompt:

```bash
node scripts/setup-provisioning-token.mjs
```

The command resolves canonical permission IDs, scopes the new `brainhalf-runtime-provisioning` account token to D1 Write and Workers Scripts Write for this account, checks the new credential, and installs it with pinned Wrangler as the runtime's `CF_API_TOKEN`. It does not store the input credential, return either token value, enable hosting, or change the encryption key. It refuses to create a second token with the same name, removes only its newly created token if service checks fail, and preserves a token if a secret-write outcome is uncertain. If the `brain_half` value is no longer available, roll that named token in the dashboard and enter the new value locally. Do not share it in chat. Temporary token-administration permissions on `brain_half` can be removed after successful setup.

Validation: all seven focused setup tests passed, syntax checking passed, and lint completed with existing warnings in unrelated files. A real PTY check confirmed input was hidden and cancellation made no API calls. The live token-creation and installation path has **not** run because the current `brain_half` credential is unavailable to this session. No new token or database has been created. After the command succeeds, rerun the private runtime preflight and the pending live pilot validation.

Follow-up after the user supplied permission entries including both account and user API Tokens: the latest supplied credential still verifies as active (HTTP 200), while D1 listing returns 401/code 10000, dispatch-script listing returns 403/code 10000, and both account/user token-administration reads return 403/code 9109. The earlier supplied credential returns HTTP 401 from token verification. Neither credential currently provides a usable route to create the dedicated token. The supplied permission list does not show access levels or prove that the changes were saved to the same token. Confirm whether the user edited `brain_half` or `worker` before requesting another rotation/reinstallation. No token, database, or deployment was created during these checks; runtime remains disabled.

Latest authorization check, 2026-09-23: the user explicitly authorized creating a provisioning token. The saved Wrangler OAuth login and the most recently supplied API token both received HTTP 403/code 9109 from the account-token permission-group and token-list endpoints. Earlier user-token administration checks were also denied. `wrangler login --scopes-list` does not offer API-token administration, so logging in again with Wrangler cannot supply this permission. No token was created and no runtime setting was changed by these checks.

For agent-managed creation, the account owner must temporarily add **Account → Account API Tokens → Edit**, scoped to BrainHalf account `12fc31472161e3ebb8a01b4722ec1725`, to the exact API token most recently supplied. Save the policy without rolling the value. Cloudflare requires Super Administrator authority to create or update account-owned tokens. After that authorization is available, create a separate `brainhalf-runtime-provisioning` account token with only **D1 Write** and **Workers Scripts Write**, install its value directly as `CF_API_TOKEN`, and validate service access before enabling the pilot. Remove the temporary token-administration permission afterward. Do not put the token value in chat. This is a Cloudflare authorization prerequisite, not a request to approve work already authorized by the user.

Sources: [Cloudflare token creation via API](https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/), [account token creation permissions](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/create/), and [account-owned token requirements](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/). Both D1 and Workers are listed as supporting account-owned tokens.

Latest follow-up: the user supplied a newly rolled token and explicitly authorized installation/testing. It was installed as `CF_API_TOKEN` using Wrangler's masked prompt; the value was not written to source or a local credential file. Both the deployed runtime diagnostic and direct API requests returned active token / D1 401 / dispatch-script 403. The direct test rules out a denial specific to requests from the runtime. Token metadata and permission-definition reads were denied (403/code 9109), so the installed token's dashboard name could not be independently confirmed. The supplied permission summary was named `brain_half`, while the user said they rolled `worker`; this is a possible token mismatch. Apply D1 Edit and Workers Scripts Edit to the token actually installed, or securely install the token whose permissions were edited. Rolling a token changes its value, not its permissions. No database provisioning or new runtime deployment occurred in this follow-up; hosting remains disabled.

After the user reported selecting “All accounts,” the same read-only checks still returned active token / D1 401 / dispatch-script 403. “All accounts” changes resource scope; it does not add D1 or Workers Scripts permissions. The user has now been asked to copy the permission names and access levels from the exact installed token, without sharing its value. Runtime remains disabled; this diagnostic-only check did not provision resources or deploy changes.

Edit the same active token at Cloudflare → My Profile → API Tokens. Add Account → D1 → Edit and Account → Workers Scripts → Edit, and include the BrainHalf Cloudflare account `12fc31472161e3ebb8a01b4722ec1725`. Save the permissions and reply “permissions updated”. Reinstallation is needed only if the token value is rolled or replaced:

```bash
npm run wrangler -- secret put CF_API_TOKEN --config wrangler.runtime.jsonc
```

Do not put the token in chat, source, or shell arguments. Preserve the existing encryption key and configured pilot owner. Run the private read-only provisioning check first. Once service access works, retry with fresh disposable project IDs and validate two projects' separate development/production databases, Browser Run checks, managed R2 uploads, production publication and cleanup. Google consent and delivered email remain separate uncompleted live checks.
