# Waypoint - Team Travel Planner

A full-stack team travel planning application built on Cloudflare Workers and D1.

## Architecture

- **Frontend**: Plain HTML/CSS/browser ES modules (no framework, no CDN dependencies)
- **Backend**: Cloudflare Worker with TypeScript
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: Managed by BrainHalf runtime (Google sign-in)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the application:
   ```bash
   npm run build
   ```

This creates:
- `dist/` - Frontend assets (index.html, app.js, styles.css)
- `dist-worker/` - Bundled Worker (index.js)

3. This source targets BrainHalf's managed runtime. Its deployment must provide D1 binding `DB`, strip incoming identity headers, and inject a verified `x-bh-user-id`. Do not expose the backend directly with `BRAINHALF_MANAGED=true`: that setting is for the trusted dispatcher. A standalone deployment needs its own authentication gateway and integration routes.

4. When the BrainHalf pilot is enabled, configure Google and Resend credentials in the project's Settings separately for development and production. The local tests below use controlled identities and captured contact messages; they do not validate Google consent, cloud database provisioning, or email delivery.

## Run and test locally in the BrainHalf repository

From the repository root, after installing its dependencies:

```bash
npm run runtime:check
node scripts/prepare-trip-fixture.mjs
node scripts/test-trip-planner.mjs
node scripts/browser-test-trip-planner.mjs
node scripts/trip-planner-harness.mjs
```

Open `http://127.0.0.1:8791/__test/` and choose Alice, Bob, or Eve. These are explicit local test identities. The harness binds only to loopback, runs the real Worker and persistent local D1, and forwards contact submissions to BrainHalf's actual local runtime inbox. Data persists across restarts. No cloud services or email providers are called by the harness. The browser test requires Chrome.

The hosted BrainHalf runtime remains disabled until its provisioning token, pilot owners, and live validation are configured. This app was generated through the Cloudflare API using BrainHalf's system prompt and file parser, then repaired and tested locally; it was not created through an authenticated hosted ChatAgent session.

## API Endpoints

### Public
- `GET /api/health` - Health check

### Items (Saved Destinations)
- `GET /api/items` - List user's saved destinations
- `POST /api/items` - Create destination `{title}`
- `DELETE /api/items/:id` - Delete destination (owner only)

### Trips
- `POST /api/trips` - Create trip `{title, capacity, budgetCents}`
- `GET /api/trips` - List owned/member trips
- `GET /api/trips/:id` - Get trip detail with members, bookings, expenses
- `PATCH /api/trips/:id` - Update trip `{title, version}` (optimistic locking)
- `POST /api/trips/:id/members` - Add member `{userId}` (owner only)
- `POST /api/trips/:id/bookings` - Book seats `{seats}` with Idempotency-Key
- `PATCH /api/trips/:id/bookings/:bookingId` - Cancel booking `{status:'cancelled'}`
- `POST /api/trips/:id/expenses` - Add expense `{description, amountCents}` with Idempotency-Key
- `GET /api/trips/:id/audit` - Get audit events (owner only)

### Auth (Managed by BrainHalf)
- `GET /api/auth/session` - Get current session
- `GET /api/auth/google/start` - Start Google sign-in
- `POST /api/auth/logout` - Logout

### Contact
- `POST /api/contact` - Send contact form `{name, email, message}`

## Key Features

- **Concurrency-safe bookings**: Conditional SQL and D1 batches enforce capacity atomically
- **Idempotency**: Booking and expense creation support Idempotency-Key for safe retries; cancellation is idempotent. Trip/destination creation is not protected against replay after a lost response.
- **Optimistic locking**: Trip updates use version compare-and-swap
- **Audit trail**: Booking/expense changes and audit events commit in the same D1 batch; injected audit-write failures are tested to roll back the entire operation
- **Owner isolation**: All data access scoped to authenticated user
- **Exact currency**: All amounts stored as integer cents

## Security

- Identity headers only accepted when `BRAINHALF_MANAGED=true`
- Same-origin check for all mutations
- Parameterized SQL queries throughout
- 16KB request body limit
- All object IDs are random UUIDs

The schema uses additive table/index creation compatible with BrainHalf's pilot migration gate. Capacity limits seats, not team membership. Stale renames return HTTP 409; a cancelled booking's original idempotency key never reserves new seats. Amounts use integer cents and the UI rejects fractions of a cent.
