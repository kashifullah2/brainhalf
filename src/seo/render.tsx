import React from 'react';
import { renderToString } from 'react-dom/server';
import LandingPage from '../components/landing/LandingPage';
import PublicPage from '../components/PublicPage';
import GalleryPage from '../components/GalleryPage';
import { ACCOUNT_PAGES, HOME_DESCRIPTION, PUBLIC_PAGES, contentModified, findPublicPage, SITE_URL, SOCIAL_IMAGE } from './content';
import AccountPage from '../components/AccountPage';
import { pageMetadata, structuredData } from './metadata';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const paths = ['/', ...PUBLIC_PAGES.map(page => page.path), ...Object.keys(ACCOUNT_PAGES), '/404'];
export function render(path: string) {
  const meta = pageMetadata(path);
  const schema = structuredData(path);
  const content = path === '/' ? <LandingPage onOpenProject={() => {}} onSubmitInitialPrompt={() => {}} onLoginRequest={() => {}} currentUser={null} /> : path === '/gallery' ? <GalleryPage /> : ACCOUNT_PAGES[path] ? <AccountPage path={path} /> : <PublicPage page={findPublicPage(path)} />;
  const head = [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}" />`,
    `<meta name="robots" content="${meta.robots}" />`,
    ...(meta.canonical ? [`<link rel="canonical" href="${meta.canonical}" />`, `<meta property="og:url" content="${meta.canonical}" />`] : []),
    `<meta property="og:site_name" content="BrainHalf" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    ...(meta.type === 'article' && meta.dateModified ? [`<meta property="article:modified_time" content="${meta.dateModified}T00:00:00Z" />`] : []),
    `<meta property="og:title" content="${escape(meta.title)}" />`,
    `<meta property="og:description" content="${escape(meta.description)}" />`,
    `<meta property="og:image" content="${SOCIAL_IMAGE}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="BrainHalf AI app builder — describe, preview, and refine your next web app" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escape(meta.title)}" />`,
    `<meta name="twitter:description" content="${escape(meta.description)}" />`,
    `<meta name="twitter:image" content="${SOCIAL_IMAGE}" />`,
    `<meta name="twitter:image:alt" content="BrainHalf AI app builder — describe, preview, and refine your next web app" />`,
    ...(schema ? [`<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`] : []),
  ].join('\n    ');
  return { head, html: renderToString(content) };
}
export function sitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.filter(path => path !== '/404' && !ACCOUNT_PAGES[path]).map(path => `  <url><loc>${SITE_URL}${path}</loc><lastmod>${contentModified(path)}</lastmod></url>`).join('\n')}\n</urlset>\n`;
}

// An optional reader guide, generated from the same public content as the site.
// Crawl permissions remain in robots.txt; this file grants no special access.
export function llmsText() {
  return `# BrainHalf\n\n> ${HOME_DESCRIPTION}\n\nBrainHalf builds web apps from prompts with a frontend preview and editable source export. Free access has project, request, and model limits. Every signed-in user can publish supported static and Workers apps within existing project and usage limits. Publishing verifies a saved app version before activating its frontend, backend and production database. Existing Node backends require conversion to Workers. Exported source does not include hosted data or automatically reproduce BrainHalf services.\n\n## Product and guides\n\n- [BrainHalf](${SITE_URL}/): Product overview and frequently asked questions.\n${PUBLIC_PAGES.filter(page => !['/privacy', '/terms', '/contact'].includes(page.path)).map(page => `- [${page.title}](${SITE_URL}${page.path}): ${page.description}`).join('\n')}\n\n## Optional\n\n${PUBLIC_PAGES.filter(page => ['/privacy', '/terms', '/contact'].includes(page.path)).map(page => `- [${page.title}](${SITE_URL}${page.path}): ${page.description}`).join('\n')}\n`;
}
