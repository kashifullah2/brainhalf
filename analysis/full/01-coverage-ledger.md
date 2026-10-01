# Phase 1: Coverage Ledger

Every tracked file (git ls-files) categorized with review status.

**Status key:**
- **DEEP** — read line-by-line (auth, sessions, registry, worker, agent, runtime, crypto, SSRF, uploads, admin, publishing, quotas, data deletion)
- **SCANNED** — automated checks plus targeted reads (components, UI libs, CSS, tests, scripts)
- **SKIPPED** — with reason (binary assets, generated files, lock files)

---

## Root config and docs

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| .agents/mcp_config.json | 11 | config | SCANNED |
| .githooks/pre-push | 10 | config | SCANNED |
| .github/workflows/validate.yml | 31 | config/CI | SCANNED |
| .gitignore | 68 | config | SKIPPED (gitignore) |
| .node-version | 1 | config | SKIPPED (trivial) |
| .npmrc | 1 | config | SCANNED |
| .oxlintrc.json | 42 | config | SCANNED |
| ARCHITECTURE.md | 434 | docs | SCANNED |
| BRAND_EMAIL_HANDOFF.md | 47 | docs | SKIPPED (docs) |
| DECISIONS.md | 690 | docs | SCANNED |
| Dockerfile.runtime | 2 | config/runtime | DEEP |
| FULL_CODEBASE_ANALYSIS.md | 373 | docs | SKIPPED (docs) |
| MODELS.md | 79 | docs | SCANNED |
| PLATFORM_INFO.md | 313 | docs | SKIPPED (docs) |
| README.md | 243 | docs | SKIPPED (docs) |
| SEO_HANDOFF.md | 107 | docs | SKIPPED (docs) |
| TODO.md | 101 | docs | SKIPPED (docs) |
| index.html | 28 | config/entry | SCANNED |
| load-results/load-summary.json | 38 | data | SKIPPED (test artifact) |
| package-lock.json | 8335 | deps | SKIPPED (generated lock file) |
| package.json | 77 | config | SCANNED |
| playwright-screenshot.png | 1882 | binary | SKIPPED (binary image) |
| playwright.config.ts | 78 | config/test | SCANNED |
| playwright.live.config.ts | 11 | config/test | SCANNED |
| playwright.seo.config.ts | 14 | config/test | SCANNED |
| tsconfig.json | 26 | config | SCANNED |
| tsconfig.node.json | 10 | config | SCANNED |
| tsconfig.node.tsbuildinfo | 0 | build-output | SKIPPED (build artifact) |
| tsconfig.runtime.json | 7 | config | SCANNED |
| vite.config.ts | 373 | config/build | SCANNED |
| vite.preview.config.ts | 9 | config/build | SCANNED |
| vitest.runtime.config.ts | 6 | config/test | SCANNED |
| wrangler.runtime.jsonc | 33 | config/runtime | DEEP |
| wrangler.toml | 78 | config/deploy | DEEP |
| test-agent.mjs | 605 | test-script | SCANNED |

## public/

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| public/_headers | 67 | security/CSP | DEEP |
| public/ads.txt | 1 | static | SKIPPED (trivial) |
| public/android-chrome-192x192.png | 190 | binary | SKIPPED (binary image) |
| public/android-chrome-512x512.png | 803 | binary | SKIPPED (binary image) |
| public/apple-touch-icon.png | 154 | binary | SKIPPED (binary image) |
| public/brainhalf-logo-128.png | 101 | binary | SKIPPED (binary image) |
| public/favicon-16x16.png | 5 | binary | SKIPPED (binary image) |
| public/favicon-32x32.png | 14 | binary | SKIPPED (binary image) |
| public/favicon.ico | 45 | binary | SKIPPED (binary image) |
| public/fonts/BricolageGrotesque-OFL.txt | 93 | license | SKIPPED (license text) |
| public/fonts/DMMono-OFL.txt | 93 | license | SKIPPED (license text) |
| public/fonts/InstrumentSans-OFL.txt | 93 | license | SKIPPED (license text) |
| public/fonts/bricolage-grotesque.woff | 64 | binary | SKIPPED (binary font) |
| public/fonts/dm-mono.woff | 59 | binary | SKIPPED (binary font) |
| public/fonts/instrument-sans-bold.woff | 73 | binary | SKIPPED (binary font) |
| public/fonts/instrument-sans.woff | 61 | binary | SKIPPED (binary font) |
| public/images/README.md | 11 | docs | SKIPPED (docs) |
| public/images/brainhalf-social.png | 187 | binary | SKIPPED (binary image) |
| public/images/cedar-cuts-appointment-demo.webp | 96 | binary | SKIPPED (binary image) |
| public/images/iceland-coast-640.webp | 123 | binary | SKIPPED (binary image) |
| public/images/iceland-coast-960.webp | 229 | binary | SKIPPED (binary image) |
| public/images/iceland-coast.jpg | 771 | binary | SKIPPED (binary image) |
| public/images/landing-workspace.png | 681 | binary | SKIPPED (binary image) |
| public/images/landing/demo-crm-owner.webp | 1925 | binary | SKIPPED (binary image) |
| public/images/landing/demo-inventory-owner.webp | 1240 | binary | SKIPPED (binary image) |
| public/images/landing/demo-tasks-owner.webp | 1603 | binary | SKIPPED (binary image) |
| public/images/landing/landing-workspace.webp | 149 | binary | SKIPPED (binary image) |
| public/robots.txt | 9 | static | SCANNED |
| public/site.webmanifest | 18 | config | SCANNED |
| public/theme-init.js | 10 | client-script | DEEP |

