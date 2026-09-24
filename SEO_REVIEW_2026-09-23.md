# BrainHalf SEO review — 23 September 2026

The supplied audit shows a technically crawlable site with little search-performance history. The immediate work is accurate page metadata, useful product explanations, and indexing checks. Third-party grades are not Google ranking scores.

## Verified findings and local changes

| Finding | Evidence and response |
| --- | --- |
| Missing sitemap dates | The live sitemap contains 10 public URLs and no `lastmod` entries. Added explicit per-page modification dates, matching visible `<time>` dates and JSON-LD `dateModified`. |
| Unrecognized FAQ | The live HTML already contains the FAQ answers. Centralized six questions and answers so the rendered accordion and FAQPage data agree. Questions are headings; the first answer is open initially and all answers work without JavaScript. |
| Unclear product category in the hero | Added a direct description of BrainHalf as a free AI app builder with preview and source export, while preserving the headline and design. Dashboard and website pages now name their product category in their H1. |
| Freshness and attribution | Added visible page revision dates and BrainHalf organization bylines on the two guides. Corrected the full-stack guide to Article metadata. No historical publication date or personal author was invented. |
| Extractable structure and sources | Converted the homepage workflow into an ordered list. Added question headings to relevant guides/use cases, corrected stale “Manage” references to “Code,” and linked relevant Google, W3C, OWASP, and Cloudflare documentation alongside the advice it supports. All five reference URLs returned HTTP 200 during this review. |
| Missing `llms.txt` | The live endpoint returns 404. Added a build-generated Markdown guide linking only the 10 canonical public pages. It is optional, not an access-control mechanism or a promised ranking benefit. |
| “No og:image” | The live raw HTML already supplies Open Graph and Twitter image URLs. The live PNG is reachable and measures 1200 × 630. Retained the image and added its explicit Open Graph MIME type. Re-fetch the card in the audit/sharing tool after deployment. |
| Rendering failure | The live homepage returns HTTP 200 with its H1, content, FAQ, and links in the initial HTML. The audit's failed browser capture does not establish missing crawler content. Production-build browser checks cover JavaScript-disabled content and hydration. |
| CTA contrast | Local screenshot review found the public guide's “Start building” link inheriting the wrong foreground color. Corrected the anchor style and added a browser contrast check for the light and dark themes. |

The dates start at `2026-09-23`, reflecting this content/structured-data revision and the public-page updates made on that date. They are stored in `src/seo/content.ts`, not generated from the build clock. Change only the dates of pages with meaningful content, link, or structured-data updates. A footer copyright rollover does not justify new dates. The build rejects missing, inconsistent, invalid, and future dates, and a test verifies that rebuilding at a later clock time preserves the sitemap.

These changes are local until deployed. Search Console submission, indexing requests, backlink outreach, and account-owned settings have not been changed.

## Interpret the audit carefully

- **FAQ rich results:** Google's current documentation changelog says this feature stopped appearing on 7 May 2026; the former FAQ documentation URL now redirects to the changelog. FAQPage data can still describe the site's questions, but it does not restore a Google FAQ rich result.
- **GEO:** Clear, accessible explanations are useful. A vendor's GEO score does not establish whether ChatGPT, Google, or another system will cite a page. The homepage is a product page: invented statistics, testimonials, quotations, or authors would make it less trustworthy. Add measured examples when real evidence is available.
- **AI search requirements:** Google's AI-feature guidance explicitly says no special AI text files or schema are required for AI Overviews or AI Mode. The optional `llms.txt` reader guide does not change that.
- **Performance:** Several A+ checks were unmeasured because the tool could not open a browser. Mobile LCP of 2.72 seconds is above the 2.5-second good threshold. Lab results and real-user Core Web Vitals are different; the report says there is insufficient field data. No new performance trace or field measurement was made in this review.
- **Social/local:** Add only genuine official profile links and matching Organization `sameAs` URLs when those URLs are confirmed. Facebook Pixel is advertising instrumentation, not a required SEO fix. This web product does not need an invented address, phone, opening hours, or LocalBusiness schema. Hreflang is unnecessary without alternate localized pages; AMP is not a requirement.
- **Dates:** Accurate `lastmod` is a recrawl signal, not a ranking guarantee. Google documents that it uses the value when consistently and verifiably accurate.
- **Data quality:** One impression for `xkiro dashboard` and seven analytics sessions are too little to diagnose relevance, CTR, or engagement. Do not change the homepage to target that unrelated phrase. A single backlink snapshot does not establish a gain/loss trend.
- **Audit application errors:** PDF export and screenshot-capture failures belong to the audit workflow until independently reproduced as site failures.

## Search intent and page ownership

Treat the supplied volumes as estimates for the audit's configured market, not validated demand or a guarantee of traffic. Keep one useful destination for each intent rather than creating near-duplicate pages for spelling variants.

