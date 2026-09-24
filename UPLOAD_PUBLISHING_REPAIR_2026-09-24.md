# Image upload, publication and streaming repair

The reported project is `proj-676ac3df-1f2a-45d1-8cfd-2de8ed0ebe0a`. Its production logs show repeated TypeScript failures because `lucide-react` no longer exports `Github`, `Linkedin`, and `Twitter`. The `/cdn-cgi/speculation` console warning is a separate preview issue.

## Changes

- Image uploads determine PNG/JPEG/GIF/WebP MIME types from their signatures, preserving the uploaded bytes even when the filename or browser MIME is wrong. Server-side type and size validation still applies.
- Attachment data is stored in transactional 500,000-character chunks, avoiding Durable Object SQLite's 2 MB row limit. Migration 9 adds the chunk table; existing inline attachments remain readable. Failed writes roll back and deletion removes all chunks.
- Publishing snapshots redirect the three removed Lucide brand imports to a local, licensed compatibility module with the original glyphs. Other imports and dependency versions are preserved. The normalized snapshot is idempotent and is hashed identically by the browser and runtime. Saved workspace source is not rewritten by this normalization.
- The generation instructions explain that modern Lucide does not export these brand icons.
- Failed publications display the job's error, its own build logs, and available failed verification details. Log filtering happens before the result limit; unrelated jobs cannot displace the requested job's logs.
- Workers AI tool turns stream visible text before completion while retaining sequential, validated tool execution, cancellation, usage accounting and one-time completion. This removes application-side buffering; provider computation speed has not been benchmarked.
- Opaque previews specify an empty prefetch ruleset with an anonymous CORS-readable endpoint, preventing the default Speed Brain rules URL from being used. Preview sandboxing stays enabled.

## Evidence

- The affected project's saved R2 source was read for diagnosis. Its original build command, `tsc --noEmit && vite build`, passes with the compatibility fix and independently installed declared dependencies, including Lucide 1.47.0.
- The repaired build renders at 1440 px and 390 px with all three social glyphs, no JavaScript exceptions, and no horizontal overflow. Evidence: `/tmp/brainhalf-publish-repro-evidence.json`. Private project source remains outside this report.
- A permanent regression builds a strict TypeScript starter using all three icons against the repository's modern Lucide dependency. Other tests cover alias imports, relative paths, existing-file preservation, idempotence, revision consistency and source limits.
- Browser regression covers PNG bytes labeled as JPEG, an absent MIME, and octet-stream. Workerd smoke covers a 5 MiB attachment round trip and deletion. Unit tests cover chunk rollback, legacy reads and incomplete storage.
- Browser regressions cover failed publishing logs and reading the empty ruleset from an opaque iframe.

## Release status

The guarded `npm run deploy:platform` release completed successfully. It passed 948 application tests, 79 runtime tests, 36 script tests, 116 application browser tests, and 39 public-page browser tests, plus typechecking, lint, production build/SEO, Docker/Worker dry runs, workerd runtime and agent smokes, and secret checks.

| Service | Active version | Traffic |
| --- | --- | --- |
| Main application | `2d3452b9-ec6c-4c6a-bb75-a1555fd13330` | 100% |
| Hosting runtime | `25bef329-d057-44b8-b04a-ce4632cdc0b6` | 100% |

The production homepage returns HTTP 200 with the same four entry asset references as the verified build. Its main JavaScript matches the local artifact byte for byte. The rules endpoint returns HTTP 200, empty rules, `application/speculationrules+json`, `Access-Control-Allow-Origin: *`, and `Cross-Origin-Resource-Policy: cross-origin` for `Origin: null`.

The source and built assets match `.release/validation.json`: source digest `e54c3afbf9afaf49aeb13d77d66845036b6230963d1ab9454a4943675c097418`, artifact digest `56899a0d6db30608bb276892dbea06344044a3a162be8d1e33dab904a2050cf7`. Sanitized deployment metadata, validation receipt and affected-app browser results are saved under `audit-artifacts/releases/2026-09-24-upload-publishing/`. Full command output is in `/tmp/brainhalf-upload-publish-deploy.log`.

The affected app has not been republished through an authenticated production session. After the platform rollout, reload BrainHalf, retry the upload and click Publish again. The prior interactive browser attempts ended before authentication; no live publication or inference success is inferred from those attempts.
