# BrainHalf Live Test — Bug Report
**Date:** 2026-09-27  
**Test method:** 7 unique custom apps created via brainhalf.com prod, each observed live in browser  
**Tester:** Claude Code (automated browser session via Chrome DevTools MCP)

---

## Apps Tested

| # | App Name | Project ID | Outcome |
|---|----------|-----------|---------|
| 1 | Wedding Seating Chart Manager | proj-8212d54a-b863-434b-9e68-eec291ce1738 | Preview loaded, backend API error |
| 2 | Vintage Watch Collector Vault | proj-87aa3ad8-cb2c-4609-9ef4-e2811436ed25 | Ready status, empty "next idea" placeholder |
| 3 | Surf Session Log | proj-09db9210-f133-4e61-925c-ffedf11dfd73 | Ready status, empty "next idea" placeholder |
| 4 | Freelance Invoice Builder | proj-d96e4983-79b0-42d8-a255-3bd6c146ffd0 | ✅ WORKING — preview rendered correctly |
| 5 | Dog Walking Business Scheduler | proj-7886b2b4-13d5-4092-9d14-d028c5d878dd | Rate-limited, never built |
| 6 | Herb Garden Planner | proj-ff9ad07c-6476-43b0-bbbc-bf589aaa2075 | Ready status, empty "next idea" placeholder |
| 7 | Film Production Shot List | proj-df7242a9-5d69-48c4-94bc-5b9fec7a1c98 | "Generation Incomplete" status |

**Success rate: 1/7 apps fully functional (14%)**

---

## Bug #1 — Auth Modal Race Condition

**Severity:** High  
**Affected:** All users on session start  

**Description:**  
When navigating directly to brainhalf.com (or after a hard refresh), an auth/login modal briefly flashes before the session is validated from localStorage. The app does not check `bh_session_token` / `bh_session_user` in localStorage synchronously before deciding whether to show the auth gate, causing a visible flicker even for already-authenticated users.

**Reproduction:**
1. Log in to brainhalf.com (session stored in localStorage)
2. Hard-refresh the page (Ctrl+Shift+R)
3. Observe: auth modal flashes briefly before the workspace loads

**Root cause hypothesis:** Session check is async (likely a network call) — the app should short-circuit with the localStorage token and suppress the auth gate synchronously, only falling back to async re-validation.

**Impact:** Jarring UX for returning users; could lose users who think they've been logged out.

---

## Bug #2 — Duplicate Design-Preview Warning Messages

**Severity:** Medium  
**Affected:** All projects in Preview tab  

**Description:**  
When viewing the app preview in the workspace, a "design preview" notice appears in two places simultaneously:
1. In the workspace header/toolbar area above the iframe
2. Injected directly inside the preview iframe as an overlay banner

The same warning is rendered twice — once by the workspace shell and once injected into the preview frame itself.

**Reproduction:**
1. Open any project at brainhalf.com
2. Click the Preview tab
3. Observe: the preview warning text appears both above the iframe and as an overlay inside it

**Root cause hypothesis:** The workspace shell renders the notice, AND the preview iframe injection script also renders it. One of the two should be removed.

**Impact:** Visual clutter, unprofessional appearance; users may be confused about which is the real state indicator.

---

## Bug #3 — "Generation Incomplete" Status/State Mismatch

**Severity:** High  
**Affected:** App #7 (Film Production Shot List — proj-df7242a9)  

**Description:**  
The agent ran out of context mid-generation and stopped writing files. The chat shows a "Generation Incomplete" warning message, but the project status indicator in the workspace header shows **"Ready"** (green dot). These two signals contradict each other.

The actual app state is broken/incomplete, but the workspace incorrectly presents it as ready-to-use.

**Reproduction:**
1. Submit a complex app prompt that causes the agent to run long
2. Wait for generation to end mid-stream (context exhaustion)
3. Observe: chat shows "Generation Incomplete" but status header shows "Ready"

**Root cause hypothesis:** `status` is set to `ready` when the agent process terminates, regardless of whether generation was complete or the agent exited early. The "Generation Incomplete" flag from the chat layer doesn't propagate back to update the project status.

**Impact:** Users see "Ready" and try to use/publish a broken app. High confusion, wasted time debugging an app that was never fully built.

---

## Bug #4 — Preview Iframe Shows Empty Placeholder Despite "Ready" Status

**Severity:** Critical  
**Affected:** Apps #2, #3, #6 (3 of 7 apps = 43%)  

**Description:**  
Three apps show "Ready" status and have files listed as "Available" in the Code tab, but the Preview tab renders the empty "A place for your next idea" placeholder screen instead of the compiled app. The iframe content is not the user's app at all — it's the default empty-state template.

