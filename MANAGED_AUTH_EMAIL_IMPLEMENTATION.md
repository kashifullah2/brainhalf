# Managed authentication and email

Implemented and deployed for the existing BrainHalf managed-runtime pilot on 23 September 2026. General-user hosting remains gated. No provider secrets are placed in generated app files.

## Included

- BrainHalf-managed Google OAuth uses the existing registered callback, PKCE, browser-bound state, single-use handoffs and project/environment checks. Per-project Google credentials remain optional.
- Email/password signup, mailbox verification, password reset, magic-link sign-in, session/logout, user/admin roles and disabling accounts. Reset and disable revoke sessions; links expire after 30 minutes and require an explicit POST confirmation. Users are separate in each project/environment.
- Hosted sign-in at `/__brainhalf/auth`. Project Settings → Authentication & email controls methods, provider modes, app name, optional welcome messages, users, templates and the inbox.
- Six editable templates: verification, password reset, magic link, welcome, order receipt and contact. Template content is escaped before rendering HTML.
- Encrypted persistent email bodies, stable event idempotency, bounded retries and provider delivery-status polling. `Sent` records provider acceptance; `Delivered` requires a delivery event. Pausing email stops queued sending. Deleting a project drains in-flight work and removes stored records.
- Development captures email without calling a sending provider. Private test-inbox links open the correct preview; preview tickets store message IDs, not raw email tokens. Production inbox views redact authentication tokens.
- Generated Workers get `BRAINHALF_SERVICES` plus a project/environment-scoped capability. The platform’s Google and Resend credentials remain in the trusted provider Worker. Backend welcome/receipt events require a verified, active app user and a stable business-event key. Arbitrary recipients are rejected.
- Generated starter helper `worker/brainhalf.ts` and generation instructions explain the managed APIs, private D1 access, role checks, honest queue status and standalone-export requirements.

## Deployments

- Main platform: `4d590e85-deeb-451a-96fd-5ab41f4c3afe`.
- Managed runtime: `3fee8cd6-c00d-4e91-909a-723c77f41714`.
- Pilot allowlist and existing encryption key preserved. The final main deployment succeeded after retrying a transient Cloudflare AI-binding error (10021).

## Existing and new apps

New Workers releases receive the backend email binding automatically. Existing managed apps can use hosted authentication and contact routes immediately; create a new release to attach the backend transactional-email binding. Existing per-project provider connections select custom mode when settings are first initialized. No project source is silently overwritten.

Contact messages using BrainHalf email go to the project owner's verified BrainHalf account email. Custom Resend mode uses the configured contact destination. The owner-triggered labeled test goes only to the verified owner's address and shows its destination/message before sending.

Current pilot limits: 1,000 managed users per environment, 20 emails per environment/day, plus the shared account email quota. Retries reuse their event ID for quota accounting and provider idempotency. Active delivery work is retained; old completed history is pruned after 30 days while keeping the most recent 500 records. These are pilot limits, not a billing plan.

## Validation

- Required `npm run verify`: 781 main tests, 42 runtime tests, 16 script tests; typechecks, lint, build and SEO checks passed.
- Five Chrome tests passed for settings, methods, user controls, templates, captured message rendering, responsive layout and hosted authentication.
- Real local workerd passed service-entrypoint, signup, verification, replay rejection, password reset/session revocation, backend receipt capture, environment isolation and deletion checks, with external network disabled.
- Live disposable app passed 21 Browser Run/API/D1/R2 checks, including a generated Worker calling the new email service binding and capturing its receipt. See `audit-artifacts/2026-09-23/managed-auth-email/verify.json`.
- The final live runtime passed 26 additional HTTPS checks: signup, captured verification links, replay denial, password login/reset, session revocation, account disabling, magic-link login, environment/project user isolation, D1 writes and idempotent backend receipt capture.
- Chrome checked the deployed hosted sign-in at desktop and phone sizes, with no horizontal overflow or page errors. Google navigation reached the Google sign-in page with the registered callback and PKCE, without an OAuth configuration error. No Google login was submitted.
- Evidence and screenshots: `audit-artifacts/2026-09-23/managed-auth-email/`. Both disposable projects were removed, subsequent access returned 410, and an independent Cloudflare D1 listing returned `[]`. The operator bridge was stopped and its temporary connection credential removed. Cleanup is recorded in `cleanup.json`.

## Production account requirement

Live readiness reports Google configured and the shared sender as `support@brainhalf.com`. The pilot account `kashifullah919@gmail.com` is not marked email-verified in the live account database. Production managed email therefore stays unavailable for that owner until mailbox ownership is verified at [Resend verification](https://brainhalf.com/resend-verification).

No actual test email was sent by this implementation session. Successful provider delivery still requires a user-triggered test after account verification. Google authorization/PKCE can be checked without consent, but a real Google consent round trip remains a separate interactive validation. Do not describe either as completed solely because credentials are configured.

This supplies authentication and transactional email, not a payment processor or bulk marketing service. Standalone exports must configure their own authentication, provider services and deployment bindings.
