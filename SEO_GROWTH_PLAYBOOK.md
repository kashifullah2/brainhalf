# BrainHalf search growth operating plan

Prepared 24 September 2026. This applies the supplied growth playbook to BrainHalf's actual product, existing pages and tested example. Traffic targets are aspirations, not a forecast. No current Google Search Console dataset is available in this workspace; neither a 500-impression baseline nor any current keyword ranking is verified.

## Implemented in this release

- Corrected stale instructions on the build guide, dashboard, website, free-access and About pages. Managed publishing is now described accurately; the removed Add Backend API button is no longer recommended.
- Added `/use-cases/ai-inventory-app-builder`: stock records, a concrete prompt, sample calculations, permissions and acceptance checks.
- Added `/guides/ai-appointment-app-example`: original build prompt, design follow-up, observed timings, test results, an actual published demo and a 27.6 KB WebP screenshot. The page clearly distinguishes a frontend demonstration from real saved bookings.
- Linked the two pages from the homepage and relevant guides. Build validation now rejects public pages that are unreachable within three clicks of the homepage.
- Retained the existing prerendered HTML, distinct metadata, canonical links, HTTPS redirects, sitemap, genuine editorial dates and private-route indexing controls. The public sitemap grows from 10 to 12 URLs; presence in a sitemap does not establish indexing.
- Existing FAQ structured data describes visible questions. It does not claim Google rich-result eligibility. No ratings, customers, reviews or search volumes were invented.

## Fix the supplied playbook's assumptions

50,000 clicks divided by 200,000 impressions is 25% CTR. At 5% CTR the click goal would require 1,000,000 impressions; at 8%, 625,000. Use the actual branded and nonbranded CTR observed for this site, rather than treating a generic CTR range as a benchmark. Query intent alone does not determine CTR.

Publishing 40–60 pages does not establish a traffic forecast or topical authority. Demand, intent, competition, indexing and page usefulness all matter. Develop unique examples with tested behavior instead of producing thin copies for every industry or city.

Google deprecated FAQ rich results from May 7, 2026. HowTo rich results were retired in 2023. FAQ markup does not win People Also Ask placement. Keep helpful question-and-answer content for readers and use supported structured data only when it accurately describes the page.

Update dates when the content changes substantively. Do not roll the year forward or request indexing on a schedule merely to suggest freshness. Indexing requests, snippets and title changes do not guarantee faster crawling or ranking gains. Titles have no fixed 60-character eligibility limit; write accurate, distinct titles that communicate the page's purpose.

BrainHalf is an online platform. Do not create a Google Business Profile or city pages unless an eligible real-world business presence and a useful local offering exist. Do not publish fabricated reviews or repurpose old link-building service lists without checking that each service still operates.

Sources checked:
- Google Search documentation updates, including May 2026 FAQ deprecation: https://developers.google.com/search/updates
- HowTo and FAQ changes: https://developers.google.com/search/blog/2023/08/howto-faq-changes
- Helpful content and misleading freshness: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- SEO starter guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide

## One page per search intent

These are intent hypotheses to validate with GSC, not measured keywords or volume estimates.

| Reader's task | Primary destination | Next useful action |
| --- | --- | --- |
| Find BrainHalf / choose an AI app builder for a small business | `/` | Describe an app |
| Understand free access, included capabilities and limits | `/free-ai-app-builder` | Start a small project |
| Learn the prompt-to-published-app workflow | `/guides/build-an-app-with-ai` | Follow the tested example |
| Add a real database, sign-in or email | `/guides/full-stack-apps` | Verify saved data and permissions |
| Build a stock-tracking tool | `/use-cases/ai-inventory-app-builder` | Adapt the inventory prompt and checklist |
| See evidence of a generated appointment-request frontend | `/guides/ai-appointment-app-example` | Try the labeled public demo |
| Plan a metrics dashboard | `/use-cases/ai-dashboard-builder` | Define calculations and a source of real data |
| Build a portfolio or business website | `/use-cases/ai-website-builder` | Specify pages and test the live site |

Avoid adding a second “free AI builder” page or several generic appointment pages. Improve the existing destination when the search intent is the same. Do not make a competitor comparison until the relevant workflows have actually been tested under comparable conditions.

## First Search Console session

Use the existing `brainhalf.com` property if accessible; a previous audit reported a Search Console connection. Access and current ownership have not been verified in this task. Do not create a duplicate property unnecessarily.

