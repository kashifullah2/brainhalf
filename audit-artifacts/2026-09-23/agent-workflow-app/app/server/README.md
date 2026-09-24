# TypeScript API with SQLite

Requires Node.js 22.18+ (built-in SQLite is experimental on Node 22) and npm. No database credentials or authentication secrets are generated. Passwords use scrypt, sessions use random opaque HttpOnly cookies, and every item query is scoped to its owner.

## Local development

1. Run `npm install` at the project root.
2. Copy `server/.env.example` to `server/.env` and set APP_ORIGIN to your frontend origin.
3. Run `npm run db:migrate`, then `npm run dev:api`.
4. Run the existing frontend development command in another terminal.
5. Configure the frontend development proxy to forward /api to http://127.0.0.1:3001. The default BrainHalf TypeScript starter already includes this proxy. Existing framework configuration is never overwritten.
6. Use the typed `src/lib/api.ts` client from your components. Existing components are preserved; connect their forms and loading/error states to the matching methods.

## Validation

Run `npm run typecheck:api`, `npm run test:api`, and your frontend typecheck/build. These are real local checks, not claims made by the hosted browser preview. Migrations are transactional and idempotent. Empty databases remain empty; tests create their own temporary records.

## Routes

- POST /api/auth/register and /api/auth/login accept email and password (12–128 characters).
- GET /api/auth/me and POST /api/auth/logout manage the current session.
- GET/POST /api/items and GET/PATCH/DELETE /api/items/:id are owner-scoped CRUD.
- GET /api/health checks database connectivity.

## Deployment

Run migrations before `npm run start:api`. Host the frontend build and reverse-proxy /api to the API on loopback. Set NODE_ENV=production and an HTTPS APP_ORIGIN; terminate TLS at the trusted proxy. Keep the SQLite file on a persistent local disk and back it up. Do not share SQLite WAL files over a network filesystem. For multiple API hosts, migrate the data layer to a server database.

Requests that mutate data require the configured Origin header, including CLI requests. Rate limits use the direct peer address, not untrusted forwarded headers; configure trusted upstream rate limiting if requests share a reverse proxy. Email verification, password recovery, monitoring and deployment-specific security review are not included. Never deploy the browser demo API as production functionality.
