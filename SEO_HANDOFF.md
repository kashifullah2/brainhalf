# BrainHalf SEO implementation

The September 24 growth update corrected stale publishing instructions and added two useful destinations with stronger internal links and a tested original app walkthrough. (The growth playbook and its audit artifacts were pruned in the September 28 repository cleanup; this handoff retains the operative guidance.)

The September 28 update added five use-case pages after Search Console showed impressions with zero clicks for specific inventory and dashboard queries: book, warehouse/stock-control, equipment/asset and personal inventory, plus a customer-portal dashboard page. Each page has distinct workflow content, a ready-to-adapt prompt and an acceptance checklist; the general inventory page now links to all four variants. Watch the query report over the following weeks and improve the pages that earn impressions rather than adding more near-duplicate pages.

The September 22–23 notes below are historical. Their SEO and cache changes were deployed in the September 24 platform releases. A previous audit reported an existing Search Console property; use that property if accessible. Current GSC access, indexing and traffic still need direct account evidence.

### Cache audit follow-up — 23 September 2026

Live checks found `/theme-init.js` using `public, max-age=0, must-revalidate`; the main hashed JS/CSS already use `public, max-age=31536000, immutable`. All three live responses had gzip compression. A CDN cache hit does not mean the browser can reuse a file without revalidation.

The production prerender step now builds the theme initializer as a standalone minified classic script, writes a content-hashed `/assets/theme-init-<hash>.js`, and references it before styles on all 15 HTML pages. It inherits the existing one-year immutable asset policy. The current output is 383 bytes versus 576 bytes in the source. It remains synchronous so appearance is applied before the page paints. The legacy `/theme-init.js` URL gets one-hour caching; it is not marked immutable.

Validation: production build and artifact checks passed, along with 26 focused SEO/header tests and all 17 SEO browser scenarios. Browser coverage checks real cache headers and theme startup with app bundles blocked, including invalid preferences and unavailable storage. Lint and `git diff --check` passed, with the existing unrelated `uploads.ts` lint warning. Logs: `/tmp/brainhalf-cache-build.log` and `/tmp/brainhalf-cache-browser.log`.

This historical cache fix was subsequently deployed. For a fresh audit, confirm the new script URL in the homepage source, its cache/compression headers, and re-run the external audit. Cloudflare's [static asset header documentation](https://developers.cloudflare.com/workers/static-assets/headers/) and [compression documentation](https://developers.cloudflare.com/speed/optimization/content/compression/) were checked for this change.

Implemented September 22, 2026. The owner confirmed that BrainHalf is completely free to use. Public copy describes free building while explaining that technical limits and external services can still apply. No ranking, unlimited-use, or free-hosting guarantees are made.

## What changed

- Public React pages render into HTML during every production build. Visitors and crawlers receive the same content, with working links before JavaScript executes.
- Homepage titles and descriptions target the free AI app builder category. Each supporting page has distinct, useful content, metadata, canonical URLs, Open Graph/Twitter sharing tags, and appropriate Schema.org data.
- Organization, WebSite, SoftwareApplication, WebPage/Article, and breadcrumb data describe the actual product. The owner-confirmed free offer has price 0; no reviews or ratings are invented.
- `/robots.txt` and `/sitemap.xml` identify crawlable public pages. Query URLs containing project or auth data receive `noindex`; preview and API responses are also excluded. Authentication remains the access control.
- Public HTML uses clean URLs without trailing slashes; missing pages return a real 404 with a useful error page. Broken footer destinations now have factual product pages.
- Workspace components load on demand. The build checks guard against preloading editor resources on public pages. Fingerprinted assets use immutable caching; fonts and images have bounded cache lifetimes.
- The original 1200 × 630 social-sharing image lives at `/images/brainhalf-social.png`; its editable source is alongside it as SVG.

## Public search destinations

| URL | Purpose |
| --- | --- |
| `/` | BrainHalf / free AI app builder product entry |
| `/free-ai-app-builder` | Free access, included capabilities, usage and external costs |
| `/guides/build-an-app-with-ai` | Practical prompt-to-preview and launch guide |
| `/use-cases/ai-dashboard-builder` | Dashboard planning, example prompt, data and testing |
| `/use-cases/book-inventory-app-builder` | Bookstore/library catalog: ISBN records, condition, sales vs lending |
| `/use-cases/warehouse-inventory-app-builder` | Bin locations, receipts, putaway, picks, transfers and cycle counts |
| `/use-cases/equipment-asset-inventory-app-builder` | Serialized equipment/IT assets: custody, check-out/return, maintenance |
| `/use-cases/personal-inventory-app-builder` | Home inventory for insurance/moving: rooms, values, photos, export |
| `/use-cases/customer-dashboard-builder` | Customer-facing portal dashboard with per-account data isolation |
| `/use-cases/ai-website-builder` | Portfolio/business website workflow and example prompt |
| `/about` | Product identity and capabilities |
| `/privacy` | Implemented account, AI, and project data flows |
| `/terms` | Product usage guidelines and preview limitations |

