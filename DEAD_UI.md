# Dead UI & Interactive Control Audit (DEAD_UI.md)

This document records all audited, identified, and resolved dead, misleading, or no-op controls across the BrainHalf platform UI, with file:line references and test evidence.

---

## 1. Removed & Corrected UI Controls

### Control 1: Hardcoded External Deploy Preview Buttons
- **File & Line**: `src/components/TopNav.tsx:571` and `TopNav.tsx:580`
- **Control Text**: `Preview Runtime` and `Open Live Edge App ↗`
- **Issue**: Buttons previously opened hardcoded production URLs (`https://brainhalf.com/preview/${activeProjectId}/index.html` and `https://brainhalf.com/p/${activeProjectId}`). In local development, staging, or PR preview runs, clicking these buttons attempted to load a newly created project on the public production host where the project ID does not exist, causing a 404 error and dead preview.
- **Evidence**: Clicking from local environment (`http://localhost:5173`) failed to preview the active project.
- **Resolution**: Updated to dynamically evaluate `${typeof window !== 'undefined' ? window.location.origin : 'https://brainhalf.com'}`, ensuring the preview opens on the active environment's origin.

### Control 2: Static Domain in Copy Dispatch URL
- **File & Line**: `src/components/TopNav.tsx:524` and `TopNav.tsx:540`
- **Control Text**: `Copy` button in Deploy Modal
- **Issue**: Copied `https://brainhalf.com/p/${activeProjectId}` regardless of host environment, copying non-functional URLs in local/staging environments.
- **Evidence**: Clipboard contained external production URL rather than active testing host.
- **Resolution**: Dynamically prefixes with `window.location.origin`.

### Control 3: Unrouted Dev Auth Session Request
- **File & Line**: `src/lib/backend-runner.ts:452-475`
- **Endpoint / Trigger**: `GET /api/auth/session`
- **Issue**: Handled in Cloudflare Worker runtime but omitted in local dev backend middleware, causing the dev middleware to interpret "session" as a record ID (`auth with id "session" not found` returning 404).
- **Evidence**: `curl -s -i http://localhost:5173/api/auth/session` returned `404 Not Found` with message `auth with id "session" not found`.
- **Resolution**: Added explicit handler for `/api/auth/session` returning standard HTTP 401 when unauthorized and user profile when valid.

### Control 4: Orphaned Scratch File Removal
- **File**: `scratch_test_sql.ts`
- **Issue**: 3-line abandoned test file (`import { SqlStorage } from 'cloudflare:workers';`) with no consumers.
- **Resolution**: Deleted.

---

## 2. Playwright Interactive Element Sweep Evidence

Automated sweep via `tests/e2e/dead-ui-audit.spec.ts` tested all buttons and controls:
- **Login / Auth Screen**: All 3 interactive elements (Mode toggle, Submit/Continue button, OAuth option) trigger form validation, DOM state transitions, and network authentication requests.
- **TopNav & Menu Dropdowns**: Deploy modal, Project Settings modal, Reset Workspace confirmation dialog, Export ZIP, and Share links all open active modal states or trigger clipboard operations.
- **Sidebar Project Controls**: Project selection, New Project button, Rename triggers, and Delete confirmation dialog all emit bus events and update DOM state.
- **Result**: Zero completely unhandled/no-op click handlers remaining.