This means the preview system failed to compile or serve the generated source files for these projects, but the workspace shows no error and the status is "Ready".

**Reproduction:**
1. Create any app prompt at brainhalf.com
2. Wait for generation to complete (status becomes "Ready")
3. Go to the Preview tab
4. Observe: empty "A place for your next idea" screen instead of the app

**Root cause hypothesis candidates:**
- Preview iframe is pointing to the wrong URL or a stale dev server that was never restarted after generation
- Vite hot-reload failed silently; dev server is serving old empty state  
- Build step did not run after file generation; preview is serving pre-generation empty shell
- Race condition: status flips to "Ready" before the preview server has fully restarted with new files

**Impact:** Users cannot see or test their generated app. Core product loop is broken for ~43% of apps in this test. This is the highest-impact bug found.

---

## Bug #5 — Silent Rate-Limit: App Never Built, Status Shows "Ready"

**Severity:** High  
**Affected:** App #5 (Dog Walking Business Scheduler — proj-7886b2b4)  

**Description:**  
App #5 was submitted while 4 other apps were already generating (BrainHalf enforces a max of 4 concurrent generations per account). The app hit the concurrent generation limit and was never built. However:
- The project status shows **"Ready"** in the workspace header
- No generation ever ran (no files were written)
- The chat showed a rate-limit warning, but only in the conversation panel

The status indicator is wrong — it shows "Ready" for an app that has never been generated.

**Reproduction:**
1. Create 4 apps simultaneously (all generating)
2. Submit a 5th app prompt  
3. Observe: chat shows a rate-limit/concurrency warning
4. After the warning: the project status shows "Ready" despite no generation occurring
5. Preview tab shows the empty placeholder

**Root cause hypothesis:** The "Ready" status reflects the project's *agent availability* (agent loop idle) rather than whether app content was actually generated. When the generation is blocked by rate limiting, the agent exits immediately and the project stays in an idle "Ready" state with no files.

**Impact:** Users see "Ready" and assume their app was built successfully, then are confused when the preview is empty. The rate-limit case needs a distinct status (e.g., "Not built" or "Generation pending") and a clear CTA to retry.

---

## Bug #6 — Backend API Error in Preview (App #1)

**Severity:** Medium  
**Affected:** App #1 (Wedding Seating Chart Manager — proj-8212d54a)  

**Description:**  
App #1's preview iframe renders the full React UI (forms, layout, table cards) but immediately shows the error: **"Could not load seating chart data."** This is a runtime API failure — the frontend was generated and is rendering, but the Cloudflare Workers backend is either not deployed, returning errors, or the D1 database isn't initialized.

Notably, the app *looks* functional — all UI elements are present and interactive — but all data operations fail at the API layer.

**Reproduction:**
1. Open proj-8212d54a at brainhalf.com
2. Preview tab shows the Wedding Seating Chart UI
3. Observe error banner: "Could not load seating chart data.×"
4. Attempting to add a table or guest results in no data being saved

**Root cause hypothesis:** The Workers backend was generated but not deployed to Cloudflare (or the deployment failed silently). The frontend makes fetch calls to a backend URL that either doesn't exist yet or is returning 500s. The D1 schema may also not have been migrated.

**Impact:** The app appears complete but is non-functional for its core purpose. Users would assume it's a bug in their app rather than a deployment issue.

---

## Summary Table

| Bug | Severity | Apps Affected | Core Issue |
|-----|----------|--------------|------------|
| #1 Auth modal race condition | High | All users | Session check async, localStorage not checked sync |
| #2 Duplicate preview warning | Medium | All projects | Warning rendered in both workspace shell + iframe |
| #3 Generation Incomplete / Ready mismatch | High | App #7 | Status doesn't reflect generation failure |
| #4 Preview shows empty placeholder (Ready status) | **Critical** | Apps #2, #3, #6 | Preview server not updated after generation |
| #5 Rate-limited app shows "Ready" | High | App #5 | Status reflects agent idle, not app built |
| #6 Backend API error in preview | Medium | App #1 | Workers not deployed / D1 not initialized |

**Recommended fix priority:** Bug #4 (Critical) → Bug #3 (High) → Bug #5 (High) → Bug #1 (High) → Bug #6 (Medium) → Bug #2 (Medium)

---

## Screenshots

Screenshots saved to: `audit-artifacts/2026-09-27/live-7apps/`

- `app1-wedding-seating.png` — App #1: UI renders but backend API error
- `app4-invoice-builder.png` — App #4: Only fully working app (reference/baseline)
- `app7-film-shotlist.png` — App #7: Generation Incomplete with Ready status
