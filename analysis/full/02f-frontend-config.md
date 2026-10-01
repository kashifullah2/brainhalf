# Phase 2 (cont.): Sections F–H–I — Preview/Sandbox completion, CSP, Frontend, Config/CI/Tests

Audit date: 2026-10-01. All line numbers against `main` @ `4ce8302`.

---

## Section F — Preview & Sandbox (completion)

Prior findings M-6 (Referer-based proxy), M-10 (`/api/sync` file-count cap), L-11 (silent oversize drop), I-3 (admin preview CSP) stand. This pass verified the remaining checklist items.

### F-1 (VERIFIED SAFE): Bootstrap HTML injection is properly escaped
- `src/lib/preview-isolation.ts:68` — `isolatedPreviewHtml()` interpolates `${bootstrap}` into an inline `<script type="application/json">` block, but the JSON is produced by `JSON.stringify({projectId, files}).replace(/</g, '\\u003c')`. Escaping `<` neutralizes `</script>` break-out and all HTML-tag smuggling through file contents. **FACT, High confidence.** No finding.

### F-2 (VERIFIED SAFE): `new Function` and style injection are sandbox-confined
- `src/lib/preview-runtime.ts:34` executes transpiled user modules with `new Function('require','exports','module','React', code)`.
- `src/components/PreviewRunner.tsx:685` injects user CSS with `<style dangerouslySetInnerHTML>` (with `</style` neutralized to `<\/style`).
- Both run ONLY inside the opaque-origin sandbox document: `src/preview-main.tsx:10-12` refuses to boot unless `window.origin === 'null'`, and the iframe uses `PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups'` (no `allow-same-origin`) — `preview-isolation.ts:8`. **FACT, High confidence.** The shell document never executes generated code. No finding.

### F-3 (VERIFIED SAFE): Shell-side message handlers validate origin AND source
- `src/components/Workspace.tsx:1047-1050` — `handleWindowMessage` requires `event.origin === 'null'` AND `event.source === iframeRef.current.contentWindow`. The `'null'` origin check is correct because the sandbox is opaque-origin; combined with the source check, no other window/tab can spoof preview messages.
- `src/components/LivePreviewFrame.tsx:39` — same source-equality check before accepting `preview-error`.
- Parent→iframe messages send `previewTargetOrigin` explicitly (Workspace.tsx:1158, 1179). **FACT, High confidence.** No finding.

### F-4 (NOTE): Tailwind CDN + esm.sh in preview CSP — acceptable
- `preview-isolation.ts:52` CSP allows `https://cdn.tailwindcss.com` and `https://esm.sh` in the sandbox document. Because the document is opaque-origin, credential-less, and `connect-src` is network-only, a malicious package cannot reach the shell or platform APIs. Worst case is a broken/misleading preview. **FACT.** No finding; consistent with the sandbox threat model.

---

## Section G — CSP & Headers (completion)

### G-1 (NEW FINDING, Medium): Shell CSP whitelists arbitrary-package CDNs (`unpkg`, `jsdelivr`, `esm.sh`)
- **Evidence**: `src/worker.ts:212-216` — shell `script-src` includes `https://cdn.jsdelivr.net https://unpkg.com https://esm.sh` alongside `'unsafe-eval'`; `style-src` includes jsdelivr; `connect-src` includes jsdelivr.
- These CDNs serve arbitrary user-published npm packages. Any stored/reflected XSS in the shell (none currently known — React escapes by default and markdown uses `skipHtml`) would get arbitrary script execution for free from an attacker-controlled package URL, bypassing the protection a strict CDN allowlist provides. Monaco does NOT need them: `src/components/Workspace.tsx:358` imports `monaco-editor` from the local bundle and `Workspace.tsx:407` calls `loader.config({ monaco })`, so `@monaco-editor/react` never falls back to CDN. The unpkg/jsdelivr entries are legacy leftovers with no current consumer.
- **Label**: FACT. **Confidence**: High. **Recommendation**: self-host Monaco assets (they are already bundled via `monaco-editor` npm package — configure `MonacoEnvironment` to local workers and drop unpkg/jsdelivr from `script-src`); scope `esm.sh` to the preview CSP only (already present there).

