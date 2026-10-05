# BrainHalf — Feature Interaction Map

> **Updated:** 2026-10-05 — reflects all 15 bug fixes. See `CODEBASE_KNOWLEDGE.md §17` for full changelog.


## Feature → Backend Component Map

```
Feature                    Files Involved (entry → handler → storage)
────────────────────────────────────────────────────────────────────────

AI Generation
  UI entry:               ChatPanel.tsx (handleSendMessage)
  WS message:             { type: 'generate', prompt, model, files }
  Handler:                agent.ts (onMessage → runGeneration)
  Core libs:              system-prompt.ts, models.ts, provider-clients.ts
                          agent-capabilities.ts, concurrency.ts, ai-budget.ts
                          message-parser.ts, exact-edits.ts, migrations.ts
  Storage writes:         project_files, messages, generation_usage,
                          generation_jobs (ChatAgent SQLite)
  External:               Workers AI / Bedrock / Anthropic / Atria
  Events emitted:         appEvents file-generated, generation-status

Live Preview (browser)
  UI entry:               Workspace.tsx (PreviewCanvas, PreviewRunner)
  Fetch:                  GET /preview/{id}/api/files (Worker → ChatAgent)
  Core libs:              preview-isolation.ts, preview-module-transform.ts
                          preview-import-map.ts, preview-runtime.ts
                          backend-runner.ts (InMemoryDataStore)
  Security:               project-access.ts, secret-files.ts
  Events emitted:         appEvents preview-state, preview-success

Authentication
  UI entry:               LoginScreen.tsx → login() / signup()
  HTTP:                   POST /api/auth/login → handleLogin() → AuthRegistry
  Core libs:              auth.ts, auth-client.ts, crypto.ts, google-auth.ts
  Storage:                users, sessions (AuthRegistry SQLite)
  External:               Google OAuth (accounts.google.com)

Project Management
  UI entry:               DashboardPage.tsx, App.tsx
  HTTP:                   GET/DELETE/PATCH /api/projects → AuthRegistry
  Client storage:         project-store.ts (IndexedDB + localStorage)
  Server storage:         project_owners (AuthRegistry SQLite)
  Events emitted:         appEvents project-list-updated, project-account-changed

Managed Runtime
  UI entry:               PublishPopover.tsx, ProjectConsole.tsx
  HTTP:                   POST /api/projects/:id/runtime/* → Runtime Worker
  Handler:                runtime/worker.ts → ProjectRuntime DO
  Storage:                project_jobs, project_logs, project_releases (Runtime SQLite)
  External:               Cloudflare D1 API, Workers Deploy API, R2, Sandbox

Publication
  UI entry:               PublishPopover.tsx
  HTTP:                   PUT /api/projects/:id/publication → AuthRegistry
                          POST /api/projects/:id/runtime/jobs → Runtime Worker
  Handler:                runtime/project.ts (publish pipeline)
  Storage:                project_owners.published, project_releases
  Routing:                /p/{alias} → DISPATCHER.get(alias)

Gallery & Remix
  UI entry:               GalleryPage.tsx, GalleryRow.tsx
  HTTP:                   GET /api/gallery (public)
                          PUT /api/projects/:id/showcase (owner)
                          POST /api/projects/:sourceId/remix (authed)
  Handler:                worker.ts → AuthRegistry + ChatAgent
  Storage:                project_owners.showcased, project_owners.remix_count

Builder Tools (MCP/Skills/Attachments)
  UI entry:               AgentTools.tsx (MCP servers, skills, file uploads)
  HTTP:                   /agents/chat-agent/:id/builder/* → ChatAgent
  Handler:                agent.ts → BuilderService
  Storage:                builder_mcp, builder_skills, builder_attachments,
                          builder_attachment_chunks (ChatAgent SQLite)
  During generation:      prepareCapabilities() → mcp tools in streamText

GitHub Export
  UI entry:               GithubSyncModal.tsx
  HTTP:                   /api/projects/:id/runtime/github/* → Runtime Worker
  Handler:                runtime/project.ts → github-export.ts
  External:               api.github.com

Admin Console
  UI entry:               AdminPage.tsx (lazy loaded at /admin)
  HTTP:                   /api/admin/* → AuthRegistry (users, projects, models)
                          /api/admin/projects/:id/preview/* → ChatAgent
  Gate:                   isOperator() in worker.ts
```

## Feature-to-Feature Dependencies

```
AI Generation
  ─ REQUIRES → Authentication (must have session, project ownership)
  ─ REQUIRES → Project Management (project must exist, be owned)
  ─ WRITES TO → Live Preview (file updates trigger preview refresh)
  ─ USES → Builder Tools (attachments/MCP if configured)
  ─ GATED BY → AI Budget (daily limits checked via AuthRegistry)

Live Preview
  ─ READS FROM → AI Generation (project_files in ChatAgent)
  ─ REQUIRES → Authentication (owner access OR published flag)
  ─ INDEPENDENT OF → Managed Runtime (two separate preview modes)

Managed Runtime
  ─ REQUIRES → AI Generation (needs generated source files)
  ─ REQUIRES → Authentication (service binding carries userId)
  ─ ENABLES → Publication (can only publish if runtime is available)
  ─ MANAGES → Pilot slots (PilotCoordinator limits to 10 per user)

Publication
  ─ REQUIRES → Managed Runtime (needs build + verify pipeline)
  ─ UPDATES → Project Management (productionPublished flag)
  ─ ENABLES → Deployed app at /p/:alias
  ─ UPDATES → AuthRegistry (published flag for public preview)

Gallery & Remix
  ─ READS FROM → Publication (only published+showcased projects appear)
  ─ USES → AI Generation (remix triggers file copy into new ChatAgent)
  ─ REQUIRES → Authentication (remix requires login)

Builder Tools
  ─ ENHANCES → AI Generation (tools available during generation)
  ─ INDEPENDENT OF → Preview (attachments don't affect preview directly)
  ─ REQUIRES → Authentication (attached to project ownership)
```

## Event Flow Diagram

```
appEvents (src/lib/events.ts) — In-process pub/sub

Publisher                Event                    Subscriber(s)
─────────────────────────────────────────────────────────────────
ChatPanel (WS handler)   generation-status        App.tsx (generationActive)
                                                   Workspace.tsx (build UI)
                                                   GenerationProgress

ChatPanel (WS handler)   file-generated           Workspace.tsx (file map)
ChatPanel (WS handler)   file-deleted             Workspace.tsx (file map)

Workspace.tsx            sync-files               ChatPanel (ws.send sync_files)
Workspace.tsx            workspace-files-changed  ChatPanel (broadcast to agent)

ChatPanel                workspace-session-ready  App.tsx (release creation lock)
ChatPanel                workspace-sync-error     ProjectConsole.tsx

Workspace.tsx            preview-state            ChatPanel (preview clock)
Workspace.tsx (iframe)   preview-success          ChatPanel

ProjectRuntime           runtime-status           App.tsx (runtimeActive)

project-store.ts         project-account-changed  ChatPanel (rebind store)
project-store.ts         project-list-updated     DashboardPage, RecentProjects

App.tsx                  project-switched         ChatPanel (navigate)

AppEvents.on(           auto-fix-error           Workspace.tsx (auto-repair trigger)
  'auto-fix-error')

AppEvents.on(           stop-generation-request  ChatPanel (stop + ws close)
  'stop-generation')
```