## scripts/

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| scripts/audit-fullstack-live.mjs | 73 | script | SCANNED |
| scripts/audit-public-platform.mjs | 57 | script | SCANNED |
| scripts/browser-test-trip-planner.mjs | 172 | script | SCANNED |
| scripts/check-agent-local.mjs | 57 | script | SCANNED |
| scripts/check-runtime-local.mjs | 106 | script | SCANNED |
| scripts/check-secrets.mjs | 79 | script/security | DEEP |
| scripts/check-seo.mjs | 92 | script | SCANNED |
| scripts/deploy-platform.mjs | 43 | script/deploy | SCANNED |
| scripts/deploy.mjs | 18 | script/deploy | SCANNED |
| scripts/live-auth.mjs | 65 | script/auth | SCANNED |
| scripts/prepare-trip-fixture.mjs | 39 | script | SCANNED |
| scripts/prerender.mjs | 40 | script/build | SCANNED |
| scripts/setup-provisioning-token.mjs | 142 | script/auth | DEEP |
| scripts/test-business-apps.mjs | 197 | script/test | SCANNED |
| scripts/test-live-model-apps.mjs | 214 | script/test | SCANNED |
| scripts/test-trip-planner.mjs | 254 | script/test | SCANNED |
| scripts/trip-planner-harness.mjs | 130 | script/test | SCANNED |
| scripts/verify-release.mjs | 82 | script/deploy | SCANNED |
| scripts/wrangler.mjs | 85 | script/deploy | SCANNED |

## scripts/__tests__/

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| scripts/__tests__/business-apps.test.mjs | 19 | test | SCANNED |
| scripts/__tests__/deploy-platform.test.mjs | 58 | test | SCANNED |
| scripts/__tests__/deployment.test.mjs | 154 | test | SCANNED |
| scripts/__tests__/live-auth.test.mjs | 64 | test | SCANNED |
| scripts/__tests__/live-model-apps.test.mjs | 42 | test | SCANNED |
| scripts/__tests__/provisioning-token.test.mjs | 109 | test | SCANNED |
| scripts/__tests__/release.test.mjs | 52 | test | SCANNED |

## runtime-tests/

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| runtime-tests/github-oauth.test.ts | 135 | test/runtime | SCANNED |
| runtime-tests/managed.test.ts | 184 | test/runtime | SCANNED |
| runtime-tests/pilot-slot-release.test.ts | 96 | test/runtime | SCANNED |
| runtime-tests/preview-embed-error.test.ts | 75 | test/runtime | SCANNED |
| runtime-tests/project.test.ts | 1007 | test/runtime | SCANNED |
| runtime-tests/publication-access.test.ts | 71 | test/runtime | SCANNED |

## src/ — Core application

### src/ — Entry points

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| src/App.tsx | 577 | app-entry | SCANNED |
| src/main.tsx | 44 | app-entry | SCANNED |
| src/preview-main.tsx | 18 | preview-entry | SCANNED |
| src/index.css | 2429 | style | SKIPPED (CSS, no logic) |
| src/vite-env.d.ts | 21 | type-def | SKIPPED (type declarations) |

### src/ — Critical server-side files (DEEP)

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| src/agent.ts | 3717 | agent/generation | DEEP |
| src/registry.ts | 1006 | auth/registry | DEEP |
| src/worker.ts | 915 | worker/router | DEEP |