### G-2 (CONFIRMS Phase-5 #4): AdSense loads inside the signed-in workspace shell
- **Evidence**: `index.html:19` loads `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-…` in the single HTML shell — there is one shell for landing, login, dashboard, and the signed-in workspace. `worker.ts:212,216` adds the full AdSense/GA domain set to the shell CSP `script-src`/`connect-src`.
- Impact: (a) Google's ad script executes with full DOM access on authenticated screens (it cannot read HttpOnly session cookies but can observe DOM, project names, and keystrokes in principle); (b) AdSense program policies discourage ads on app screens behind login; (c) it enlarges the supply-chain blast radius of the most security-sensitive surface of the product.
- **Label**: FACT. **Severity**: Medium. **Confidence**: High. **Recommendation**: load AdSense only on public marketing routes (landing/blog/docs) — e.g., inject the script tag conditionally when `location.pathname` is a public route — and keep it out of the workspace.

---

## Section H — Frontend

### H-a (VERIFIED SAFE): Markdown rendering
- `src/components/AssistantMarkdown.tsx:8` — `react-markdown` with `skipHtml` (raw HTML never rendered), custom `img` renderer replaced with a text label, `defaultUrlTransform` blocks `javascript:` URLs. **FACT.** No finding.

### H-b (VERIFIED SAFE): Code highlighting XSS sink
- `src/components/CodeFileBlock.tsx:304` uses `dangerouslySetInnerHTML`, but the input is `Prism.highlight()` output (`src/lib/prism-loader.ts:59`), which HTML-escapes source before wrapping tokens. **FACT.** No finding.

### H-c (PASS): Effect cleanup
- ChatPanel.tsx: 23 `useEffect`s, 20 with explicit cleanup (unsubscribe/clear/abort). Workspace.tsx: 27 `useEffect`s, 20 with cleanup. Spot-checked the WS handler effect (`ChatPanel.tsx:695`) and message-listener effects — all remove listeners. **FACT, High confidence.** No leak finding.

### H-d (PASS): Image alt text
- All four `<img>` usages carry `alt` (decorative `alt=""` where appropriate): FinalCta.tsx:15, InteractiveDemo.tsx:292, LandingHero.tsx:214. **FACT.**

### H-e (NOTE): God components remain the top maintainability risk
- `ChatPanel.tsx` (2,543 lines) and `Workspace.tsx` (1,888 lines) concentrate WS lifecycle, file state, preview orchestration, and UI. Both were SCANNED (not DEEP) per the ledger. Behavior-critical logic inside them (e.g., preview state machine) is only reachable through integration-level reasoning; unit coverage exists for extracted libs but not for these components' internal state machines. **INFERENCE, Medium confidence** — refactor candidates, not a bug.

---

## Section I — Config, CI, Scripts, Tests

### I-a (CONFIRMS Phase-5 #7, NEW FINDING, Medium): Main Worker `compatibility_date` is 2 years behind runtime Worker
- **Evidence**: `wrangler.toml:3` = `2024-09-23`; `wrangler.runtime.jsonc:5` = `2026-09-22`.
- The main Worker (auth, registry, agent, preview — the entire security perimeter) runs with September-2024 runtime semantics, forgoing two years of default-behavior fixes (e.g., newer fetch/TLS/streams behavior). The runtime Worker (user-code sandbox) is current.
- **Label**: FACT. **Confidence**: High. **Recommendation**: bump `wrangler.toml` to match, run `npm run verify` + a local smoke pass, deploy. Effort S.

### I-b (CONFIRMS Phase-5 #8, NEW FINDING, Medium): Load test supports no capacity claim; PASS verdict despite total WebSocket failure
- **Evidence**: `load-results/load-summary.json` — `targetHost: http://localhost:5173` (the Vite dev server, not the Worker), `websocket.connectedCount: 0` with `errorCount: 50`, 500 of 1000 HTTP responses were `401`, yet `verdict: "PASS"` (`tests/load-test-thousands.mjs` derives the verdict).
- Two problems: (1) the artifact cannot support any production capacity statement (wrong target, zero WS connections, half the HTTP calls unauthorized); (2) the harness reports PASS when its WebSocket leg fails 100% — a test-integrity bug that would mask a real regression.
- **Label**: FACT. **Confidence**: High. **Recommendation**: fail the verdict when `connectedCount === 0` or `errorCount > 0`; retarget at `wrangler dev` (or a staging Worker); record 401 mix explicitly.

