# Deploying the document-extraction platform

This is the deployment guide for the app that serves **brainhalf.com** — the code
in `src/`, `functions/`, `server/`, `migrations/` and `queue-worker/`.

`apps/` and `packages/` are a different product with its own guide in
`apps/DEPLOY.md`. Nothing below touches them. See `README.md` for why.

## What it runs on

| Piece | Cloudflare resource | Declared in |
|---|---|---|
| App + API | Pages project `brainhalf` (Functions under `functions/`) | `wrangler.toml` |
| Data | D1 database `brainhalf-ocr-db`, binding `DB` | `wrangler.toml` |
| Uploaded originals | R2 bucket `brainhalf-storage`, binding `DOCUMENTS` | `wrangler.toml` |
| Background extraction | Queue `brainhalf-ocr-queue` — Pages **produces**, the `brainhalf-processor` Worker **consumes** | `wrangler.toml` + `queue-worker/wrangler.toml` |

Pages Functions cannot host a queue consumer, which is why the consumer is a
separate Worker rather than part of this project.

## Order matters

### 1. Migrate the remote database, first

```bash
pnpm db:migrate:remote
```

Before the code that needs it. Migration `0008_document_lifecycle` adds
`documents.started_at` and `documents.attempts`, and both the queue consumer and
the stuck-document recovery write them on every document — deploy the code first
and every extraction fails on an unknown column.

Migrations are additive and safe to re-run; `wrangler` tracks which have been
applied.

### 2. Environment variables

Pages → Settings → Environment variables. Mark anything that is a credential as a
**Secret**, not a plain variable.

| Name | Required | What it does |
|---|---|---|
| `HUNYUAN_API_KEY` | yes | Default extraction tier, runs on every page. `/api/ocr` answers 503 without it. |
| `OPENAI_API_KEY` | recommended | The escalation tier, which re-reads a page the default tier scored below the review threshold. Also the default tier's fallback. |
| `GOOGLE_CLIENT_ID` | for Google sign-in | The server needs it to check the `aud` claim of the ID token. Same value as `VITE_GOOGLE_CLIENT_ID`. |
| `ADMIN_EMAILS` | recommended | Comma-separated, matched **exactly**. Decides who may reach `/api/admin/*`. Unset falls back to the single owner address in `server/admin.ts`. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPPORT_EMAIL` | for email | Password-reset and contact-form delivery. Without them a reset token is created and the link logged instead of sent. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | optional | Enables Textract. `AWS_REGION` defaults to `us-east-1`. |
| `AWS_BEDROCK_MODEL` | optional | Names a Bedrock vision model AND is what enables the Bedrock path at all. Used for both tiers in preference to Textract. |

There is no `VITE_`-prefixed form of any of these, and there must never be: a
`VITE_` variable is substituted into the published JavaScript. `forbidSecretViteVars()`
in `vite.config.ts` fails the build if a secret-shaped one has a value.

### 3. Build and deploy the Pages project

```bash
pnpm verify        # typecheck ×4, lint, tests, build — do not skip
pnpm run deploy    # or: pnpm deploy:pages
```

Cloudflare's own Git integration runs `pnpm install && pnpm build` and publishes
`dist/`, so a push to `main` does the same thing.

### 4. Deploy the queue consumer

```bash
pnpm deploy:worker
```

**Not optional.** With the `OCR_QUEUE` producer binding present but no consumer
deployed, `functions/api/batches/*` still report `asyncProcessing: true`, the
browser stops driving extraction, and the messages pile up unread — every upload
appears to queue and never finishes.

The consumer needs its own secrets, set from `queue-worker/`:

```bash
cd queue-worker
wrangler secret put HUNYUAN_API_KEY
wrangler secret put OPENAI_API_KEY
# and AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY if you use them
```

They are a separate Worker, so Pages environment variables do not reach it.

If you would rather not run a consumer at all, remove the `[[queues.producers]]`
block from `wrangler.toml`. The API then reports `asyncProcessing: false` and the
browser extracts each document itself, which works — it just means closing the tab
stops the batch.

## Verifying a deploy

```bash
# The bundles both compile, without deploying anything:
npx wrangler pages functions build --outdir /tmp/fn
cd queue-worker && npx wrangler deploy --dry-run
```

Then, against the live site: sign in, upload one document, confirm it reaches
`completed`, and check `/app/admin` — every number there is counted in D1 at
request time, so a queue that is not consuming shows up immediately as documents
stuck in **In flight**.

## Rolling back

`wrangler pages deployment list --project-name brainhalf`, then promote an earlier
deployment from the dashboard. Migrations are additive and are **not** rolled back
by that: an older build against a newer schema is fine, the reverse is not.
