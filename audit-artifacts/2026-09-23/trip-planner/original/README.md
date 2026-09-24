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

3. Deploy to Cloudflare Workers with D1 binding named `DB`.

4. Configure BrainHalf Settings:
   - Set `BRAINHALF_MANAGED=true` for managed runtime
   - Configure Google OAuth credentials
   - Configure Resend API key for contact form email delivery

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

- **Concurrency-safe bookings**: SQLite triggers enforce capacity atomically
- **Idempotency**: All mutations support Idempotency-Key for safe retries
- **Optimistic locking**: Trip updates use version compare-and-swap
- **Audit trail**: Automatic audit events via SQL triggers
- **Owner isolation**: All data access scoped to authenticated user
- **Exact currency**: All amounts stored as integer cents

## Security

- Identity headers only accepted when `BRAINHALF_MANAGED=true`
- Same-origin check for all mutations
- Parameterized SQL queries throughout
- 16KB request body limit
- All object IDs are random UUIDs