### src/lib/ — Libraries

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| src/lib/agent-capabilities.ts | 145 | agent | SCANNED |
| src/lib/agent-context.ts | 41 | agent | SCANNED |
| src/lib/ai-budget.ts | 96 | quotas | DEEP |
| src/lib/allowed-origins.ts | 23 | security | DEEP |
| src/lib/analytics.ts | 52 | analytics | SCANNED |
| src/lib/app-session.ts | 3 | session | SCANNED |
| src/lib/assistant-response.ts | 22 | lib | SCANNED |
| src/lib/auth-client.ts | 380 | auth/client | DEEP |
| src/lib/auth.ts | 458 | auth/server | DEEP |
| src/lib/automatic-backend.ts | 175 | backend | SCANNED |
| src/lib/automatic-build-fix.ts | 112 | backend | SCANNED |
| src/lib/backend-runner.ts | 1092 | runtime/sandbox | DEEP |
| src/lib/bindings.ts | 18 | config | SCANNED |
| src/lib/brand-image.ts | 2 | static | SKIPPED (base64 image data) |
| src/lib/builder-attachments.ts | 55 | lib | SCANNED |
| src/lib/builder-client.ts | 12 | lib | SCANNED |
| src/lib/builder-service.ts | 151 | lib | SCANNED |
| src/lib/builder-tools.ts | 61 | lib | SCANNED |
| src/lib/business-apps.ts | 18 | lib | SCANNED |
| src/lib/chat-transcript.ts | 158 | lib | SCANNED |
| src/lib/cloudflare-mock.ts | 18 | test-util | SCANNED |
| src/lib/concurrency.ts | 193 | concurrency | DEEP |
| src/lib/crypto.ts | 265 | crypto | DEEP |
| src/lib/dev-auth-mock.ts | 108 | auth/dev | SCANNED |
| src/lib/email-client.ts | 9 | email | SCANNED |
| src/lib/email-registry.ts | 51 | auth/email | DEEP |
| src/lib/email.ts | 106 | email | DEEP |
| src/lib/events.ts | 101 | lib | SCANNED |
| src/lib/exact-edits.ts | 16 | lib | SCANNED |
| src/lib/file-diff.ts | 170 | lib | SCANNED |
| src/lib/file-snapshot.ts | 80 | lib | SCANNED |
| src/lib/generation-controls.ts | 46 | generation | SCANNED |
| src/lib/generation-errors.ts | 110 | generation | SCANNED |
| src/lib/generation-jobs.ts | 159 | generation | DEEP |
| src/lib/generation-session.ts | 13 | generation | SCANNED |
| src/lib/generation-target.ts | 22 | generation | SCANNED |
| src/lib/generation-timing.ts | 45 | generation | SCANNED |
| src/lib/github-export.ts | 134 | export | SCANNED |
| src/lib/github-profile.ts | 29 | auth/oauth | SCANNED |
| src/lib/google-auth.ts | 109 | auth/oauth | DEEP |
| src/lib/google-profile.ts | 20 | auth/oauth | SCANNED |
| src/lib/hosted-limit.ts | 18 | quotas | DEEP |
| src/lib/http-body.ts | 9 | lib | SCANNED |
| src/lib/limits.ts | 17 | quotas | DEEP |
| src/lib/lucide-compat.ts | 45 | lib | SKIPPED (icon compat) |
| src/lib/managed-app-scaffold.ts | 15 | runtime | SCANNED |
| src/lib/managed-providers.ts | 129 | runtime | SCANNED |
| src/lib/message-parser.ts | 434 | agent/parsing | DEEP |
| src/lib/migrations.ts | 185 | data-migration | DEEP |
| src/lib/model-reliability.ts | 83 | lib | SCANNED |
| src/lib/model-tester.ts | 695 | lib | SCANNED |
| src/lib/models.ts | 167 | config | SCANNED |
| src/lib/oauth-schema.ts | 5 | auth/oauth | SCANNED |
| src/lib/pending-chat-request.ts | 37 | lib | SCANNED |
| src/lib/preview-diagnostics.ts | 76 | preview | SCANNED |
| src/lib/preview-entry.ts | 51 | preview | SCANNED |
| src/lib/preview-fetch.ts | 56 | preview/sandbox | DEEP |
| src/lib/preview-import-map.ts | 136 | preview | SCANNED |
| src/lib/preview-isolation.ts | 69 | preview/sandbox | DEEP |
| src/lib/preview-mode.ts | 15 | preview | SCANNED |
| src/lib/preview-modules.ts | 80 | preview | SCANNED |
| src/lib/preview-runtime.ts | 56 | preview | SCANNED |
| src/lib/preview-storage.ts | 11 | preview | SCANNED |
| src/lib/preview-templates.ts | 586 | preview | SCANNED |
| src/lib/prism-loader.ts | 90 | lib | SKIPPED (syntax highlight) |
| src/lib/product-outcomes.ts | 52 | lib | SCANNED |
| src/lib/project-access.ts | 44 | auth/access | DEEP |
| src/lib/project-cleanup.ts | 42 | data-deletion | DEEP |
| src/lib/project-export.ts | 48 | export | SCANNED |
| src/lib/project-growth.ts | 122 | lib | SCANNED |
| src/lib/project-runtime-client.ts | 262 | runtime-client | SCANNED |
| src/lib/project-starters.ts | 450 | lib | SCANNED |
| src/lib/project-store.ts | 818 | storage | DEEP |
| src/lib/prompt-mode.ts | 22 | lib | SCANNED |
| src/lib/provider-clients.ts | 99 | provider | DEEP |
| src/lib/publish-project.ts | 56 | publishing | DEEP |
| src/lib/rate-limit.ts | 76 | security/rate-limit | DEEP |
| src/lib/read-upload.ts | 59 | uploads | DEEP |
| src/lib/recent-projects.ts | 70 | lib | SCANNED |
| src/lib/repair-budget.ts | 10 | lib | SCANNED |
| src/lib/runtime-config.ts | 82 | runtime | SCANNED |
| src/lib/secret-files.ts | 11 | security/secrets | DEEP |
| src/lib/source-history.ts | 37 | lib | SCANNED |
| src/lib/ssrf.ts | 239 | security/SSRF | DEEP |
| src/lib/starter-verification.json | 14 | data | SCANNED |
| src/lib/status-store.ts | 204 | lib | SCANNED |
| src/lib/system-prompt.ts | 205 | agent/prompt | DEEP |
| src/lib/templates.ts | 359 | lib | SCANNED |
| src/lib/templates/pulseboard.ts | 676 | lib | SKIPPED (template content) |
| src/lib/tenant-request.ts | 11 | auth/tenant | DEEP |
| src/lib/theme.ts | 39 | lib | SCANNED |
| src/lib/timeouts.ts | 16 | lib | SCANNED |
| src/lib/use-modal-focus.ts | 74 | lib/UI | SCANNED |
| src/lib/utils.ts | 103 | lib | SCANNED |
| src/lib/verification-copy.ts | 75 | publishing | SCANNED |
| src/lib/workers-ai-tool-stream.ts | 69 | agent/streaming | SCANNED |
| src/lib/workers-starter.ts | 98 | runtime | SCANNED |
| src/lib/workspace-reconciliation.ts | 33 | lib | SCANNED |
| src/lib/zip-export.ts | 174 | export | SCANNED |

### src/runtime/ — Server runtime (Durable Objects)

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| src/runtime/artifact.ts | 35 | runtime | SCANNED |
| src/runtime/auth-page.ts | 16 | runtime/auth | DEEP |
| src/runtime/availability.ts | 35 | runtime | SCANNED |
| src/runtime/cloudflare-api.ts | 78 | runtime/infra | DEEP |
| src/runtime/database-tools.ts | 201 | runtime/DB | DEEP |
| src/runtime/env.ts | 13 | runtime/config | SCANNED |
| src/runtime/generated.d.ts | 15749 | type-def | SKIPPED (auto-generated type declarations) |
| src/runtime/integrations.ts | 36 | runtime | SCANNED |
| src/runtime/mail-provider.ts | 36 | runtime/email | SCANNED |
| src/runtime/managed-auth.ts | 250 | runtime/auth | DEEP |
| src/runtime/managed-capability.ts | 18 | runtime | SCANNED |
| src/runtime/managed-mail.ts | 151 | runtime/email | DEEP |
| src/runtime/managed-store.ts | 117 | runtime/storage | DEEP |
| src/runtime/managed-types.ts | 40 | type-def | SCANNED |
| src/runtime/pilot.ts | 161 | runtime/quotas | DEEP |
| src/runtime/project.ts | 1261 | runtime/core | DEEP |
| src/runtime/provisioning.ts | 49 | runtime/auth | DEEP |
| src/runtime/publication.ts | 36 | runtime/publishing | DEEP |
| src/runtime/request-monitor.ts | 23 | runtime | SCANNED |
| src/runtime/secrets.ts | 54 | runtime/secrets | DEEP |
| src/runtime/source.ts | 50 | runtime | SCANNED |
| src/runtime/types.ts | 88 | type-def | SCANNED |
| src/runtime/uploads.ts | 130 | runtime/uploads | DEEP |
| src/runtime/verification.ts | 154 | runtime/publishing | DEEP |
| src/runtime/worker.ts | 136 | runtime/worker | DEEP |

