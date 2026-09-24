import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_PAGES, SITE_URL, contentModified } from '../seo/content';
import { isPrivateSearch, pageMetadata, structuredData } from '../seo/metadata';
import { render, sitemap, llmsText } from '../seo/render';
import { previewSecurityHeaders } from '../lib/preview-isolation';
vi.mock('agents', () => ({ routeAgentRequest: vi.fn(), Agent: class {} }));
vi.mock('../agent', () => ({ ChatAgent: class {} }));
import worker from '../worker';

const paths = ['/', ...PUBLIC_PAGES.map(page => page.path)];
describe('Public HTML and search metadata', () => {
  it.each(paths)('delivers visible, linked content and matching structured metadata for %s', path => {
    const { html, head } = render(path);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('<main');
    expect(head).toContain(`rel="canonical" href="${SITE_URL}${path}"`);
    expect(head).toContain('index, follow, max-image-preview:large');
    expect(head).toContain('property="og:image" content="https://brainhalf.com/images/brainhalf-social.png"');
    const data = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/)![1]);
    expect(data['@graph'].some((node: { url?: string }) => node.url === `${SITE_URL}${path}`)).toBe(true);
    const known = new Set(paths);
    for (const [, href] of html.matchAll(/<a\b[^>]*href="(\/[^"?#]*)[^" ]*"/g)) expect(known.has(href), `${path} links to missing ${href}`).toBe(true);
    const sectionIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) expect(sectionIds.has(id), `Missing section ${id}`).toBe(true);
  });
  it('uses distinct titles and descriptions, and lists only canonical public URLs', () => {
    expect(new Set(paths.map(path => pageMetadata(path).title)).size).toBe(paths.length);
    expect(new Set(paths.map(path => pageMetadata(path).description)).size).toBe(paths.length);
    const urls = [...sitemap().matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
    expect(urls).toEqual(paths.map(path => `${SITE_URL}${path}`));
    expect(sitemap()).not.toMatch(/\?(?:project|google)=|\/api\/|\/preview\/|\/404/);
  });
  it('describes the confirmed free offer without inventing reviews and excludes missing pages', () => {
    expect(JSON.stringify(structuredData('/'))).not.toMatch(/aggregateRating|reviewCount/);
    expect(JSON.stringify(structuredData('/'))).toContain('"price":"0"');
    const missing = render('/not-a-page');
    expect(missing.head).toContain('noindex, follow');
    expect(missing.head).not.toContain('rel="canonical"');
    expect(missing.html).toContain('This page isn’t here.');
  });
  it('keeps editorial dates stable across rebuilds and consistent with visible content', () => {
    const before = sitemap();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      expect(sitemap()).toBe(before);
      for (const path of paths) {
        const date = contentModified(path);
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(sitemap()).toContain(`<loc>${SITE_URL}${path}</loc><lastmod>${date}</lastmod>`);
        expect(render(path).head).toContain(`"dateModified":"${date}"`);
        expect(render(path).html).toMatch(new RegExp(`<time datetime="${date}"`, 'i'));
        expect(render(path).head).not.toContain('datePublished');
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it('identifies both guides as articles with an organization author', () => {
    for (const path of paths.filter(path => path.startsWith('/guides/'))) {
      expect(pageMetadata(path).type).toBe('article');
      expect(render(path).head).toContain('property="article:modified_time"');
      expect(render(path).head).toContain(`"author":{"@id":"${SITE_URL}/#organization"}`);
      expect(render(path).html).toContain('rel="author"');
    }
  });
  it('gives readers canonical public references without exposing private routes', () => {
    const links = [...llmsText().matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => match[1]);
    expect(new Set(links)).toEqual(new Set(paths.map(path => `${SITE_URL}${path}`)));
    expect(links).toHaveLength(paths.length);
    expect(llmsText()).toContain('Every signed-in user can publish');
    expect(contentModified('/404')).toBeUndefined();
    expect(contentModified('/reset-password')).toBeUndefined();
  });
});

describe('Private search surfaces', () => {
  it.each(['?project=private', '?google=complete', '?token=value', '?_uid=user', '?utm_source=test&project=private'])('excludes %s from search', async search => {
    expect(isPrivateSearch(search)).toBe(true);
    const response = await worker.fetch(new Request(`${SITE_URL}/${search}`), { ASSETS: { fetch: async () => new Response('public shell') } }, {} as never);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('keeps the public homepage crawlable, including campaign links', async () => {
    expect(isPrivateSearch('?utm_source=search')).toBe(false);
    const response = await worker.fetch(new Request(`${SITE_URL}/?utm_source=search`), { ASSETS: { fetch: async () => new Response('public shell') } }, {} as never);
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
  });
  it('excludes preview and API responses', async () => {
    expect(previewSecurityHeaders()['X-Robots-Tag']).toBe('noindex, nofollow');
    const response = await worker.fetch(new Request(`${SITE_URL}/api/private`), {}, {} as never);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});
