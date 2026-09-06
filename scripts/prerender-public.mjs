/**
 * Post-build prerender for public marketing routes.
 *
 * BrainHalf is a Vite SPA. Cloudflare Pages serves index.html for every route,
 * which works for humans but leaves crawlers and social previews looking at the
 * homepage meta for every URL. This script writes a static HTML file for each
 * public route with a route-specific <title>, description and canonical tag.
 *
 * The content is otherwise identical to the built index.html, so the bundle
 * still hydrates the same SPA on the client.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const INDEX = path.join(DIST, 'index.html');

/**
 * @typedef {Object} PublicRoute
 * @property {string} path
 * @property {string} title
 * @property {string} description
 */

/** @type {PublicRoute[]} */
const ROUTES = [
  {
    path: '/',
    title:
      'BrainHalf — AI Document Extraction for Invoices, Receipts & Documents',
    description:
      'BrainHalf automatically extracts fields, line items, and totals from invoices, receipts, forms, and transcripts using AI document extraction. Export to CSV, Excel & JSON instantly.',
  },
  {
    path: '/contact',
    title: 'Contact BrainHalf · AI Document Extraction Platform',
    description:
      'Get in touch with BrainHalf for sales, support, or partnership questions about AI document extraction and automated data capture.',
  },
  {
    path: '/privacy',
    title: 'Privacy Policy · BrainHalf',
    description:
      'Read the BrainHalf privacy policy to learn how we collect, use, store, and delete your data when you use our AI document extraction platform.',
  },
  {
    path: '/terms',
    title: 'Terms of Service · BrainHalf',
    description:
      'Read the BrainHalf terms of service, including acceptable use, account responsibilities, and data processing terms.',
  },
  {
    path: '/sign-in',
    title: 'Sign in · BrainHalf',
    description:
      'Sign in to BrainHalf to extract structured data from invoices, receipts, and documents with AI.',
  },
  {
    path: '/sign-up',
    title: 'Create account · BrainHalf',
    description:
      'Create a BrainHalf account and start extracting structured data from documents with AI.',
  },
];

/**
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * @param {string} baseHtml
 * @param {PublicRoute} route
 * @returns {string}
 */
function routeHtml(baseHtml, route) {
  const canonical = `https://brainhalf.com${
    route.path === '/' ? '/' : route.path
  }`;

  let html = baseHtml.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeHtml(route.title)}</title>`
  );

  html = html.replace(
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${escapeHtml(route.description)}"`
  );

  const canonicalTag = `<link rel="canonical" href="${canonical}" />`;
  if (html.includes('<link rel="canonical"')) {
    html = html.replace(/<link rel="canonical"[^>]*>/, canonicalTag);
  } else {
    html = html.replace('</head>', `    ${canonicalTag}\n  </head>`);
  }

  html = html.replace(
    /<meta property="og:title" content="[^"]*"/,
    `<meta property="og:title" content="${escapeHtml(route.title)}"`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*"/,
    `<meta property="og:description" content="${escapeHtml(route.description)}"`
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*"/,
    `<meta property="og:url" content="${canonical}"`
  );
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*"/,
    `<meta name="twitter:title" content="${escapeHtml(route.title)}"`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*"/,
    `<meta name="twitter:description" content="${escapeHtml(route.description)}"`
  );

  return html;
}

function main() {
  if (!fs.existsSync(INDEX)) {
    throw new Error(`Build output not found: ${INDEX}`);
  }

  const baseHtml = fs.readFileSync(INDEX, 'utf8');

  for (const route of ROUTES) {
    const html = routeHtml(baseHtml, route);
    const outputDir =
      route.path === '/' ? DIST : path.join(DIST, route.path.slice(1));
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'index.html'), html, 'utf8');
    console.log(
      `Prerendered ${route.path} → ${path.relative(
        DIST,
        path.join(outputDir, 'index.html')
      )}`
    );
  }
}

main();