### src/seo/

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| src/seo/content.ts | 205 | seo | SCANNED |
| src/seo/growth-pages.ts | 117 | seo | SCANNED |
| src/seo/metadata.ts | 33 | seo | SCANNED |
| src/seo/render.tsx | 49 | seo/build | SCANNED |

### src/styles/

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| src/styles/studio-fonts.css | 25 | style | SKIPPED (CSS, no logic) |
| src/styles/studio-theme.css | 246 | style | SKIPPED (CSS, no logic) |
| src/styles/studio-workspace.css | 472 | style | SKIPPED (CSS, no logic) |

### src/components/

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| src/components/AccountPage.css | 19 | style | SKIPPED (CSS) |
| src/components/AccountPage.tsx | 47 | component | SCANNED |
| src/components/ActionMenu.css | 28 | style | SKIPPED (CSS) |
| src/components/ActionMenu.tsx | 119 | component | SCANNED |
| src/components/AdminPage.css | 133 | style | SKIPPED (CSS) |
| src/components/AdminPage.tsx | 509 | component/admin | DEEP |
| src/components/AgentTools.css | 6 | style | SKIPPED (CSS) |
| src/components/AgentTools.tsx | 111 | component | SCANNED |
| src/components/AgentTracker.css | 424 | style | SKIPPED (CSS) |
| src/components/AgentTracker.tsx | 321 | component | SCANNED |
| src/components/AssistantMarkdown.css | 17 | style | SKIPPED (CSS) |
| src/components/AssistantMarkdown.tsx | 19 | component | SCANNED |
| src/components/BentoGrid.css | 310 | style | SKIPPED (CSS) |
| src/components/BentoGrid.tsx | 170 | component | SCANNED |
| src/components/BrainHalfLogo.tsx | 54 | component | SKIPPED (SVG logo) |
| src/components/BuildProgress.tsx | 22 | component | SCANNED |
| src/components/ChatPanel.tsx | 2543 | component/chat | SCANNED |
| src/components/CodeFileBlock.tsx | 315 | component | SCANNED |
| src/components/CommandBlock.tsx | 65 | component | SCANNED |
| src/components/CommandPalette.css | 59 | style | SKIPPED (CSS) |
| src/components/CommandPalette.tsx | 200 | component | SCANNED |
| src/components/ConfirmModal.tsx | 195 | component | SCANNED |
| src/components/ContactForm.tsx | 28 | component | SCANNED |
| src/components/CustomDomainSettings.tsx | 193 | component/domains | SCANNED |
| src/components/DashboardPage.css | 60 | style | SKIPPED (CSS) |
| src/components/DashboardPage.tsx | 247 | component | SCANNED |
| src/components/DesignPreviewStrip.tsx | 123 | component | SCANNED |
| src/components/DiffEditBlock.tsx | 237 | component | SCANNED |
| src/components/ErrorBoundary.tsx | 228 | component | SCANNED |
| src/components/FaqSection.css | 79 | style | SKIPPED (CSS) |
| src/components/FaqSection.tsx | 33 | component | SCANNED |
| src/components/FileExplorer.tsx | 267 | component | SCANNED |
| src/components/FinalCta.css | 94 | style | SKIPPED (CSS) |
| src/components/FinalCta.tsx | 33 | component | SCANNED |
| src/components/GalleryListing.tsx | 78 | component | SCANNED |
| src/components/GalleryPage.css | 127 | style | SKIPPED (CSS) |
| src/components/GalleryPage.tsx | 92 | component | SCANNED |
| src/components/GalleryRow.css | 165 | style | SKIPPED (CSS) |
| src/components/GalleryRow.tsx | 115 | component | SCANNED |
| src/components/GenerationChanges.tsx | 190 | component | SCANNED |
| src/components/GenerationProgress.tsx | 88 | component | SCANNED |
| src/components/GithubSyncModal.tsx | 408 | component/export | SCANNED |
| src/components/HowItWorks.css | 307 | style | SKIPPED (CSS) |
| src/components/HowItWorks.tsx | 140 | component | SCANNED |
| src/components/HtmlPreview.tsx | 158 | component/preview | SCANNED |
| src/components/InteractiveDemo.css | 531 | style | SKIPPED (CSS) |
| src/components/InteractiveDemo.tsx | 333 | component | SCANNED |
| src/components/LandingFooter.tsx | 70 | component | SCANNED |
| src/components/LandingHero.css | 334 | style | SKIPPED (CSS) |
| src/components/LandingHero.tsx | 250 | component | SCANNED |
| src/components/LandingPage.css | 186 | style | SKIPPED (CSS) |
| src/components/LandingPage.tsx | 124 | component | SCANNED |
| src/components/LivePreviewFrame.tsx | 76 | component/preview | SCANNED |
| src/components/LoginScreen.css | 46 | style | SKIPPED (CSS) |
| src/components/LoginScreen.tsx | 140 | component/auth | SCANNED |
| src/components/MobileNav.tsx | 69 | component | SCANNED |
| src/components/PlanBlock.tsx | 37 | component | SCANNED |
| src/components/PreviewCanvas.css | 40 | style | SKIPPED (CSS) |
| src/components/PreviewCanvas.tsx | 68 | component | SCANNED |
| src/components/PreviewRunner.tsx | 773 | component/preview | SCANNED |
| src/components/ProjectAgentUsage.tsx | 57 | component | SCANNED |
| src/components/ProjectConnections.tsx | 32 | component | SCANNED |
| src/components/ProjectConsole.css | 1420 | style | SKIPPED (CSS) |
| src/components/ProjectConsole.tsx | 312 | component/console | SCANNED |
| src/components/ProjectDatabase.tsx | 783 | component/DB | SCANNED |
| src/components/ProjectFiles.tsx | 51 | component | SCANNED |
| src/components/ProjectGrowthHub.tsx | 54 | component | SCANNED |
| src/components/ProjectHistory.tsx | 261 | component | SCANNED |
| src/components/ProjectHostedSlots.tsx | 88 | component/quotas | SCANNED |
| src/components/ProjectMonitor.tsx | 24 | component | SCANNED |
| src/components/ProjectServices.tsx | 73 | component | SCANNED |
| src/components/PublicPage.css | 72 | style | SKIPPED (CSS) |
| src/components/PublicPage.tsx | 55 | component | SCANNED |
| src/components/PublicationControls.css | 68 | style | SKIPPED (CSS) |
| src/components/PublicationControls.tsx | 328 | component/publishing | SCANNED |
| src/components/RecentProjects.css | 115 | style | SKIPPED (CSS) |
| src/components/RecentProjects.tsx | 158 | component | SCANNED |
| src/components/SiteHeaderActions.tsx | 151 | component | SCANNED |
| src/components/SiteNavbar.tsx | 91 | component | SCANNED |
| src/components/ThemeToggle.tsx | 20 | component | SCANNED |
| src/components/ToolSummary.tsx | 10 | component | SCANNED |
| src/components/TopNav.tsx | 207 | component | SCANNED |
| src/components/TrustSection.css | 87 | style | SKIPPED (CSS) |
| src/components/TrustSection.tsx | 52 | component | SCANNED |
| src/components/Workspace.tsx | 1888 | component/workspace | SCANNED |

