# BrainHalf Roadmap & TODO 📌

A comprehensive tracking list of completed milestones, immediate priorities, feature enhancements, and long-term architectural goals for the **BrainHalf** autonomous AI development platform.

---

## 🚀 Completed Milestones

- [x] **Zero Cold-Start Edge Preview Engine**: Built native Cloudflare Edge Preview (`/preview/:projectId/`) using Sucrase for instant on-the-fly JSX/TSX transpilation on Cloudflare Workers.
- [x] **Dual Preview Engines**: Integrated both Cloudflare Edge Preview (instant edge execution) and Sandpack (in-browser virtual bundler) with toggle support in the preview toolbar.
- [x] **Spec-Compliant Dual-MIME CSS Serving**: Implemented dual-mode CSS HTTP router in Durable Objects:
  - Serves valid JS module (`Content-Type: application/javascript; charset=utf-8`) with automatic `<style>` injection when imported via ES module scripts (`import './styles.css'`).
  - Serves raw stylesheet (`Content-Type: text/css; charset=utf-8`) when requested via `<link rel="stylesheet">`.
- [x] **Durable Object SQLite Storage**: Embedded SQLite inside `ChatAgent` DOs for ACID-compliant persistence of conversation history (`messages`) and project source files (`project_files`).
- [x] **Multi-Model AI Support**: Configured dropdown selector supporting:
  - **AWS Bedrock**: Claude Opus 4.6, Claude Sonnet 4.6, MiniMax M2.5.
  - **Cloudflare Workers AI**: Qwen 2.5 Coder 32B, Qwen 3.8 27B, GLM 5.3 Flash, Kimi K2.7 Code, Llama 3.3 70B.
- [x] **Unlimited Token Generation & Stepping Ladder**: Implemented descending token ladder (`[16384, 8192, 4096, 2048]`) to guarantee maximum token output capacity without Cloudflare ceiling errors.
- [x] **Truncation & Syntax Validation Guard**: Added pre-save Sucrase syntax validation in `extractAndSaveFiles` to prevent incomplete or cut-off AI generations from corrupting working files.
- [x] **Variable Collision Prevention Rules**: Enforced strict prompting against colliding collection arrays and scalar counters (`coinEntities` vs `coinsCollected`) to eliminate `TypeError: g.coins is not iterable` runtime errors.
- [x] **Clean UI Dropdowns**: Removed duplicate browser stepper arrows (`▲▼`) using `appearance: none` and eliminated duplicate top-level deploy selectors.
- [x] **Infallible Bootstrap Mount Harness**: Replaced error-prone `main.jsx` with an immutable React 18 ErrorBoundary harness that intercepts runtime errors and provides one-click reloads.
- [x] **Production Domain Routing**: Configured custom domain routing for `https://brainhalf.com` and `https://www.brainhalf.com` with strict no-cache asset headers.

---

## ✅ Recently Completed (Sep 2026)

- [x] **Click-to-edit inspect mode** — cursor button activates element selection overlay in design preview; clicking sends element info to chat input
- [x] **Live app preview** — embedded iframe from `dev-{id}.apps.brainhalf.com` with CHIPS cookie auth for full-stack app testing
- [x] **Streaming generation progress bar** — determinate rail with filename strip, file count, and checkmark flashes
- [x] **Auto-fix TypeScript build errors** — `useAutomaticBuildFix` hook triggers repair without user action
- [x] **Right-click context menu** — quick actions (change text/style/color, remove) in design preview
- [x] **GitHub auto-sync** — PAT stored session-only, repo name persisted per project, auto-push after generation
- [x] **One-click Undo** — amber Undo button in Code toolbar restores pre-generation checkpoint
- [x] **Command palette (Ctrl+K)** — fuzzy file search and quick actions (publish, export, tabs, undo)
- [x] **Split view** — toggle code editor and live preview side by side; hidden on small screens
- [x] **File explorer CRUD** — create file (+), rename (double-click / pencil), delete (trash with confirmation)
- [x] **Source history UI overhaul** — relative timestamps, auto-save/manual sections, inline diff with per-file change badges
- [x] **Fast expired session detection** — iframe onLoad fetches preview URL to detect JSON error, shows styled error immediately
- [x] **Model persistence** — selected AI model saved to localStorage across sessions
- [x] **Share button relabeled** — "Copy link" instead of "Share" with honest tooltip

