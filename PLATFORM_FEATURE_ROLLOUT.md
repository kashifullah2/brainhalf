# BrainHalf feature rollout

Started 23 September 2026. Scope: the platform feature backlog authorized in this conversation. Preserve existing projects and source changes. Implement in dependency order, and distinguish working code from live service validation.

| Order | Workstream | Completion evidence | Status |
|---|---|---|---|
| 1 | Managed backend hosting and isolated D1 databases | Provision two projects and both environments, prove persistence and isolation, build/preview/publish the same revision, clean up test resources | Live pilot validation passed: two apps, six jobs, 40 verification checks, four isolated databases, production publication and cleanup; enabled for the selected account only |
| 2 | Google sign-in and email | Guided configuration, real Google consent, verified receipt of labeled email, platform signup/recovery checked separately from generated apps | Shared Google/Resend broker, hosted signup/reset/magic links, encrypted queue, templates, users and settings deployed for the pilot. 21 app-verification and 26 live-auth checks passed; Google authorization page reached. Owner email verification, actual Google consent and delivered production email remain. See MANAGED_AUTH_EMAIL_IMPLEMENTATION.md |
| 3 | App-specific verification and repair | Declarative app checks exercise actual routes, database writes, user permissions and UI; failed checks prevent publication | Verification and revision-matched repair handoff implemented; automatic verify–repair iteration remains pending |
| 4 | Usage metering and limits | Durable per-owner accounting, enforced limits and usage UI; payment subscriptions need configured provider and plan choices | Runtime counts/limits and per-project provider-reported AI activity implemented; account-wide AI budget enforcement remains pending; BrainHalf stays free |
| 5 | Managed uploads | Persistent project/environment-scoped R2 objects, authorization, limits, upload/list/download/delete UI and API tests | Implemented; local boundary/UI tests and live private R2 upload/download/list/delete with other-user denial passed in both pilot apps |
| 6 | Database management and recovery | Record browsing, import/export, migration review, verified backup/restore with explicit destructive-action confirmation | Table paging, bounded displayed-row downloads, atomic JSON import and D1 recovery/undo implemented and live-tested. Long-term full SQL export and schema-changing recovery remain pending. |
| 7 | Additional integrations | Project/environment-scoped API secrets, managed calls, payment/webhook validation with provider test credentials | Pending |
| 8 | Custom domains | Ownership verification, hostname routing, TLS readiness, attach/detach without affecting another project | Pending |
| 9 | Source history and GitHub sync | Checkpoints/diffs/restore plus repository import/push with branch/conflict protection | Checkpoints, file-change review, protected restore and private/conflict-safe GitHub push implemented. Repository import and line-by-line history diffs remain pending. |
| 10 | App monitoring | Request/error counters, retained logs, health and alert configuration with meaningful failure tests | Per-environment request/error totals, timing and privacy-filtered recent traffic implemented and live-tested. Configurable alerts remain pending. |
| 11 | Team collaboration | Invitations, acceptance, owner/editor/viewer enforcement across HTTP and sockets, revocation and audit trail | Pending |

## Live configuration inspected

- Wrangler authenticates to the configured BrainHalf Cloudflare account.
- Runtime secrets `PROJECT_SECRETS_KEY` and `CF_API_TOKEN` are installed. The current account-owned provisioning token verifies as active; D1 and dispatch-script listing return HTTP 200. The live app tests also proved database creation/query/deletion and generated Worker upload/deletion.
- Main platform has Google and Resend secret names. Their presence is not proof of working consent or delivered email.
- Resend's live domain listing confirms `brainhalf.com` is verified with sending enabled. No delivery test has been sent during this work.
- The private account lookup resolved the user's selected BrainHalf account to `usr_GjkBFAup0hlHmg1HJXRgtVdR`; it is the sole configured pilot owner. Runtime execution is enabled for this account in version `21861ca7-2e58-4678-b969-24085ec8604f`. Other accounts remain excluded.
- Wildcard app DNS and TLS were validated in the earlier rollout report; they are not new missing features.

The token mismatch has been resolved and live pilot validation passed. Do not request another token reinstall or pilot email. Both temporary apps were removed, their status now returns 410, and an independent Cloudflare D1 listing returned an empty list. See [the live pilot report](MANAGED_DATABASE_PILOT_2026-09-23.md).

The following token troubleshooting notes are historical:

The user subsequently reported selecting “All accounts.” The repeat read-only probe still showed active token / D1 401 / dispatch-script 403. The pending clarification is the exact permission names and access levels on the installed token. Account scope alone does not add service permissions.

