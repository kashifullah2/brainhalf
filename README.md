# BrainHalf

Document extraction: upload invoices, receipts, forms or scans, get structured
data out. Runs on Cloudflare — Pages for the app and its API, D1 for data, R2 for
the uploaded originals, and a Queue for background extraction.

## This repository holds two separate products

Read this before running anything, because the two do not share a database, a
bucket, a queue, or a deployment.

| | Directories | Product | Deployed as |
|---|---|---|---|
| **1** | `src/`, `functions/`, `server/`, `migrations/`, `queue-worker/` | The document-extraction platform. **This is what serves brainhalf.com.** | Cloudflare Pages project `brainhalf`, plus the `brainhalf-processor` Worker |
| **2** | `apps/`, `packages/` | An AI coding studio (`studio`, `@brainhalf/web`, `@brainhalf/workers`, `@brainhalf/ai|auth|db|shared|ui`). Unrelated to the above — it shares the brand name and nothing else. | See `apps/DEPLOY.md` |

`pnpm-workspace.yaml` deliberately covers **product 1 only**. Every script in the
root `package.json` — `build`, `test`, `lint`, `typecheck`, `deploy` — acts on
product 1 and ignores `apps/` and `packages/` entirely. That is not an oversight:
product 2 pulls in three.js, Phaser, Monaco and WebContainer, and there is no
reason for a document-extraction build to install or typecheck any of it.

If you are working on product 2, treat `apps/` as its own repository. If it should
become one, `git rm -r --cached apps packages` is the whole move.

## Running product 1 locally

```bash
pnpm install

cp .env.example .env               # dev-server config + the public Google client id
cp .dev.vars.example .dev.vars     # server-side secrets; wrangler reads this, NOT .env

pnpm db:migrate:local              # apply migrations to the local D1 file
pnpm dev:api                       # wrangler in front, vite behind: the real API
```

`pnpm dev` alone is faster but has no D1, R2 or Queue binding, so authentication,
batches and storage do not work. It exists for pure UI work; `pnpm dev:api` is the
one that exercises the application.

## Checks

```bash
pnpm verify          # typecheck (4 passes) → lint → tests → production build
```

Individually:

| Command | Covers |
|---|---|
| `pnpm typecheck` | `src/` under DOM + Node types |
| `pnpm typecheck:server` | `functions/` and `server/` under **only** `@cloudflare/workers-types`, which is what stops a Node-only API reaching the Workers runtime |
| `pnpm typecheck:test` | the test files, which run under Node and may touch the filesystem |
| `pnpm --filter brainhalf-processor run typecheck` | the queue consumer, including the `server/` modules it imports |
| `pnpm lint` | ESLint — real-bug rules only, no formatting opinions |
| `pnpm test` | vitest across `src/`, `server/`, `functions/`, `queue-worker/` |
| `pnpm build` | the client bundle |

## Deploying

See `DEPLOY.md`. In short: migrate remote D1 first, then the Pages project, then
the queue consumer — and the consumer is not optional if you want "upload, close
the tab, come back later" to be true.
