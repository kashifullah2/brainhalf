import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const origin = 'https://brainhalf.com';
const root = resolve('dist');
const sitemap = await readFile(resolve(root, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const revisions = new Map([...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>\s*<\/url>/g)].map(([, url, date]) => [url, date]));
assert(urls.length > 1, 'Sitemap must contain the public pages.');
assert.equal(new Set(urls).size, urls.length, 'Sitemap has duplicate URLs.');
assert.equal(revisions.size, urls.length, 'Every sitemap URL needs an editorial lastmod date.');
for (const [url, date] of revisions) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date, `${url}: invalid lastmod`);
  assert(date <= new Date().toISOString().slice(0, 10), `${url}: future lastmod`);
}
const paths = new Set(urls.map(url => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, origin);
  assert.equal(parsed.search, '');
  return parsed.pathname;
}));
const accountPaths = new Set(['/forgot-password', '/reset-password', '/verify-email', '/resend-verification']);
let themeAsset;
for (const path of [...paths, ...accountPaths, '/404']) {
  const html = await readFile(resolve(root, path === '/' ? 'index.html' : `${path.slice(1)}.html`), 'utf8');
  const startup = html.match(/<script src="(\/assets\/theme-init-([a-f0-9]{12})\.js)"><\/script>/);
  assert(startup, `${path}: theme startup needs a versioned, synchronous script`);
  assert(!html.includes('src="/theme-init.js"'), `${path}: unversioned theme startup`);
  assert(html.indexOf(startup[0]) < html.indexOf('<link rel="stylesheet"'), `${path}: theme startup must precede styles`);
  themeAsset ??= startup[1];
  assert.equal(startup[1], themeAsset, `${path}: inconsistent theme script`);
  const code = await readFile(resolve(root, startup[1].slice(1)), 'utf8');
  assert.equal(createHash('sha256').update(code).digest('hex').slice(0, 12), startup[2], `${path}: stale theme asset hash`);
}
for (const path of accountPaths) {
  assert(!paths.has(path), 'Account pages must stay out of the sitemap');
  assert((await readFile(resolve(root, `${path.slice(1)}.html`), 'utf8')).includes('noindex, follow'));
}
const titles = new Set();
const descriptions = new Set();
const publicLinks = new Map();
for (const path of paths) {
  const file = resolve(root, path === '/' ? 'index.html' : `${path.slice(1)}.html`);
  const html = await readFile(file, 'utf8');
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, `${path}: expected one H1 in the initial HTML`);
  assert.equal((html.match(/<title>/g) || []).length, 1, `${path}: duplicate or missing title`);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
  assert(title && !titles.has(title), `${path}: missing or duplicate title`);
  assert(description && !descriptions.has(description), `${path}: missing or duplicate description`);
  titles.add(title); descriptions.add(description);
  assert(html.includes(`rel="canonical" href="${origin}${path}"`), `${path}: incorrect canonical`);
  assert(html.includes('content="index, follow, max-image-preview:large"'), `${path}: public page is not indexable`);
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] || 'null');
  assert(schema?.['@graph']?.length > 0, `${path}: missing structured data`);
  const pageData = schema['@graph'].find(node => node['@id'] === `${origin}${path}#page`);
  const date = revisions.get(`${origin}${path}`);
  assert.equal(pageData?.dateModified, date, `${path}: schema and sitemap dates must agree`);
  if (path === '/') {
    // The landing page shows no visible "Updated <date>" line by design.
    assert(!new RegExp('<time datetime=', 'i').test(html), `${path}: the revision date must not be visible`);
  } else {
    assert(new RegExp(`<time datetime="${date}"`, 'i').test(html), `${path}: the revision date must be visible`);
  }
  const links = [...html.matchAll(/<a\b[^>]*href="(\/[^"?#]*)[^" ]*"/g)].map(([, href]) => href);
  for (const href of links) assert(paths.has(href) || accountPaths.has(href), `${path}: broken internal link ${href}`);
  publicLinks.set(path, links.filter(href => paths.has(href)));
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/(?:assets|fonts|images|brand)\/[^"?#]+)"/g)) await stat(resolve(root, asset.slice(1)));
  assert(!html.match(/rel="(?:modulepreload|stylesheet)"[^>]+(?:vendor-monaco|editor\.api|Workspace-|ChatPanel-)/), `${path}: editor resources loaded on public page`);
}
// Sitemaps alone do not make an orphan page discoverable through site navigation.
const depths = new Map([['/', 0]]);
for (const [path, depth] of depths) {
  for (const href of publicLinks.get(path) || []) if (!depths.has(href)) depths.set(href, depth + 1);
}
for (const path of paths) assert(depths.has(path) && depths.get(path) <= 3, `${path}: public page must be linked within three clicks of home`);
const llms = await readFile(resolve(root, 'llms.txt'), 'utf8');
assert(llms.startsWith('# BrainHalf\n'), 'llms.txt needs the product identity.');
const readerUrls = [...llms.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => match[1]);
assert.deepEqual(new Set(readerUrls), new Set(urls), 'llms.txt must link to the canonical public pages only.');
const missing = await readFile(resolve(root, '404.html'), 'utf8');
assert(missing.includes('noindex, follow'), '404 must not be indexed.');
const robots = await readFile(resolve(root, 'robots.txt'), 'utf8');
assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
assert(!/^Disallow:\s*\/$/m.test(robots), 'robots.txt blocks the whole site.');
const image = await readFile(resolve(root, 'images/brainhalf-social.png'));
assert.equal(image.subarray(1, 4).toString(), 'PNG');
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
console.log(`SEO checks passed: ${paths.size} indexable pages, unique metadata, structured data, matching visible/sitemap revision dates, internal links, llms.txt, robots, 404, and social image.`);
