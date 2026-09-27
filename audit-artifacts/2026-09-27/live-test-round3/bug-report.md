# BrainHalf Live Test Round 3 — Bug Report
**Date:** 2026-09-27  
**Test method:** 7 unique custom apps submitted simultaneously on brainhalf.com prod  
**Tester:** Claude Code (automated browser session via Chrome DevTools MCP)

---

## Apps Tested

| # | App Name | Project ID | Final Status | Outcome |
|---|----------|-----------|-------------|---------|
| 1 | Plant Disease Diagnosis Log | proj-f4460b88 | Stopped | Generation Incomplete — frontend never written |
| 2 | Rowing Training Split Tracker | proj-a59f9d8e | Stopped | Generation Incomplete — frontend never written |
| 3 | Homebrewing Beer Recipe Builder | proj-28ad1216 | Stopped | Generation Incomplete — frontend never written |
| 4 | Classic Car Show Entry Manager | proj-28a9b864 | Error | Generation failed (cause unclear, chat preserved) |
| 5 | Sourdough Baking Journal | proj-598ca42a | Error | Rate limit exceeded — chat history reset |
| 6 | Freelance Proposal Tracker | proj-5a19bc84 | Error | Rate limit exceeded — chat history reset |
| 7 | Plant Propagation Tracker | proj-d171e1d4 | Error | Rate limit exceeded — chat history reset |

**Success rate: 0/7 apps fully functional (0%)**

---

## Bug #1 — Context Exhaustion: Backend-First Generation Leaves Frontend Unwritten

**Severity:** Critical  
**Affected:** Apps 1, 2, 3 (3 of 7 = 43% hit rate)  
**Status shown:** `Stopped` — "GENERATION INCOMPLETE — The frontend wasn't finished"  

**Description:**  
When the agent decides to build a full-stack app (Workers + D1 backend + React frontend), it writes the backend code first: shared types, calculation logic, Cloudflare Worker, SQL migrations. This backend code consumes most or all of the model's context window, leaving no room to write the React UI components.

The user ends up with a project that has backend files but no frontend whatsoever — the app cannot be previewed or used at all.

**Files saved vs. missing examples:**

*App 1 (Plant Disease Log) — 5 of 14 files saved:*
- ✅ src/types.ts, src/lib/storage.ts, src/components/Header.tsx, FilterBar.tsx, IncidentForm.tsx
- ❌ PlantTimeline.tsx, IncidentList.tsx, StatsCards.tsx, App.tsx, styles.css (5 missing)

*App 3 (Beer Recipe Builder) — 5 of 15 files saved:*
- ✅ shared/calculations.ts, shared/types.ts, worker/index.ts, migrations/0001_recipes.sql, src/lib/styles.ts
- ❌ ALL React components missing (0 UI files saved)

**Platform recovery UX (good):**  
The platform correctly shows "Stopped" status and displays: *"The agent set up backend files but ran out of context before writing the app interface. Ask it to build the frontend."* with an **"Ask agent to build the UI"** CTA button. This is useful guidance.

**Root cause hypothesis:**  
The agent's planning step (visible in chat) allocates the full context to both backend and frontend. When executing, writing a Workers + D1 backend + migrations + types consumes ~60-80% of the context window. When the agent finally starts writing React components, it runs out mid-way or before even starting.

**Fix recommendation:**  
1. For initial generation, always start with the frontend/UI before the backend
2. Or split generation into two phases: a "Plan + Frontend" pass, followed by a "Backend" pass
3. Or detect when context is nearing exhaustion and prioritize saving a runnable minimal frontend

---

## Bug #2 — Rate Limit Error: Chat History Lost on Concurrent Limit Exceeded

**Severity:** Critical  
**Affected:** Apps 5, 6, 7 (all submitted while 4 others were already running)  
**Status shown:** `Error` — "Your app hasn't been built yet."  

**Description:**  
The platform enforces a max 4 concurrent generation limit per account. When a 5th, 6th, or 7th app is submitted while 4 are already generating:
1. The excess apps fail immediately with `Error` status
2. **The chat history is completely reset** to an empty "What are we making?" state
3. The original user prompt that was submitted is permanently lost
4. The user has no way to retry with their original prompt

**What the user sees:**
- Status badge: `Error` (red dot)
- Preview pane: "Your app hasn't been built yet. The last request couldn't finish. Open the conversation to retry or choose another model."
- Chat panel: Empty "What are we making? Start with an idea. We'll work through the details together." — the original prompt is gone

**Contrast with non-rate-limit Error (App 4):**  
App 4 also shows `Error` status, but the original prompt message is preserved in the chat history. This confirms there are two different error paths — the rate-limit path incorrectly clears chat state.

**Root cause hypothesis:**  
When the rate limit is hit, the agent process is rejected before saving the initial user message to the project's conversation history. The project is created but the message is never stored, leaving the chat blank.

**Fix recommendations:**  
1. Save the initial prompt to the conversation history BEFORE checking the rate limit
2. Show a "Queued" or "Rate limited" status instead of "Error" — error implies something went wrong, not that the user needs to wait
3. Show the original prompt in the chat even when rate limited
4. Provide a "Retry when available" or "Queue this request" button