1. Confirm the property covers `https://brainhalf.com` and inspect the sitemap submission at `https://brainhalf.com/sitemap.xml`.
2. Inspect the homepage, build guide and two new pages. Record indexing state, Google's selected canonical and any excluded-page reason. Inspect the live URL separately from the indexed version.
3. Review Page indexing, Manual actions, Security issues, HTTPS and Core Web Vitals. Do not interpret lack of field data as a pass or a failure.
4. In Performance → Search results choose Web, a complete 28-day window and the preceding 28 days. Keep country/device filters identical and record the dates. Avoid incomplete latest-day data.
5. Review Pages, then filter to a page and inspect its Queries. Separate branded from nonbranded queries. Inspect actual SERPs for intent before changing a page's title.
6. Submit/recheck the sitemap in Bing Webmaster Tools when verified access is available.

GSC and Bing account access, submission and indexing requests have not been performed by these code changes. No backlink outreach or messages to other people have been sent.

## Weekly scoreboard

Copy this table each week and replace “Not measured” only with actual data. Record total clicks and impressions from the same Performance report; anonymous queries mean the sum of displayed query rows may be lower than report totals.

| Metric | Current complete 28 days | Previous 28 days | Decision |
| --- | --- | --- | --- |
| Web search clicks | Not measured | Not measured | Track relevant growth |
| Web search impressions | Not measured | Not measured | Check which pages and queries changed |
| Total CTR = clicks / impressions | Not measured | Not measured | Segment before attributing a change |
| Branded clicks and CTR | Not measured | Not measured | Measure demand for BrainHalf |
| Nonbranded clicks and CTR | Not measured | Not measured | Measure category/use-case discovery |
| Reported query rows with average position 1–3 / >3–10 / >10–20 | Not measured | Not measured | Prioritize specific query–page pairs |
| Indexed submitted public URLs | Not measured | Not measured | Diagnose exclusions; don't use sitemap count as indexed count |
| Top three gaining and losing pages | Not measured | Not measured | Compare intent, content and technical changes |
| Public organic landing-page visits | Not measured | Not measured | Analytics and GSC count different events |
| Verified apps and successful publications | Available in private product reporting | Compare equivalent cohorts | Measure product outcomes separately from public GA4 |

Average position is an aggregate, not a fixed rank. GSC groups and filters can change totals. Record brand-query matching rules, geography, device and search type so comparisons remain interpretable. BrainHalf's public GA4 deliberately stops for signed-in users; it does not provide end-to-end organic signup-to-publication attribution. Do not join private account data into GA4 as a shortcut.

## Prioritize changes from evidence

- First inspect relevant query–page pairs with meaningful impressions and average position 8–20. An initial triage filter of 100 impressions over 28 days is a practical starting point, not a ranking rule; lower it if the site has little data.
- For positions 3–10 and weak CTR, compare the query intent, title and visible answer. Make one deliberate change and record its date. Observe at least another complete comparison period unless the page contains an obvious factual error.
- Add internal links only where the destination helps the reader. Use descriptive natural anchor text and check whether links bring visitors to a useful next step.
- A new page needs a distinct task, a concrete example and a way to test its claims. Measure indexation and relevant query coverage before increasing publishing volume.
- Compare seasonal demand, query mix and page changes before claiming causation from a CTR increase.

## 90-day sequence

| Period | Work | Completion evidence |
| --- | --- | --- |
| Week 1 | Deploy current content fixes; confirm property access, sitemap and page inspection; establish the scoreboard | Live pages pass crawl checks; actual baseline recorded |
| Weeks 2–3 | Improve query–page matches with real impressions; review the two new destinations | Logged changes, relevant searches and indexed-page status |
| Weeks 3–6 | Publish 1–2 original walkthroughs per week if capacity permits: saved task app, permissions, CRM or customer portal | Each walkthrough has a working example, tested steps and clear limits |
| Weeks 6–9 | Build one useful prompt/checklist resource from repeated user needs; assess comparison content through real evaluation | Original reusable resource and observed user use |
| Weeks 9–12 | Refresh pages with evidence from GSC and product questions; consolidate overlapping topics; expand the strongest useful cluster | Comparable 28-day results and documented editorial decisions |

Candidate walkthroughs are an editorial backlog, not a commitment to features that are untested. Do not publish invented customer results to fill the calendar. Authority work can use the public demo, reproducible tests and useful templates as references. Any outreach is a separate authorized action, and ranking gains remain controlled by search engines.

## Deployment and evidence

Deployed main application version `84e59010-6fb5-4986-b502-c09e59a46926`. Source digest: `6881bb4f1bb31b844d9b542b02698624962fb4ba3109c63e0a6eccce1b8bee9a`. The release passed 981 application tests, 102 runtime tests, 36 script tests, 121 platform browser tests and 42 public-page browser tests. The hosting runtime was unchanged by this content release.

The baseline live audit passed for 10 public URLs. Final live evidence is in `audit-artifacts/seo-growth-2026-09-24/after.json`; release receipt, logs and mobile screenshots are in the same directory. These checks establish served HTML and crawl controls, not search-engine indexation or ranking. Fresh Core Web Vitals tracing was not performed because the required Chrome DevTools connector is unavailable.