### I-c (CONFIRMS Phase-5 #9 in part, NEW FINDING, Low): CI has no dependency-audit step
- **Evidence**: `.github/workflows/validate.yml` runs `npm ci`, `npm run verify` (typecheck + tests + lint + build) and `verify:release`, but no `npm audit`/audit gate. The `pdfjs-dist` HIGH (H-1) therefore reached `main` without any CI signal.
- The "no e2e in CI" half of the known finding is **REFUTED**: `scripts/verify-release.mjs:9-10` runs `playwright test` plus the SEO Playwright config, and the workflow installs Chrome and uploads `playwright-report/`.
- **Label**: FACT. **Confidence**: High. **Recommendation**: add `npm audit --audit-level=high` (with an allowlist file for accepted transitive dev risk like `undici`).

### I-d (CONFIRMS Phase-5 #6 in part, NEW FINDING, Medium): Admin/pilot identifiers committed to a public repo; `ADMIN_EMAILS` gates skip email-verification check
- **Evidence**: `wrangler.toml:9` `ADMIN_EMAILS = "kashifullah919@gmail.com"`; `wrangler.runtime.jsonc:20` `PILOT_OWNER_IDS` carries a real user id. Both files are tracked; the repo is public.
- The privileged paths keyed on `ADMIN_EMAILS` — AI-budget exemption (`src/registry.ts:281-293`) and project-quota bypass (`src/registry.ts:729-737`) — match `users.email` without checking `email_verification.verified_at`. Password-signup emails are unverified by design (`src/registry.ts:495-497` acknowledges this for OAuth linking). On a fresh deployment (or any fork), whoever first registers the committed admin address — before the real admin does — silently inherits unlimited AI budget and unlimited projects. In the current live deployment the account already exists, so this is a deployment-time/fork risk plus an info-disclosure issue (attackers learn the exact admin email and a pilot user id for targeted phishing).
- The more sensitive admin *routes* were already migrated to a secret owner-ID allowlist (`PRODUCT_METRICS_OWNER_IDS`, `src/worker.ts:389,402,415,426,444,462,482`) — that part of the known finding is **FIXED**.
- **Label**: FACT. **Confidence**: High (mechanics), Medium (live exploitability). **Recommendation**: move `ADMIN_EMAILS` to a secret; require `verified_at IS NOT NULL` for email-match privilege gates; rotate the exposed pilot owner id.

### I-e (NEW FINDING, Low): Prerelease dependency pin `@cloudflare/sandbox@0.13.0-next.769.1`
- **Evidence**: `package.json:41`. A `-next` prerelease of the sandbox SDK is pinned for production deploys. Prerelease APIs can break between builds; pin is exact (good) but upgrade path is untracked.
- **Label**: FACT. **Confidence**: High. **Recommendation**: track the upstream 1.0 release and add a smoke test that exercises the sandbox path on dependency bumps.

### I-f (NEW FINDING, Info): Committed build/test artifacts
- **Evidence**: `tsconfig.node.tsbuildinfo` and `load-results/load-summary.json` are tracked. The former is churn/noise; the latter is the misleading artifact of I-b.
- **Label**: FACT. **Recommendation**: gitignore the tsbuildinfo; either fix the load harness (I-b) or remove the artifact to avoid an unsupported capacity claim living in the repo.

### I-g (PASS): wrangler.toml vars inventory
- Committed vars in `wrangler.toml` are names/identifiers only (ADMIN_EMAILS value aside, covered in I-d); secrets (`PRODUCT_METRICS_OWNER_IDS`, OAuth secrets, keys) are NOT in the file — confirmed by grep and by the Phase-0 secrets scan of tree + history. **FACT.**