### src/__tests__/

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| src/__tests__/account-storage.test.ts | 249 | test | SCANNED |
| src/__tests__/admin-management.test.ts | 112 | test | SCANNED |
| src/__tests__/agent-erasure.test.ts | 35 | test | SCANNED |
| src/__tests__/agent-generation-runtime.test.ts | 858 | test | SCANNED |
| src/__tests__/agent-resume-lifecycle.test.ts | 123 | test | SCANNED |
| src/__tests__/agent-tools-wiring.test.ts | 56 | test | SCANNED |
| src/__tests__/agent-write-guards.test.ts | 214 | test | SCANNED |
| src/__tests__/ai-budget.test.ts | 85 | test | SCANNED |
| src/__tests__/ai-stream-edge-cases.test.ts | 120 | test | SCANNED |
| src/__tests__/analytics.test.ts | 75 | test | SCANNED |
| src/__tests__/app-verification.test.ts | 97 | test | SCANNED |
| src/__tests__/assistant-markdown.test.tsx | 15 | test | SCANNED |
| src/__tests__/assistant-response.test.ts | 21 | test | SCANNED |
| src/__tests__/attachment-export-build.test.ts | 51 | test | SCANNED |
| src/__tests__/auth-client-login-code.test.ts | 41 | test | SCANNED |
| src/__tests__/auth-crypto.test.ts | 222 | test | SCANNED |
| src/__tests__/auth-gate.test.ts | 250 | test | SCANNED |
| src/__tests__/automatic-build-fix.test.ts | 52 | test | SCANNED |
| src/__tests__/backend-plain-errors.test.ts | 68 | test | SCANNED |
| src/__tests__/backend-preview-regressions.test.ts | 148 | test | SCANNED |
| src/__tests__/backend-runner.test.ts | 266 | test | SCANNED |
| src/__tests__/backend-tenant-isolation.test.ts | 128 | test | SCANNED |
| src/__tests__/browser-test-policy.test.ts | 28 | test | SCANNED |
| src/__tests__/build-progress.test.tsx | 29 | test | SCANNED |
| src/__tests__/builder-service.test.ts | 128 | test | SCANNED |
| src/__tests__/chat-history-merge.test.ts | 146 | test | SCANNED |
| src/__tests__/chat-transcript.test.ts | 88 | test | SCANNED |
| src/__tests__/concurrency.test.ts | 158 | test | SCANNED |
| src/__tests__/dashboard-cleanup.test.ts | 31 | test | SCANNED |
| src/__tests__/database-tools.test.ts | 160 | test | SCANNED |
| src/__tests__/design-preview-strip.test.tsx | 229 | test | SCANNED |
| src/__tests__/email.test.ts | 252 | test | SCANNED |
| src/__tests__/error-boundary-reset.test.ts | 29 | test | SCANNED |
| src/__tests__/events.test.ts | 95 | test | SCANNED |
| src/__tests__/export-security.test.ts | 141 | test | SCANNED |
| src/__tests__/file-diff.test.ts | 97 | test | SCANNED |
| src/__tests__/file-snapshot.test.ts | 69 | test | SCANNED |
| src/__tests__/fullstack-runtime.test.ts | 108 | test | SCANNED |
| src/__tests__/gallery.test.ts | 148 | test | SCANNED |
| src/__tests__/generation-controls.test.ts | 54 | test | SCANNED |
| src/__tests__/generation-errors.test.ts | 76 | test | SCANNED |
| src/__tests__/generation-jobs-migration.test.ts | 27 | test | SCANNED |
| src/__tests__/generation-jobs.test.ts | 146 | test | SCANNED |
| src/__tests__/generation-latency-migration.test.ts | 21 | test | SCANNED |
| src/__tests__/generation-pipeline-fixes.test.ts | 186 | test | SCANNED |
| src/__tests__/generation-target.test.ts | 58 | test | SCANNED |
| src/__tests__/generation-timing.test.ts | 26 | test | SCANNED |
| src/__tests__/github-oauth.test.ts | 50 | test | SCANNED |
| src/__tests__/google-auth.test.ts | 147 | test | SCANNED |
| src/__tests__/headers-drift.test.ts | 92 | test | SCANNED |
| src/__tests__/helpers/storage.ts | 24 | test-util | SCANNED |
| src/__tests__/history-rewrite.test.ts | 43 | test | SCANNED |
| src/__tests__/hosted-limit.test.ts | 26 | test | SCANNED |
| src/__tests__/html-preview-root.test.ts | 101 | test | SCANNED |
| src/__tests__/injection-hardening.test.ts | 83 | test | SCANNED |
| src/__tests__/landing-hero.test.tsx | 76 | test | SCANNED |
| src/__tests__/landing-sections.test.tsx | 98 | test | SCANNED |
| src/__tests__/landing-unauthenticated.test.ts | 122 | test | SCANNED |
| src/__tests__/limits.test.ts | 77 | test | SCANNED |
| src/__tests__/live-preview-frame.test.tsx | 19 | test | SCANNED |
| src/__tests__/lucide-compat.test.ts | 70 | test | SCANNED |
| src/__tests__/managed-providers.test.ts | 75 | test | SCANNED |
| src/__tests__/message-parser.test.ts | 241 | test | SCANNED |
| src/__tests__/mobile-nav-theme.test.tsx | 61 | test | SCANNED |
| src/__tests__/mobile-nav-toggle.test.ts | 20 | test | SCANNED |
| src/__tests__/model-allowlist.test.ts | 225 | test | SCANNED |
| src/__tests__/model-reliability.test.ts | 46 | test | SCANNED |
| src/__tests__/model-test-results.test.ts | 69 | test | SCANNED |
| src/__tests__/new-project-template-isolation.test.ts | 118 | test | SCANNED |
| src/__tests__/overhaul-regressions.test.tsx | 130 | test | SCANNED |
| src/__tests__/p5-pagination.test.ts | 141 | test | SCANNED |
| src/__tests__/p6-preview-source.test.ts | 62 | test | SCANNED |
| src/__tests__/pending-chat-request.test.ts | 64 | test | SCANNED |
| src/__tests__/phase1-backend-scoping.test.ts | 114 | test | SCANNED |
| src/__tests__/phase1-token-exposure.test.ts | 199 | test | SCANNED |
| src/__tests__/phase2-bounds-and-limits.test.ts | 200 | test | SCANNED |
| src/__tests__/phase2-digest-login.test.ts | 121 | test | SCANNED |
| src/__tests__/phase2-project-quota.test.ts | 291 | test | SCANNED |
| src/__tests__/preview-auth.test.ts | 54 | test | SCANNED |
| src/__tests__/preview-diagnostics.test.ts | 22 | test | SCANNED |
| src/__tests__/preview-entry.test.ts | 55 | test | SCANNED |
| src/__tests__/preview-fetch.test.ts | 44 | test | SCANNED |
| src/__tests__/preview-import-map.test.ts | 92 | test | SCANNED |
| src/__tests__/preview-isolation.test.ts | 85 | test | SCANNED |
| src/__tests__/preview-module-regressions.test.ts | 96 | test | SCANNED |
| src/__tests__/preview-plain-errors.test.ts | 55 | test | SCANNED |
| src/__tests__/preview-runtime.test.ts | 54 | test | SCANNED |
| src/__tests__/preview-templates.test.ts | 75 | test | SCANNED |
| src/__tests__/preview-transient-errors.test.ts | 51 | test | SCANNED |
| src/__tests__/product-outbox.test.ts | 50 | test | SCANNED |
| src/__tests__/product-outcomes.test.ts | 58 | test | SCANNED |
| src/__tests__/product-quality.test.ts | 89 | test | SCANNED |
| src/__tests__/project-access.test.ts | 314 | test | SCANNED |
| src/__tests__/project-cleanup.test.ts | 26 | test | SCANNED |
| src/__tests__/project-history-restore.test.ts | 23 | test | SCANNED |
| src/__tests__/project-runtime-client.test.ts | 94 | test | SCANNED |
| src/__tests__/project-store-recovery.test.ts | 81 | test | SCANNED |
| src/__tests__/project-store.test.ts | 355 | test | SCANNED |
| src/__tests__/prompt-mode.test.ts | 27 | test | SCANNED |
| src/__tests__/provisioning-check.test.ts | 42 | test | SCANNED |
| src/__tests__/publication-stage.test.ts | 27 | test | SCANNED |
| src/__tests__/publication.test.ts | 57 | test | SCANNED |
| src/__tests__/publish-progress-view.test.tsx | 49 | test | SCANNED |
| src/__tests__/publish-project.test.ts | 62 | test | SCANNED |
| src/__tests__/recent-projects.test.ts | 53 | test | SCANNED |
| src/__tests__/registry-admin-delete.test.ts | 100 | test | SCANNED |
| src/__tests__/registry-remix-cap.test.ts | 99 | test | SCANNED |
| src/__tests__/resume-banner.test.ts | 28 | test | SCANNED |
| src/__tests__/runtime-availability.test.ts | 32 | test | SCANNED |
| src/__tests__/runtime-config.test.ts | 57 | test | SCANNED |
| src/__tests__/runtime-provider-gate.test.ts | 55 | test | SCANNED |
| src/__tests__/security-headers.test.ts | 90 | test | SCANNED |
| src/__tests__/security.test.ts | 41 | test | SCANNED |
| src/__tests__/seo.test.ts | 99 | test | SCANNED |
| src/__tests__/snapshot-server.test.ts | 141 | test | SCANNED |
| src/__tests__/socket-revocation.test.ts | 47 | test | SCANNED |
| src/__tests__/source-history.test.ts | 35 | test | SCANNED |
| src/__tests__/ssrf-guard.test.ts | 207 | test | SCANNED |
| src/__tests__/status-store.test.ts | 182 | test | SCANNED |
| src/__tests__/stop-generation.test.ts | 117 | test | SCANNED |
| src/__tests__/system-prompt.test.ts | 65 | test | SCANNED |
| src/__tests__/templates.test.ts | 49 | test | SCANNED |
| src/__tests__/tenant-request.test.ts | 32 | test | SCANNED |
| src/__tests__/utils.test.ts | 58 | test | SCANNED |
| src/__tests__/verification-copy.test.ts | 51 | test | SCANNED |
| src/__tests__/verification-gate.test.ts | 14 | test | SCANNED |
| src/__tests__/worker.test.ts | 735 | test | SCANNED |
| src/__tests__/workers-ai-tool-stream.test.ts | 96 | test | SCANNED |
| src/__tests__/workspace-initialization.test.ts | 81 | test | SCANNED |
| src/__tests__/workspace-readonly.test.ts | 23 | test | SCANNED |
| src/__tests__/workspace-reconciliation.test.ts | 36 | test | SCANNED |
| src/__tests__/zip-entry-regressions.test.ts | 44 | test | SCANNED |
| src/__tests__/zip-export.test.ts | 115 | test | SCANNED |

