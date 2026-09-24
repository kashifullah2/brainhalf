# Brainhalf full-stack example

A working React/TypeScript item manager with a Node HTTP backend, SQLite, password registration/login, cookie sessions and private records per user. Exported from Brainhalf's local full-stack generator during the platform audit.

## Run locally

Requires Node 22.18 or newer.

```sh
npm install
npm run db:migrate
npm run dev:api
```

In a second terminal, run `npm run dev` and open the displayed localhost URL. The default frontend origin is `http://localhost:5173`; the API listens on loopback port 3001. If changing the frontend port, set `APP_ORIGIN` for the API to the exact new origin.

## Verify

```sh
npm run build
npm run typecheck:api
npm run test:api
```

These checks passed during the audit. Real browser checks also passed for signup, login/logout, adding items, reload persistence, cancelling and confirming deletion, and mobile layout.

This export has not been published through the hosted Brainhalf builder. See `server/README.md` for backend configuration and deployment requirements. The separately generated hosted task-manager test has its own evidence in the parent audit directory.