The privacy overview and usage guidelines describe the current implementation. They do not invent a legal entity, support address, guaranteed deletion timeline, or negotiated contractual terms. Keep them aligned with actual operations and add the operator’s confirmed contact/legal details when available.

## Verify and publish

Local validation completed:

- `npm run verify`: TypeScript, 699 application tests, 9 deployment-script tests, lint, production builds, prerendering, and built SEO artifact checks passed.
- All 12 SEO browser checks passed against the local Cloudflare Worker, covering crawl responses, redirects, private-query headers, hydration, mobile themes, navigation without JavaScript, and deferred editor downloads.
- All 13 project-library and workspace regression checks passed across the initial run and a focused retry. The initial run had one project-deletion assertion timeout; the focused retry passed without code changes.

The initial validation above is historical. SEO is deployed. The 23 September hardening deployment adds `/guides/full-stack-apps`; all 21 public SEO/account/analytics browser checks passed, and live guide/canonical/sitemap checks passed. Search Console ownership verification and submission have not been performed. See `PLATFORM_HARDENING_2026-09-23.md` for the current deployment and evidence.

```bash
cd /home/kashifullah/brainhalf
npm run test:e2e:seo
npm run deploy
```

`npm run deploy` runs the repository’s full verification, creates the public HTML and sitemap, checks the built SEO artifacts and required secret names, then deploys the configured Worker. Use Node 22.18 or newer. `npm run check:seo` checks an existing build without deploying.

After deployment, check the live artifacts:

```bash
curl -I https://brainhalf.com/
curl -I 'https://brainhalf.com/?project=seo-header-check'
curl -I https://brainhalf.com/this-page-does-not-exist
curl https://brainhalf.com/robots.txt
curl https://brainhalf.com/sitemap.xml
```

The public homepage should return 200. The query URL should carry `X-Robots-Tag: noindex, nofollow`. The missing path must return 404. Root source should contain the page’s actual headline and links. Check that `www.brainhalf.com` continues redirecting to the apex domain; the live site had that redirect before this work.

## Google Search Console: owner action required

1. Open https://search.google.com/search-console and add a **Domain** property for `brainhalf.com`.
2. Copy Google’s generated DNS TXT value. Add it to the domain’s DNS using exactly the host and value Google supplies, then click Verify. This requires domain-owner access; there is no verification token in this repository.
3. Submit `https://brainhalf.com/sitemap.xml` in **Sitemaps**.
4. Use **URL inspection → Test live URL** on the homepage and the three principal guides. Confirm that rendered content is visible and indexing is allowed, then request indexing. The indexing request is a request, not a guarantee.
5. Check **Page indexing**, **HTTPS**, **Core Web Vitals**, **Manual actions**, and **Security issues** for problems.
6. Test structured data at https://search.google.com/test/rich-results. Valid schema alone does not guarantee rich results; software-app rich-result eligibility can require additional genuine information. Do not add invented review ratings to satisfy a validator.

For Bing, verify the site at https://www.bing.com/webmasters/ and submit the same sitemap. These account-owned submissions have not been performed by the code changes.

## Measure and improve after launch

- After indexing begins, use Search Console’s Performance report to record impressions, clicks, click-through rate, and average position for the homepage and each guide. Review weekly, comparing equivalent periods; new sites may have little initial data.
- Watch actual searches around “AI app builder,” “free AI app builder,” “build an app with AI,” and the specific use cases. Google handles common misspellings; do not add typo-stuffed pages or invisible keywords.
- Improve pages that get impressions but few clicks by making their titles and examples more useful and accurate. Avoid repeated title changes without enough data.
- Publish real, owner-approved project walkthroughs with working examples and original screenshots. Describe the prompt, iterations, tested behavior, limits, and exported code rather than claiming unsupported success metrics.
- Earn relevant links through genuine product documentation, useful demos, and transparent directory listings. Do not buy link packages, mass-post comments, fabricate testimonials, or generate many near-identical keyword pages.
- Check field Core Web Vitals once Search Console has enough traffic data. A local browser test cannot establish real-user performance percentiles.

Google decides whether and where a page appears. This implementation removes technical gaps and improves relevance; first position for competitive terms depends on indexing, useful content, reputation, competitors, and time.

## Reference documentation consulted

- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