| Priority | Search intent | Existing destination | Content direction |
| --- | --- | --- | --- |
| 1 | AI app builder; AI web app builder; BrainHalf | `/` | Product definition, preview, source export, real capabilities, clear starting action. |
| 1 | Free AI app builder; free access and costs | `/free-ai-app-builder` | What is included, usage limits, export, and separate hosting/provider costs. Distinguish this detail page from the homepage. |
| 1 | Build an app with AI; prompt to app; no-code starting point | `/guides/build-an-app-with-ai` | Practical workflow, sample prompt, tests and launch requirements. |
| 1 | AI website builder; website builder with code export; portfolio website | `/use-cases/ai-website-builder` | Website-specific brief, responsive behavior, forms, export, and published-site SEO. |
| 2 | AI dashboard builder; custom dashboard builder | `/use-cases/ai-dashboard-builder` | Define metrics, filters, tables, real data, and verification. |
| 2 | Full-stack AI app builder | `/guides/full-stack-apps` | Real runtime behavior, pilot eligibility, sign-in, database recovery, and export requirements. |
| Later | MVP builder; customer portal builder | A tested original walkthrough when available | Publish a real example with an initial prompt, screenshots, working behavior, limitations, and exported source. Avoid a generic keyword-only page. |

“Best vibe coding tools” and “best AI website builder” require an honest comparison with firsthand evaluation. They are not a reason to label BrainHalf “best” without evidence. Broad portfolio templates, interactive websites, and unrelated keywords are lower priority than the product's actual workflow.

## Backlinks: investigate quality before taking action

The report lists 36 backlinks from 33 domains and an average third-party authority score of 14. These numbers do not measure Google's trust or prove a penalty. The repeated promotional anchor “Increase Organic Traffic with High Quality brainhalf.com Backlinks” and the 65% repeated-anchor share warrant inspection. Domain names alone do not establish whether a link is harmful.

1. Export actual linking URLs from the audit and compare them with Search Console's Links report. Separate homepage and site-wide counts and check whether links are current, relevant, and placed in editorial content or paid/generated lists.
2. Check Search Console **Manual actions** and **Security issues**. Do not disavow domains automatically because their DA is low or their anchor repeats. If BrainHalf deliberately commissioned link schemes, document them and assess cleanup against Google's guidance.
3. Earn relevant references through useful public demos, factual launch listings, developer write-ups, and real integration examples. Use natural brand names or descriptive links that fit each source; do not prescribe artificial anchor-text percentages.
4. Review a consistent 28-day period after more data accumulates. Track relevant impressions, clicks, indexed pages, and referral visits, not just the count of links or the vendor's authority score.

No links were purchased, removed, disavowed, or requested from other people in this work.

## After deployment

1. Fetch the live sitemap and `llms.txt`; confirm the 10 canonical URLs and stable modification dates. Inspect raw HTML for matching dates and FAQ data.
2. Use the existing Search Console property shown in the report. Inspect the homepage and principal guides, submit/recheck `https://brainhalf.com/sitemap.xml`, and review Page indexing, Manual actions, and Security issues. Ownership verification only needs work if access to that property is missing.
3. Re-run the audit once its browser capture works. Re-fetch social cards separately. Check the Page indexing report over the following weeks; a submission does not guarantee indexing.
4. Review queries by page once there is enough data. The homepage and free-access page should remain distinct; adjust them if actual query/page evidence shows cannibalization.

## Validation completed

- `npm run verify` passed: 809 application tests, 45 runtime tests, 16 script tests, TypeScript, lint, production build, prerendering, and SEO artifact checks. The initial sandboxed run could not pass the local HTTP integration test; the authorized run outside the sandbox passed.
- All 22 SEO/account/analytics browser scenarios passed against the local production build, including each public route, sitemap and reader-guide responses, real 404s, private query headers, JavaScript-disabled FAQ/content/navigation, hydration, keyboard controls, and mobile light/dark layouts.
- After the screenshot review's final CTA color fix, rebuilt successfully and reran both mobile theme scenarios. Both passed, including a computed text/background contrast requirement of at least 4.5:1.
- `git diff --check` passed. Existing lint warnings in `src/runtime/uploads.ts` and the editor bundle-size warning remain unrelated to these SEO changes.
- Screenshots: `audit-artifacts/2026-09-23/seo-refresh/`. Logs: `/tmp/brainhalf-seo-refresh-verify.log`, `/tmp/brainhalf-seo-refresh-browser.log`, `/tmp/brainhalf-seo-refresh-build.log`, `/tmp/brainhalf-seo-refresh-contrast.log`.
- This review did not deploy changes or re-run the third-party audit, so no new SEO/GEO score or search ranking is claimed.

## Sources checked

- Google sitemap guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google documentation changelog, including FAQ deprecation: https://developers.google.com/search/updates
- Google people-first content and freshness guidance: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google JavaScript SEO: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- Google AI-feature guidance: https://developers.google.com/search/docs/appearance/ai-features
- Google disavow guidance: https://support.google.com/webmasters/answer/2648487
- Live BrainHalf homepage, sitemap, robots, social PNG, and `llms.txt` response; files captured under `/tmp/brainhalf-seo-live-*` during this review.
