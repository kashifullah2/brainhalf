# Stockroom QA

Equipment inventory and reservations with a React frontend, an Express API, and a real SQLite database using Node's built-in `node:sqlite`.

## Provenance and audit status

This is a **locally corrected export** of the app created on brainhalf.com during the 2026-09-22 audit. The initial platform output was incomplete and contained a transaction runtime error. The corrections in this archive were made by Codex after initial generation failures, then synchronized to the private production audit project when browser access resumed. Project: https://brainhalf.com/?project=proj-mcolt6-muc9oisd (audit account required). This does not deploy the generated backend or change the BrainHalf platform deployment.

Verified on Node 22.23.2: TypeScript/Vite build, 26 actual route-handler/SQLite checks, 3 independent-worker concurrency scenarios, and all 15 real HTTP tests. Browser tests passed product creation/editing, search/category filtering, reservation creation/confirmation/cancellation, stock restoration, audit history, and theme persistence. All four screens fit a 390px viewport without page overflow; no page errors were captured. The hosted preview renders the frontend and returns 501 BACKEND_NOT_RUNNING for the API, as expected; no demo API was enabled.

## Run locally

Use Node >=22.18 (the Vite dependency may require Node 22.12+; Node 22.18 satisfies this).

```bash
npm ci --ignore-scripts
npm run dev
```

Vite prints the frontend address, usually http://localhost:5173. The API listens on http://127.0.0.1:3001. Vite proxies `/api` to that server. If 5173 is occupied, Vite selects another port; for an explicit frontend port, start `npm run server` and `npx vite --port 5180 --strictPort` separately. The proxy expects the API at 3001.

Data persists in `data/stockroom.db` across restarts. `STOCKROOM_DB` can select a different file; its parent directory must exist. New databases seed CAMERA-01 / Camera / stock 3 / price 2500 cents, plus two other equipment items. The stock field represents **available** units, excluding active reservations.

The app is a local audit fixture without application authentication. It binds the API to loopback. Adding authenticated access and deployment infrastructure is separate work.

## Checks

```bash
npm run build
npm run test:routes
npm run test:concurrency
npm test
```

- `test:routes`: 26 checks invoking the actual Express route handlers with SQLite. Isolated temporary databases; no mocked persistence or provider responses. These bypass HTTP middleware and transport.
- `test:concurrency`: three real concurrent database scenarios using separate Node workers sharing one SQLite file: competing reservations, identical idempotency retries, and simultaneous cancellation.
- `npm test`: 15 real HTTP tests against an ephemeral local server, including malformed JSON, concurrent requests, and server/database restart. Requires local socket access. All 15 HTTP tests passed, including persistence after server/database restart.

## Workflows

Overview reports actual inventory and reservation data. Inventory supports SKU/name search, category filtering, and adding/editing products. Reservations hold stock immediately, support confirm and cancel, and expose all status changes. Audit history reads up to 1,000 server records. Light/dark mode stores only the appearance preference in localStorage; business data stays in SQLite.

The UI calls real `/api/*` routes. If the backend is unavailable, it shows an offline state. BrainHalf's hosted browser preview currently does not execute this Node server or SQLite database; export and run locally for backend functionality. Do not treat a simulated demo API as proof that this backend runs in the hosted preview.

## API contract

All request/response bodies are JSON. Numeric fields must be JSON numbers, not strings, booleans, or arrays. Prices are integer cents. Stocks are non-negative integers; reservation quantities must be positive integers.

- `GET /api/health`
- `GET /api/products?search=&category=`
- `POST /api/products` — `{sku,name,category,stock,price_cents}`
- `PATCH /api/products/:id` — supplied fields plus the current `version`; stale version returns 409
- `GET /api/reservations`
- `POST /api/reservations` — `{product_id,customer_name,customer_email,quantity}`; optional `Idempotency-Key` header
- `POST /api/reservations/:id/confirm`
- `POST /api/reservations/:id/cancel`
- `GET /api/audit?entity_type=&entity_id=&limit=&offset=`

Reservation creation and cancellation use `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`. Stock changes increment the product version. Replaying the same idempotency key and normalized payload returns the existing reservation; a changed payload returns 409. Cancellation restores stock once. Failed stock changes leave no partial reservation/audit records.
