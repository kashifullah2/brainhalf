# Phase 0: Baseline

Audit date: 2026-10-01. Branch: `main`. Read-only.

---

## Repository stats

| Metric | Value |
|---|---|
| Commits | 141 |
| Branch | main |
| Tracked files | 550 |
| LOC (excl tests, generated.d.ts) | ~85,000 |
| .ts files | 228 |
| .tsx files | 65 |
| .css files | 28 |
| .mjs files | 21 |
| .md files | 10 |

### Largest files (LOC)

| File | Lines | Note |
|---|---|---|
| src/runtime/generated.d.ts | 15,749 | Auto-generated, excluded from review |
| package-lock.json | 8,335 | — |
| src/agent.ts | 3,717 | Core agent / generation logic |
| src/components/ChatPanel.tsx | 2,543 | Chat UI |
| src/index.css | 2,429 | Global styles |
| src/components/Workspace.tsx | 1,888 | Main workspace shell |
| src/runtime/project.ts | 1,261 | Runtime project DO |
| src/lib/backend-runner.ts | 1,092 | Backend execution |
| src/registry.ts | 1,006 | Auth registry DO |
| src/worker.ts | 915 | Worker router |

---

## Static analysis

### TypeScript

Both configs pass clean (exit 0):

- `tsc --noEmit` (main tsconfig)
- `tsc --noEmit -p tsconfig.runtime.json`

### oxlint

0 errors. ~10 warnings:

- Unused variables/imports in Workspace.tsx, InteractiveDemo.tsx, ProjectServices.tsx, runtime test
- `Date.now()` called during render in AdminPage.tsx:163 and PreviewRunner.tsx:652

---

## Dependency audit (npm audit)

7 vulnerabilities total.

| Package | Severity | Direct? | Issue |
|---|---|---|---|
| **pdfjs-dist** | **HIGH** | **Yes** | Arbitrary JS execution on malicious PDF |
| undici | High | No (via wrangler) | DoS via WebSocket deflate, orphaned RetryHandler body, response splitting |
| dompurify | Low | No | IN_PLACE afterSanitize hook leaves detached subtree event handlers |
| fast-uri | Moderate | No | Inconsistent host case normalization via percent-encoded octets |
| ip-address | Moderate | No | isInSubnet() cross-family comparison; unbounded parse diagnostic (DoS) |
| miniflare | Moderate | No (via wrangler) | Inherits undici issues |
| wrangler | Moderate | Yes | Inherits miniflare issues |

**Key finding:** `pdfjs-dist` HIGH is the most actionable item. It is a direct dependency. Users who open a malicious PDF in the BrainHalf workspace could trigger arbitrary JS execution. The transitive undici/wrangler/miniflare issues affect dev tooling only and do not ship to production.

---

## Test suites

| Suite | Files | Tests | Result |
|---|---|---|---|
| Vitest (main) | 132 | 1,290 | All pass |
| Vitest (runtime) | 6 | 130 | All pass |
| node --test (scripts) | 7 | 36 | All pass |
| **Total** | **145** | **1,456** | **0 failures** |

Vitest (main) was run 3 times consecutively. No flaky tests detected.

---

## Build

Vite build succeeds. 23 pages prerendered. SEO checks pass (18 indexable pages, unique metadata, structured data, sitemap, llms.txt, robots, 404, social image).

### Largest production chunks

| Chunk | Size | Gzip |
|---|---|---|
| editor.api (Monaco) | 2,654 kB | 684 kB |
| vs (Monaco) | 1,267 kB | 320 kB |
| preview-runtime | 468 kB | 141 kB |
| Workspace | 437 kB | 112 kB |
| pdf | 410 kB | 122 kB |
| index | 368 kB | 113 kB |
| ChatPanel | 298 kB | 90 kB |

Two chunks exceed the 1,000 kB warning threshold (Monaco editor). These are lazy-loaded and expected for a code editor workspace.

---

## Code duplication (jscpd)

| Format | Files | Total lines | Clones | Duplicated lines |
|---|---|---|---|---|
| TSX | 74 | 15,377 | 10 | 142 (0.92%) |
| TypeScript | 244 | 49,978 | 87 | 3,272 (6.55%) |
| **Total** | **318** | **65,355** | **97** | **3,414 (5.22%)** |

Nearly all TypeScript duplication is in `src/runtime/generated.d.ts` (auto-generated). TSX duplication at 0.92% is healthy.

---

## Secrets scan

- **Tracked files**: No real secrets found. One example placeholder in `test-agent.mjs:14` (`AUTH_TOKEN="your-shared-secret"`).
- **Git history (last 50 commits)**: Contains `.env.example` files and `scripts/check-secrets.mjs` (appropriate tooling). No actual secret files.
- **Working tree**: No `.env` files present.

**Result**: Clean.

---

## Summary of key baseline findings

1. **HIGH: pdfjs-dist vulnerability** — direct dependency, arbitrary JS execution via malicious PDF. Needs upgrade or mitigation.
2. **Moderate: transitive dep chain** (undici → miniflare → wrangler) has DoS vectors — dev-only, lower urgency.
3. **Low: oxlint warnings** — unused imports and `Date.now()` in render are minor code quality issues, not bugs.
4. All 1,456 tests pass, no flakiness. Build is clean. No secrets in tree or history.