The user later supplied the `brain_half` permission summary, then provided a rolled token described as `worker` and authorized installation/testing. Wrangler installed it through the masked prompt. The runtime and direct API tests both still show active token / D1 401 / dispatch-script 403. Token metadata access is denied, so the name mismatch is not independently confirmed. The next correction must apply permissions to the exact installed token, or securely install the token actually edited. No additional build, database, or deployment was started.

## Validation log

The current code passes local validation. Live provisioning and provider validation remain separate gates. Record commands, results, limitations, and deployed versions here as each workstream is completed.

- Successful pilot activation: current account-owned token passed private preflight. Two projects completed all six preview/verify/deploy jobs. Both apps passed 20 live checks including Browser Run writes confirmed in D1, CRUD/user isolation and private R2 storage. Four development/production databases preserved different values; preview-ticket replay, cross-project cookies, forged identity headers and unverified/changed-source publication were rejected. Cleanup succeeded for both projects; provider D1 listing independently confirmed no remaining databases. Runtime types regenerated and both typechecks passed. Evidence is in `audit-artifacts/2026-09-23/managed-database-pilot/`. No email was sent and no Google consent flow was completed.

- Initial baseline: 738 of 739 main tests passed inside the filesystem sandbox. The existing generated-app HTTP test passed when rerun outside the sandbox; its loopback listener requires that access.
- First verification tranche: 34 focused main tests and 20 runtime tests passed; typechecking passed; local workerd smoke checks passed. The unavailable-hosting browser check passed after excluding audit HTML captures from Vite dependency scanning and keeping the server verifier out of the frontend bundle.
- Runtime quota and file-storage tranche: 30 runtime tests passed with real SQLite state and controlled provider adapters, covering account limits, file permissions, environment separation, failure cleanup, and deletion during an active upload. This is not live Cloudflare provisioning or R2 validation.
- Runtime/container dry-run passed before the latest quota/upload additions; repeat it before deployment.
- Both managed-runtime browser checks passed: unavailable-hosting controls and owner usage/file download/deletion behavior.
- After token installation: `npm run verify` passed 764 main tests, 30 runtime tests, and 9 script checks, plus both typechecks, lint, build, and SEO checks. The browser-suite policy expectation was updated to include the newly reviewed managed-runtime fixture. The generated-app HTTP test required execution outside the sandbox. Evidence: `/tmp/brainhalf-pilot-activation-verify.log`.
- The latest `npm run runtime:check` container/Worker dry-run passed with Docker access outside the sandbox. `npm run runtime:smoke` then passed against that actual bundle in local workerd. Evidence: `/tmp/brainhalf-pilot-runtime-check.log`. No deployment, live D1 provisioning, or pilot activation occurred in this validation step.
- Pilot activation attempt: 765 main tests, 30 runtime tests and 9 script tests passed before the platform deployment. Live checks proved pilot denial, rejection of unverified production publication, real Sandbox dependency installation/build/SQLite tests/artifact collection, and project cleanup. D1 provisioning failed with HTTP 401 before a database was created; live database isolation, app uploads, Browser Run verification and production publishing remain unproven. Main version `c8660452-8f83-47e9-bb0c-d51c309e22a8`; final disabled runtime version `6c16b33d-fab4-4389-b5f0-7913b26d1a39`.
- Reinstallation retry repeated the live build successfully but D1 access still failed. The new read-only diagnostics distinguish active credentials from missing resource access while hosting stays disabled. Twelve focused tests, typechecking, lint, runtime build and local smoke checks passed. Latest disabled runtime version: `e38f4cd4-d9d9-4712-9f71-c63a1d258bb6`. Both disposable project attempts were cleaned up.

## Managed authentication and email completion

Main `4d590e85-deeb-451a-96fd-5ab41f4c3afe`; runtime `3fee8cd6-c00d-4e91-909a-723c77f41714`. Required verification passed 781 main, 42 runtime and 16 script tests, plus five Chrome checks and real workerd smoke. Live app verification passed 21 checks and the final HTTPS auth suite passed 26 checks. The provider broker and scoped generated-backend binding worked on Cloudflare. The pilot owner must verify their existing BrainHalf email at `/resend-verification` before managed production sending becomes available. No actual email was sent and no Google consent submitted during these tests. See [implementation details and evidence](MANAGED_AUTH_EMAIL_IMPLEMENTATION.md).

## Security and recovery deployment — 23 September 2026

See [the hardening report](PLATFORM_HARDENING_2026-09-23.md) for current deployments, tests, export boundaries, source/database recovery, UI and remaining work. Main `5b415e06-2dcf-4c15-abfa-4472eb7c96ce`; runtime `84b97a1e-cae2-4209-8c07-06ec5f38307c`. Live recovery and exact undo passed; disposable resources were deleted.
