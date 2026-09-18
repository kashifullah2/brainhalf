# Feature Add or Remove Recommendations

Based on empirical findings from **Suites A through H**, this document proposes concrete product changes for BrainHalf to elevate reliability, eliminate dummy artifacts, and optimize the developer experience.

---

## 1. Features to Remove

| Feature / UI Element | Location | Reason for Removal | Replacement / Alternative | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Fake Credit Banner** (`3.73 free credit remaining!`) | `ChatPanel.tsx` | Hardcoded static number that does not track real user quotas. Misleads developers and creates visual clutter above the input box. | Real backend credit quota endpoint connected to Stripe/Cloudflare D1 when billing launches. Until then, display no fake badge. | **AUTO-APPLIED** |
| **Inert "Upgrade Plan" Button** | `TopNav.tsx` | Static golden pill button without an active checkout or billing portal. Triggered an alert box rather than a real upgrade flow. | Re-introduce when Stripe customer portal integration is live. | **AUTO-APPLIED** |
| **Floating Assistant Bot Icon** | `LandingPage.tsx` & `Workspace.tsx` | Redundant floating circular widget on the bottom-right corner. It had no distinct agent window and duplicated the primary chat panel already present on the screen. | Primary left chat panel (`ChatPanel.tsx`) provides full conversational context. | **AUTO-APPLIED** |
| **Mock Screenshot Drawer** (`Took a screenshot >`) | `ChatPanel.tsx` | Hardcoded static email mockup card that injected a fixed image into the message stream regardless of what app was being built. | Live preview canvas already renders the real running application; genuine screenshot synthesis can be hooked to headless preview capture. | **AUTO-APPLIED** |
| **"Builder Fest" Announcement Banner** | `LandingPage.tsx` | Outdated static marketing banner taking up vertical space above the project grid. | Clean, unencumbered landing layout with focus on prompt input and user projects. | **AUTO-APPLIED** |

---

## 2. Features to Add

| Proposed Feature | Justification (Test Finding) | Expected Impact | Implementation Complexity | Recommendation Status |
| :--- | :--- | :--- | :--- | :--- |
| **Strict "Zero Dummy UI" Rule in System Prompt** | Suites A1, A2, D1, D2 found that unconstrained LLMs occasionally emit `onClick={() => {}}` or `#` dead links for secondary actions. | Guarantees all generated buttons, toggles, accordions, and modals contain active, functional code. | Low (Prompt engineering in `src/agent.ts`) | **AUTO-APPLIED** |
| **Mandatory Full-Stack Contract Rule** | Suites B1, B2, C1, F found that models generated frontend buttons (e.g. checkout, delete) without corresponding backend `/server/` routes. | Eliminates disconnects between frontend forms and backend storage; ensures data persists across reloads. | Low (Prompt engineering in `src/agent.ts`) | **AUTO-APPLIED** |
| **GLM 5.3 Flash Model Support** | Suite E found `@cf/zai-org/glm-5.3-flash` referenced in benchmark configs and TODO.md but omitted from the active model allowlist in `src/lib/models.ts`. | Expands high-speed coding options on Cloudflare Workers AI with 95 t/s throughput. | Low (Allowlist addition in `src/lib/models.ts` & `ChatPanel.tsx`) | **AUTO-APPLIED** |
| **Console & Network Tab in Workspace Toolbar** | Suite F showed that inspecting generated backend calls currently requires opening browser developer tools. | Embedding a lightweight "Network" tab showing `/api/*` requests inside the preview toolbar will let users see their backend calls working live. | Medium (Iframe `postMessage` listener + UI tab) | **RECOMMENDED FOR APPROVAL** |
| **Two-Way GitHub Sync** | Noted in TODO.md; users who generate clean full-stack apps currently export via ZIP or manual copy. | Native OAuth push/pull to GitHub repositories. | Medium (Worker GitHub App OAuth endpoint) | **RECOMMENDED FOR APPROVAL** |
| **Real User Credit System via Durable Object SQLite** | Removing fake credits leaves a gap for quota management if monetization is desired. | Persist real token/request usage in `AuthRegistry` DO SQLite with webhook triggers. | High (Durable Object schema + billing integration) | **RECOMMENDED FOR APPROVAL** |