## tests/ (Playwright / e2e)

| Path | Lines | Category | Status |
|------|-------|----------|--------|
| tests/account-isolation.spec.ts | 131 | test/e2e | SCANNED |
| tests/account-pages.spec.ts | 63 | test/e2e | SCANNED |
| tests/advanced-controls.ts | 5 | test/util | SCANNED |
| tests/advanced-stress-suite.spec.ts | 191 | test/e2e | SCANNED |
| tests/agent-scenarios.json | 199 | test/data | SKIPPED (JSON fixture) |
| tests/agent-tools.spec.ts | 119 | test/e2e | SCANNED |
| tests/ai-ide-e2e-001-lifecycle.spec.ts | 64 | test/e2e | SCANNED |
| tests/ai-ide-e2e-002-incremental-fidelity.spec.ts | 327 | test/e2e | SCANNED |
| tests/ai-ide-e2e-004.json | 192 | test/data | SKIPPED (JSON fixture) |
| tests/analytics.spec.ts | 37 | test/e2e | SCANNED |
| tests/anti-recursion-guard.spec.ts | 106 | test/e2e | SCANNED |
| tests/api/api-smoke.spec.ts | 11 | test/e2e | SCANNED |
| tests/audit-remediation.spec.ts | 1018 | test/e2e | SCANNED |
| tests/benchmark/benchmark.config.ts | 222 | test/bench | SCANNED |
| tests/benchmark/orchestrator.spec.ts | 227 | test/bench | SCANNED |
| tests/benchmark/result-writer.ts | 262 | test/bench | SCANNED |
| tests/benchmark/task-checks/easy-1-unit-converter.ts | 271 | test/bench | SCANNED |
| tests/benchmark/task-checks/easy-2-todo-list.ts | 252 | test/bench | SCANNED |
| tests/benchmark/task-checks/easy-3-color-palette.ts | 186 | test/bench | SCANNED |
| tests/benchmark/task-checks/hard-1-analytics-dashboard.ts | 158 | test/bench | SCANNED |
| tests/benchmark/task-checks/hard-2-chat-ui.ts | 160 | test/bench | SCANNED |
| tests/benchmark/task-checks/hard-3-booking-calendar.ts | 165 | test/bench | SCANNED |
| tests/benchmark/task-checks/index.ts | 37 | test/bench | SCANNED |
| tests/benchmark/task-checks/medium-1-kanban.ts | 262 | test/bench | SCANNED |
| tests/benchmark/task-checks/medium-2-signup-wizard.ts | 287 | test/bench | SCANNED |
| tests/benchmark/task-checks/medium-3-product-catalog.ts | 324 | test/bench | SCANNED |
| tests/benchmark/task-checks/very-hard-1-project-management.ts | 241 | test/bench | SCANNED |
| tests/benchmark/task-checks/very-hard-2-ecommerce.ts | 231 | test/bench | SCANNED |
| tests/benchmark/task-checks/very-hard-3-collab-editor.ts | 170 | test/bench | SCANNED |
| tests/browser-policy.ts | 28 | test/util | SCANNED |
| tests/chaos-concurrent-mutation.spec.ts | 257 | test/e2e | SCANNED |
| tests/chaos-model-stress.spec.ts | 124 | test/e2e | SCANNED |
| tests/chaos-preview-injection.spec.ts | 146 | test/e2e | SCANNED |
| tests/chaos-responsive.spec.ts | 120 | test/e2e | SCANNED |
| tests/chaos-race-conditions.spec.ts | 186 | test/e2e | SCANNED |
| tests/consistent-logo-asset.spec.ts | 77 | test/e2e | SCANNED |
| tests/critical-remediation.spec.ts | 151 | test/e2e | SCANNED |
| tests/e2e-agent-streaming-stop.spec.ts | 52 | test/e2e | SCANNED |
| tests/e2e-app-llm-test.spec.ts | 122 | test/e2e | SCANNED |
| tests/e2e-interactive-apps.spec.ts | 80 | test/e2e | SCANNED |
| tests/e2e-projects-lifecycle.spec.ts | 151 | test/e2e | SCANNED |
| tests/e2e-responsive-audit.spec.ts | 63 | test/e2e | SCANNED |
| tests/e2e-security-accessibility.spec.ts | 95 | test/e2e | SCANNED |
| tests/e2e-workspace-monaco.spec.ts | 89 | test/e2e | SCANNED |
| tests/e2e/auth.fixture.ts | 68 | test/util | SCANNED |
| tests/e2e/dead-ui-audit.spec.ts | 64 | test/e2e | SCANNED |
| tests/e2e/generation-matrix.spec.ts | 339 | test/e2e | SCANNED |
| tests/e2e/login-gate.spec.ts | 55 | test/e2e | SCANNED |
| tests/e2e/master-verification-orchestrator.spec.ts | 1115 | test/e2e | SCANNED |
| tests/e2e/multi-model-complexity-suite.spec.ts | 120 | test/e2e | SCANNED |
| tests/e2e/preview-helper.ts | 69 | test/util | SCANNED |
| tests/e2e/responsive-audit.spec.ts | 143 | test/e2e | SCANNED |
| tests/e2e/smoke.spec.ts | 51 | test/e2e | SCANNED |
| tests/edge-preview-remediation.spec.ts | 212 | test/e2e | SCANNED |
| tests/empty-state-hero.spec.ts | 147 | test/e2e | SCANNED |
| tests/extreme-suite.spec.ts | 342 | test/e2e | SCANNED |
| tests/find-iframe.spec.ts | 31 | test/e2e | SCANNED |
| tests/fixtures/lifecycle.ts | 91 | test/util | SCANNED |
| tests/fixtures/publication.ts | 49 | test/util | SCANNED |
| tests/full-platform-advanced.spec.ts | 443 | test/e2e | SCANNED |
| tests/gallery.spec.ts | 30 | test/e2e | SCANNED |
| tests/landing-hero.spec.ts | 91 | test/e2e | SCANNED |
| tests/landing-sections.spec.ts | 141 | test/e2e | SCANNED |
| tests/live-preview.spec.ts | 67 | test/e2e | SCANNED |
| tests/load-test-thousands.mjs | 273 | test/load | SCANNED |
| tests/managed-runtime.spec.ts | 277 | test/e2e | SCANNED |
| tests/measure-hero-center.spec.ts | 82 | test/e2e | SCANNED |
| tests/minimal-redesign-suite.spec.ts | 278 | test/e2e | SCANNED |
| tests/nontechnical-flow.spec.ts | 41 | test/e2e | SCANNED |
| tests/platform-checks-regression.spec.ts | 70 | test/e2e | SCANNED |
| tests/platform-checks.ts | 121 | test/util | SCANNED |
| tests/platform.spec.ts | 123 | test/e2e | SCANNED |
| tests/platform/debug-login-error.spec.ts | 61 | test/e2e | SCANNED |
| tests/platform/full-platform-suite.spec.ts | 94 | test/e2e | SCANNED |
| tests/platform/section2-auth-flow.spec.ts | 121 | test/e2e | SCANNED |
| tests/platform/test-platform.spec.ts | 32 | test/e2e | SCANNED |
| tests/playwright-agent.spec.ts | 166 | test/e2e | SCANNED |
| tests/production-breaker-deep-stress.spec.ts | 427 | test/e2e | SCANNED |
| tests/project-console.spec.ts | 122 | test/e2e | SCANNED |
| tests/project-evidence.ts | 69 | test/util | SCANNED |
| tests/qa-master-suite.spec.ts | 378 | test/e2e | SCANNED |
| tests/quick-templates-borderless.spec.ts | 85 | test/e2e | SCANNED |
| tests/recent-projects.spec.ts | 176 | test/e2e | SCANNED |
| tests/screenshot.spec.ts | 24 | test/e2e | SCANNED |
| tests/seo.spec.ts | 279 | test/e2e | SCANNED |
| tests/sidebar-redesign.spec.ts | 93 | test/e2e | SCANNED |
| tests/status-badge-sync.spec.ts | 162 | test/e2e | SCANNED |
| tests/topbar-and-model-selector-clusters.spec.ts | 89 | test/e2e | SCANNED |
| tests/ui-chat-autoscroll.spec.ts | 55 | test/e2e | SCANNED |
| tests/ui-dashboard-header.spec.ts | 75 | test/e2e | SCANNED |
| tests/ui-login-modal.spec.ts | 40 | test/e2e | SCANNED |
| tests/ui-popover-menu.spec.ts | 96 | test/e2e | SCANNED |
| tests/ui-scrollbars.spec.ts | 40 | test/e2e | SCANNED |
| tests/unified-iconography.spec.ts | 74 | test/e2e | SCANNED |
| tests/viewport-edge-clipping.spec.ts | 79 | test/e2e | SCANNED |
| tests/workspace-clarity.spec.ts | 337 | test/e2e | SCANNED |

