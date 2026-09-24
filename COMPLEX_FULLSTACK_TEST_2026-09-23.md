# Waypoint full-stack test — 2026-09-23

Created and tested **Waypoint**, a team travel planner with shared trips, seat reservations, cancellation, expenses, saved destinations, contact submissions, and an owner-only audit log. The repaired app passes **27 API/database checks and 14 browser checks**. TypeScript, production build, focused lint, and whitespace checks pass.

The app runs locally against real Cloudflare workerd and persistent D1/SQLite. Contact requests run through BrainHalf's actual runtime handler and Durable Object SQLite inbox. Authentication uses explicit local Alice/Bob/Eve fixtures. This establishes local full-stack behavior; hosted provisioning, Sandbox jobs, generated-project deployment, Google consent, and outgoing email remain unverified. BrainHalf's hosted runtime was not enabled or redeployed.

## Run it

From `/home/kashifullah/brainhalf`:

```bash
node scripts/trip-planner-harness.mjs
```

Open **http://127.0.0.1:8791/__test/** and choose a test identity. Alice can create a trip and invite `bob`; Eve remains an outsider unless invited. The server binds only to loopback and persists data under `/tmp/brainhalf-trip-demo-state`.

[Reviewed application source](audit-artifacts/2026-09-23/trip-planner/app/README.md) · [Source ZIP](audit-artifacts/2026-09-23/trip-planner/waypoint-source.zip) · [Desktop screenshot](audit-artifacts/2026-09-23/trip-planner/screenshots/reviewed-1440.png) · [Mobile screenshot](audit-artifacts/2026-09-23/trip-planner/screenshots/reviewed-390.png)

## What the tests established

| Area | Evidence |
|---|---|
| Last-seat competition | Twelve concurrent requests produce one reservation and eleven conflicts. |
| Duplicate submissions | Ten concurrent identical booking requests produce one booking and one audit event; expense retries also avoid duplicate charges. |
| Lost response | Chrome loses a successful booking response, retries with the same key, and recovers without reserving another seat. |
| Cancellation | Concurrent repeated cancellation releases seats once. Reusing the original booking key returns the cancelled booking. |
| Access control | Anonymous/header-spoofed callers, outsiders, cross-trip identifiers, and unauthorized member actions are rejected. Standalone Worker access fails closed without managed identity configuration. |
| Stale changes | Two simultaneous renames produce one winner and one HTTP 409; the browser preserves an unsaved conflicting title. |
| Database rollback | Injected audit failures undo booking, cancellation, and expense changes. Failed owner-membership insertion leaves no orphan trip. |
| Persistence | Booking data and the captured contact inbox survive complete Worker/HTTP-server shutdown and recreation. |
| Money and validation | Integer cents sum exactly. Fractional seats/cents, invalid numeric types, oversized bodies, malformed JSON, and invalid idempotency keys are rejected. |
| Browser behavior | Create/reload, invitations, booking, cancellation confirmation, expenses, audit, and contact work over HTTP. Saved quote/HTML text does not create executable DOM. |
| Layout | Screenshots at 1440, 390, and 320 pixels show no horizontal overflow; desktop/mobile screenshots were visually inspected. |

Detailed results: [API/database](audit-artifacts/2026-09-23/trip-planner/api-results.json), [browser](audit-artifacts/2026-09-23/trip-planner/browser-results.json), [platform contract](audit-artifacts/2026-09-23/trip-planner/platform-contract.json).

## What needed repair

The untouched generated backend initially passed **18 of 25** checks. The original UI passed **6 of 14** browser checks. These failures share causes; the counts are not counts of distinct defects. Two additional rollback checks were added for the repaired backend.

- The broad trip-detail GET route intercepted the audit route. It now matches only the exact detail path, allowing the owner check to execute.
- The generated schema used data-changing triggers rejected by BrainHalf's pilot migration gate. The reviewed version uses additive tables/indexes, conditional SQL, and atomic D1 batches for capacity, bookkeeping, and audit records.
- Membership count was incorrectly limited by booking capacity, preventing two members from competing for a single seat.
- `null` JSON caused a server error; the body reader now validates JSON objects and bounds bytes while streaming.
- Retry handling now resolves existing booking/expense keys within atomic operations and validates key characters.
- Browser number parsing silently rounded fractional seats and fractions of a cent. These inputs are now rejected.
- Cancellation lacked confirmation, and members saw controls for other people's bookings. The UI now provides an in-page confirmation and appropriate controls.
- The contact UI checked nonexistent boolean properties instead of the runtime's `status`. It now distinguishes captured messages from provider acceptance without claiming delivery.
- HTML escaping did not protect quoted input attributes. Saved titles now preserve quotes and cannot inject attributes. Dynamic controls now have persistent visible labels.
- The package advertised typechecking without a TypeScript configuration or Workers type dependency. Both are now present and the build includes typechecking.

[Original source](audit-artifacts/2026-09-23/trip-planner/original/README.md), [initial API results](audit-artifacts/2026-09-23/trip-planner/original-api-results.json), and [initial browser results](audit-artifacts/2026-09-23/trip-planner/original-browser-results.json) are preserved separately from the reviewed app. The baseline backend extracted during streaming was byte-compared with the completed original output.

## Generation and scope

The source was generated by Cloudflare's configured DeepSeek model with BrainHalf's actual system prompt, then extracted using BrainHalf's actual file parser. It was **not** created through a signed-in hosted ChatAgent session. Generation, runtime provisioning, and browser execution are separate claims.

The successful generation took 441 seconds and reported 3,789 input tokens and 16,023 output tokens. An earlier non-streaming attempt timed out; a streaming attempt without disabling extended reasoning was stopped after five minutes without app content. Those first attempts used different harness settings from BrainHalf's existing generation path, which already disables extended reasoning; they do not establish a hosted BrainHalf regression. [Attempt record](audit-artifacts/2026-09-23/trip-planner/attempts.json).

No new cloud databases, cloud Workers, production projects, or email messages were created during this test. The Cloudflare model call was live; the app's Worker/database/browser tests were local. API credentials were read from the existing Wrangler login and were not written into the app or report.

Remaining limits: trip/destination creation does not have replay protection after a lost response; booking/expense creation does. Browser retry keys are held in memory and are not retained across a full page reload. This is a tested reference app, not proof that every arbitrary generated app works automatically.

## Reproduce verification

```bash
# Rebuild the runtime bundle if /tmp/brainhalf-runtime-build/worker.js is absent.
npm run runtime:check
npm run build --prefix audit-artifacts/2026-09-23/trip-planner/app
node scripts/prepare-trip-fixture.mjs
node scripts/test-trip-planner.mjs
node scripts/browser-test-trip-planner.mjs
```

Chrome and the repository dependencies are required. The tests create their own temporary databases and never call cloud provisioning or email providers. Expected database errors in the fault-injection cases are intentional assertions of rollback.
