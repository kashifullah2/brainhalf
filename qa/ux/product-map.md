# BrainHalf Product Map (QA discovery, 2026-10-07)

## Architecture
- **Frontend**: React 19 SPA (Vite), prerendered public pages, hydrated client.
  Entry `src/main.tsx`; workspace shell `src/App.tsx`; main workspace `src/components/Workspace.tsx` (2150 LOC), chat `src/components/ChatPanel.tsx` (3224 LOC).
- **Edge worker (platform)**: `src/worker.ts` — routing, auth, projects API, gallery, admin, preview proxy, static assets. Cloudflare Workers + Assets.
- **Runtime worker (user apps)**: `src/runtime/worker.ts` — hosts published apps (`*.apps.brainhalf.com`), Durable Objects `ProjectRuntime` (SQLite), `PilotCoordinator`, R2 artifacts, D1 per-app databases.
- **Auth**: email/password (signup, login, logout, verify-email, forgot/reset, resend) + Google OAuth. `/api/auth/*` in `src/worker.ts`; sessions via HttpOnly cookie + Bearer token; WS tickets for realtime. Local dev stub: `src/lib/dev-auth-mock.ts` (dev@brainhalf.local / brainhalf-dev).
- **AI pipeline**: chat → `/agents/chat-agent/<projectId>/builder/*` (Durable Object agent, `src/agent.ts`), providers Anthropic/OpenAI/Bedrock (`src/lib/provider-clients.ts`), model picker (`CLIENT_SELECTABLE_MODELS`, `src/lib/models.ts`), generation jobs/streaming (`src/lib/generation-*.ts`), tool stream (`src/lib/workers-ai-tool-stream.ts`).
- **Preview**: in-browser WebContainer preview (`src/lib/webcontainer/`, `PreviewRunner.tsx`, `WebContainerPreview.tsx`) and managed Workers preview (`/preview/...`, isolated subdomains `dev-*.apps.brainhalf.com`).
- **Publishing**: `src/lib/publish-project.ts`, `src/runtime/publication.ts`, UI `PublicationControls.tsx`, `PublishPopover.tsx`, `ProjectHostedSlots.tsx`; gallery listing `GalleryListing.tsx` → `/api/gallery`.
- **Billing/credits**: no payment UI; free-with-limits model — quotas via `/api/account/ai-usage`, `/api/account/project-quota`, `src/lib/limits.ts`, `src/lib/ai-budget.ts`.

## Routes
- Public (prerendered, indexable): `/`, `/gallery`, `/pricing`, `/free-ai-app-builder`, `/faq`, `/about`, `/contact`, `/privacy`, `/terms`, `/guides/build-an-app-with-ai`, `/guides/full-stack-apps`, `/guides/ai-appointment-app-example`, `/use-cases/*` (7 pages).
- Account (noindex shell pages): `/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification`.
- App (authenticated): `/` (builder when signed in), `/dashboard`, `/admin` (operator).
- Legacy redirects: `/sign-in`, `/login`, `/extractor` → 301 `/`. www → apex 301.
- Runtime: `/p/<id>/` published app previews; `/preview/...` dev previews.

## Key interactive elements
- Landing: hero prompt composer (`/#start-building`), nav (AI app builder, Gallery, Build guide, About), sign-in modal trigger, theme toggle, mobile hamburger, FAQ accordions, contact form, demo strip.
- Auth: LoginScreen modal (email/password, Google button), error surfaces, verification pages.
- Workspace: chat composer, model picker dropdown, mobile segmented tabs (Chat/Preview/Code), resizable chat panel, file explorer, preview canvas (device sizes, reload, open-in-new), console/logs/terminal tabs, TopNav (project menu, dashboard, publish, user menu).
- Project console: tabs for files, database, services, connections, history, monitor, growth hub, hosted slots, gallery listing, GitHub sync, custom domain.
- Publishing: Publish popover/controls, gallery listing toggle, domain settings.

## API surface behind flows
- Auth: `/api/auth/signup|login|logout|session|verify-email|forgot-password|reset-password|resend-verification|ws-ticket`, Google `/api/auth/google/start|callback|complete`.
- Projects: `GET /api/projects`, `DELETE/PATCH /api/projects/:id`, remix `POST /api/projects/:id/remix`.
- Generation: `/agents/chat-agent/:projectId/builder/*` (WS + HTTP).
- Models: `GET /api/models/status`. Account: `/api/account/ai-usage|deletions|project-quota|outcomes`.
- Gallery: `GET /api/gallery`. Admin: `/api/admin/*`. Contact: `/api/contact`.
- Runtime (user apps): control entrypoints `/status`, `/jobs`, `/inbox`, `/preview-ticket`, per-app `/api/*` via dispatch namespace.

## Testing environments
- Local full stack: `npm run dev` (Vite + in-process backend simulation + dev auth).
- Local worker: `npm run wrangler -- dev --local --port 8789` (serves dist, real worker code).
- Live: https://brainhalf.com (production; authenticated live tests need manual sign-in — email verification cannot be automated).