---

## 🎯 High Priority (Next Up)

- [ ] **Resizable split pane** — drag handle to adjust code/preview ratio in split view
- [ ] **GitHub OAuth** — replace PAT flow with GitHub OAuth app for zero-friction repo connection
- [ ] **Package management UI** — view installed npm packages, add/remove with live Import Map update
- [ ] **Public sharing / viewer mode** — share projects publicly (not just your own login link)
- [ ] **Console output drawer** — capture preview `console.log`/`warn`/`error` via postMessage, filterable by severity

---

## 🎨 UI & UX Enhancements

- [ ] **Device Viewport Switcher**:
  - Preview toolbar buttons to toggle viewport size:
    - 📱 Mobile (375 × 667 / 390 × 844)
    - 📟 Tablet (768 × 1024)
    - 💻 Desktop (100% responsive)
  - Custom width/height input fields and zoom-to-fit scale.
- [ ] **Diff Viewer for AI Changes**:
  - Visual side-by-side or inline diff preview before applying AI-suggested surgical edits.
  - Accept or reject individual file modifications.
- [ ] **Project Templates Gallery**:
  - Quick-start starter cards on new project creation:
    - *Crypto Dashboard & Portfolio*
    - *2D Retro Arcade / Canvas Game*
    - *Kanban & Task Management*
    - *E-commerce Storefront & Cart*
    - *AI Chat & RAG Interface*
- [ ] **Dark / Light Theme Toggle**:
  - Full theme system support for light mode while preserving sleek dark cyber aesthetics as default.
- [ ] **Keyboard Shortcuts Overlay (`Ctrl + /` or `Cmd + /`)**:
  - Quick modal listing editor keybindings, preview reload, export shortcuts, and tab switching.

---

## 🧠 AI Agent & Generation Capabilities

- [ ] **Automatic Code Splitting (Multi-Component Refactoring)**:
  - Agent capability to intelligently break down monolithic `App.jsx` files into modular files (`/src/components/...`) as projects grow beyond 10KB.
- [ ] **Image-to-Code Vision Upload**:
  - Support drag-and-drop screenshots or wireframe sketches into the chat input.
  - Send image payload to multimodal models (Claude Sonnet 4.6, Llama 3.2 Vision) to replicate UI layouts accurately.
- [ ] **Interactive Planner / Review Mode**:
  - Support `/plan` slash command where the agent outlines an architecture blueprint and waits for explicit user confirmation before writing code.
- [ ] **Automated Test Generation**:
  - Capability for agent to write Vitest/Testing Library test suites in `/src/__tests__/` and run verification.

---

## ⚡ Infrastructure, Security & Reliability

- [ ] **Snapshot Backups to Cloudflare R2**:
  - Scheduled background cron or on-export snapshot of DO SQLite files to R2 storage for disaster recovery.
- [ ] **Rate Limiting & Abuse Prevention**:
  - Rate limiting on edge preview HTTP endpoints (`/preview/:id/*`) to prevent DDoS or bandwidth abuse.
  - Cloudflare Turnstile integration on anonymous project creation if public traffic scales.
- [ ] **Automated CI/CD Deployment**:
  - GitHub Actions workflow running Oxlint, Vitest, TypeScript verification, and Wrangler deploy on git push to `main`.
- [ ] **Sandpack Virtual Bundler Fallback Improvements**:
  - Automatically synchronise preview engine selection with user preferences in `localStorage`.