---

## Summary

| Status | File count | Total lines |
|--------|-----------|-------------|
| **DEEP** | 62 | ~12,930 |
| **SCANNED** | 355 | ~58,520 |
| **SKIPPED** | 133 | ~45,750 (mostly binary/generated) |
| **Total** | **550** | ~117,200 |

### DEEP files by area

| Area | Count | Key files |
|------|-------|-----------|
| Auth/Crypto/Sessions | 11 | registry.ts, auth.ts, crypto.ts, google-auth.ts, auth-client.ts, email-registry.ts, email.ts, project-access.ts, tenant-request.ts, allowed-origins.ts |
| Worker/Router | 2 | worker.ts, public/_headers |
| Agent/Generation | 4 | agent.ts, message-parser.ts, system-prompt.ts, generation-jobs.ts |
| Runtime (DO) | 15 | project.ts, pilot.ts, managed-auth.ts, managed-store.ts, managed-mail.ts, database-tools.ts, secrets.ts, uploads.ts, verification.ts, publication.ts, provisioning.ts, cloudflare-api.ts, auth-page.ts, worker.ts (runtime) |
| Preview/Sandbox | 2 | preview-fetch.ts, preview-isolation.ts |
| Security | 4 | ssrf.ts, rate-limit.ts, secret-files.ts, check-secrets.mjs |
| Quotas/Limits | 3 | ai-budget.ts, limits.ts, hosted-limit.ts |
| Storage/Data | 5 | project-store.ts, backend-runner.ts, migrations.ts, project-cleanup.ts, concurrency.ts |
| Publishing | 2 | publish-project.ts, provider-clients.ts |
| Uploads | 1 | read-upload.ts |
| Admin UI | 1 | AdminPage.tsx |
| Config/Deploy | 4 | wrangler.toml, wrangler.runtime.jsonc, Dockerfile.runtime, setup-provisioning-token.mjs |
| Client init | 1 | theme-init.js |