---

## Bug #3 — Rate Limit Shows "Error" Instead of "Queued" or "Waiting"

**Severity:** High  
**Affected:** Same as Bug #2 (Apps 5, 6, 7)  

**Description:**  
When the 4-concurrent limit is exceeded, the platform shows `Error` status with the generic message "The last request couldn't finish." This is misleading — it implies the app failed due to a technical error, not that the user just needs to wait.

**User impact:**  
Users who submit multiple apps will think their prompt triggered a bug, not that they've hit a usage limit. They may try to debug their prompt or think the platform is broken.

**Fix recommendation:**  
Show a specific "Rate limited" or "Waiting for availability" status with a clear message: "You've reached the limit of 4 simultaneous generations. This app will begin building when a slot becomes available."

---

## Bug #4 — Screenshot Performance: Pages Actively Rendering Can't Be Captured

**Severity:** Medium (operational/monitoring bug)  
**Affected:** Pages 3, 4, 5 during heavy generation rendering  

**Description:**  
During active generation, several workspace pages consistently hit `Page.captureScreenshot` timeout errors. The pages appear to be rendering/updating frequently (as files stream in), causing the Chrome DevTools screenshot mechanism to time out (>120s).

**Impact:**  
Cannot visually monitor generation progress via automated screenshots on actively-rendering workspaces. This also likely affects users on slow connections who may see partial renders or frozen screens.

**Observation:**  
Pages 1 and 2 completed screenshots fine. Pages 3, 4, 5 consistently timed out. The difference may be related to the complexity of the generation state or the number of simultaneous iframes being rendered.

---

## Context Notes on Previous Rounds

### Round 3 vs Round 1 (Bug #4: Preview Shows Empty Placeholder)
In Round 1, several apps showed "Ready" + empty preview. In Round 3, none of the apps reached "Ready" state — they either Stopped with incomplete generation or failed with Error. The Round 1 "empty preview with Ready status" bug was not reproduced in this run because no apps completed successfully.

### "Stopped" Status Correctly Shown for Incomplete Generation
Unlike Round 1 Bug #3 (where "Generation Incomplete" chat message + "Ready" status was a mismatch), Round 3 apps 1-3 correctly show "Stopped" status with the Generation Incomplete preview. This may have been fixed in production between Round 1 and Round 3 tests, OR it represents a different code path triggered by "frontend not written" specifically.

---

## Summary Table

| Bug | Severity | Apps Affected | Core Issue |
|-----|----------|--------------|------------|
| #1 Context exhaustion — frontend never written | Critical | Apps 1, 2, 3 | Agent writes backend first, runs out of context |
| #2 Rate limit error + chat history lost | Critical | Apps 5, 6, 7 | Prompt not saved before rate-limit rejection |
| #3 Rate limit shows "Error" not "Queued" | High | Apps 5, 6, 7 | Wrong status label for concurrent limit |
| #4 Screenshot timeout on busy pages | Medium | Apps 3, 4, 5 | Heavy renders block Chrome DevTools capture |

**Recommended fix priority:** Bug #2 (Critical) → Bug #1 (Critical) → Bug #3 (High) → Bug #4 (Medium)

---

## Screenshots

Screenshots saved to: `audit-artifacts/2026-09-27/live-test-round3/`

- `app1-plant-disease-start.png` — App 1 starting: Building status, files streaming in
- `app1-plant-disease-progress.png` — App 1 final: Stopped + "The frontend wasn't finished"
- `app2-rowing-start.png` — App 2 starting: Building status, planning visible
- `app2-rowing-progress.png` — App 2 final: Stopped + "The frontend wasn't finished"
- `app3-beer-start.png` — App 3 starting: Building status
- `app3-beer-final.png` — App 3 final: Stopped + "The frontend wasn't finished"
- `app4-carshow-start.png` — App 4 starting: Building status, full-stack plan
- `app6-freelance-check.png` — App 6: Error + chat reset to "What are we making?"
- `app7-propagation-check.png` — App 7: Error + chat reset to "What are we making?"

---

## Combined Findings Across All 3 Test Rounds

| Bug | Round | Severity | Status |
|-----|-------|----------|--------|
| Auth modal flicker for returning users | Round 1 | High | Fixed locally (App.tsx) |
| Duplicate design-preview warning message | Round 1 | Medium | Fixed locally (preview-mode.ts) |
| Generation Incomplete + "Ready" status mismatch | Round 1 | High | Fixed locally (Workspace.tsx) |
| Preview shows empty placeholder despite "Ready" | Round 1 | Critical | Fixed locally (Workspace.tsx + preview-entry.ts) |
| Rate-limited app shows "Ready" | Round 1 | High | Partially addressed (needs dedicated status) |
| Backend API error in preview | Round 1 | Medium | Open |
| Session expiry across all tabs simultaneously | Round 2 | High | Open — needs investigation |
| Context exhaustion — frontend never written | Round 3 | Critical | Open — needs agent strategy change |
| Rate limit error + chat history permanently lost | Round 3 | Critical | Open |
| Rate limit shows "Error" instead of "Queued" | Round 3 | High | Open |
