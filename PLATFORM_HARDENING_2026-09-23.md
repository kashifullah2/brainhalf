# Platform hardening and recovery — 23 September 2026

Main deployment: `5b415e06-2dcf-4c15-abfa-4472eb7c96ce`.
Runtime deployment: `84b97a1e-cae2-4209-8c07-06ec5f38307c`.

## Implemented

| Area | Result |
| --- | --- |
| Source exports | ZIP and GitHub share a filtering boundary. Private environment files, credentials directories, private keys and generated caches are omitted. Blank environment examples and deployment instructions are included. Recognizable inline credentials and conflicting file paths block export before a GitHub write. |
| GitHub | Private repositories by default, real default-branch discovery, preserved base tree, concurrent-update checks and non-force pushes. Tokens stay in memory and are cleared on dialog close/success; legacy browser storage is removed. |
| Live chat authorization | Tickets are tied to the originating login session. Every socket message rechecks session validity and project ownership. Active generations recheck subscribers every ten seconds; revoked subscribers are disconnected. Missing identity and registry failures deny access. |
| Secret boundaries | `.dev.vars`, npm/netrc configuration and AWS/SSH directories join the secret-file filter used by source readers, previews and agent context. |
| Agent context | Files mentioned in the request are prioritized, dependency/build output and lockfiles are excluded, per-file context and conversation history are bounded, and duplicate Workers AI source context is removed. Token-limit retries remain on the selected model and are capped. |
| Agent output | Assistant Markdown supports headings, lists, tables, links and code. Raw HTML, unsafe link schemes and automatic remote images are disabled. Existing file/edit/tool cards remain interactive. |
| Agent activity and repair | Project-local generation records retain provider-reported tokens and outcomes; unreported counts remain blank. Error repairs are limited to three per five minutes and two for the same error. Failed verification evidence can be sent to the agent only when its source revision matches. |
| Source recovery | Automatic pre-generation and manual checkpoints; file-change review; explicit restore confirmation; stale revision and active-generation guards; automatic pre-restore checkpoint. Secrets are excluded. Retention: up to twelve versions within 20 MB; each snapshot at most 4 MB and 500 files. |
| Database controls | Application-table paging; bounded displayed-row downloads; atomic, parameterized JSON record import; Cloudflare D1 recovery points and typed restore confirmation; undo point; environment/database/schema checks; publication evidence invalidated after data changes. Recovery points are exposed for seven days. |
| Monitoring | Per-environment request/error totals, response timing and recent requests. Only route categories, methods, status and timing are retained; no request bodies, arbitrary path values, cookies or query strings. |
| Workspace | Settings grouped into Overview, Database & files, Authentication & email, Source history and Monitoring. Device previews preserve actual 375px/768px widths and scale to fit; users can switch to 100%. Preview errors have a visible repair action. |
| SEO and cleanup | Added a prerendered full-stack guide with canonical metadata, internal navigation and sitemap inclusion. Fixed prerender dependency scanning of audit HTML. Excluded audit/build artifacts from application linting. Removed three byte-identical unused logo copies while retaining originals and audit evidence. |

## Verification

- Full verification before main deployment: 805 application tests, 45 runtime tests and 16 script tests; both typechecks, lint, builds and SEO artifact checks passed.
- The live build exposed a Workers-specific incompatibility with `redirect: "error"`. The corrected API client uses `manual`, refuses redirects and has a regression test. Final verification passed 806 application tests, 45 runtime tests and 16 script tests, both typechecks, lint, builds and SEO checks.
- Actual bundled agent in local workerd passed ticket redemption, forged-identity replacement, authenticated socket access, checkpoint save/review, stale restore rejection, restore and logout revocation for both HTTP and an already-open socket. No provider was called.
- Actual bundled runtime passed local workerd checks for service bindings, pilot admission, encrypted configuration, sessions, managed auth, captured development email, environment isolation, stop and deletion.
- Public SEO/account/analytics browser suite: 21 passed, including the new guide, hydration, no-JavaScript navigation and mobile themes.
- Main production read checks: guide HTTP 200, prerendered content and canonical, sitemap inclusion, private source HTTP 401 and noindex headers all passed.
- Live Cloudflare recovery passed 17 assertions including real app build/release, D1 creation, table inspection, identifier rejection, atomic import, saved recovery point, explicit confirmation, restore, exact undo, environment separation, hosted API health, sanitized request metrics and cleanup. An independent D1 listing was empty. The temporary operator bridge was stopped and its local access key file removed.
- Full workspace Chromium browser suite: **102 passed** (3.1 minutes), including database import/recovery confirmation, Markdown safety, viewport scaling, account isolation, source history, project closing and preview error handling. The initial run exposed stale dashboard/settings selectors, and a later run encountered a local build-directory race. The selectors and fixture were corrected; the dev server now returns a retryable response instead of crashing when the preview bundle is being rebuilt. Historical failure evidence is retained.
- Fresh `npm audit --json`: zero reported vulnerabilities across all severities. This checks known dependency advisories; it is not a guarantee of application security.

Evidence directory: `audit-artifacts/2026-09-23/platform-hardening/`.

## Practical limits and remaining roadmap

This pass does not make every proposed roadmap item complete. Team invitations/roles, custom customer domains, generic third-party integrations, GitHub repository import, long-term downloadable database backups, configurable alerts, account-wide AI budget enforcement and an unattended verify–repair loop remain separate work. No placeholder controls were added for them.

A displayed-row database download is a bounded view, not a complete SQL backup: binary or oversized values have explicit replacement labels. D1 recovery preserves the whole database, but managed auth users, email records and uploaded files are separate stores. Schema-changing restores require a reviewed migration plan.

Downloads contain no transferable BrainHalf hosting credentials. Standalone managed Workers apps need their own database resources and authentication/email/storage adapters. Blank provider keys alone do not recreate BrainHalf service bindings. The export guide explains this requirement.

Managed execution stays pilot-only and BrainHalf remains free. The pilot owner still needs to verify their BrainHalf account email to enable managed production sending. Actual Google consent and production inbox delivery require owner/provider validation. Search Console ownership verification and submission require access to the operator's Search Console account.
