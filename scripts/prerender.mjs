import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { build, createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Render the same public React components seen by visitors. No bot-specific output.
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
try {
  const { paths, render, sitemap, llmsText } = await server.ssrLoadModule('/src/seo/render.tsx');
  // Snapshot the published gallery so the prerendered /gallery page carries
  // real app cards (Google otherwise sees only "Loading apps…"). Best-effort:
  // an unreachable API must never fail the build; the page falls back to the
  // loading state and hydrates live data as before.
  const galleryApps = await fetch('https://brainhalf.com/api/gallery', { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
    .then(async response => {
      if (!response.ok) throw new Error(`gallery snapshot HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.apps)) throw new Error('gallery snapshot missing apps list');
      return data.apps.map(app => ({ id: String(app.id), name: String(app.name ?? ''), description: String(app.description ?? ''), remixCount: Number(app.remixCount) || 0 }));
    })
    .catch(cause => { console.warn(`Prerender: gallery snapshot unavailable (${cause instanceof Error ? cause.message : cause}); using live fetch fallback.`); return null; });
  if (galleryApps) console.log(`Prerender: embedded ${galleryApps.length} gallery app(s) into /gallery.`);
  let template = await readFile(resolve('dist/index.html'), 'utf8');
  if (!template.includes('<!--seo-head-start-->') || !template.includes('<div id="root"></div>')) throw new Error('Missing prerender placeholders in built HTML.');
  // Keep this a synchronous classic script so the saved theme applies before
  // styles paint. A content hash lets it share the immutable /assets/* policy.
  const themeTag = '<script src="/theme-init.js"></script>';
  if (!template.includes(themeTag)) throw new Error('Missing theme startup script in built HTML.');
  const themeBuild = await build({ configFile: false, logLevel: 'error', build: {
    write: false, minify: true,
    lib: { entry: resolve('public/theme-init.js'), name: 'BrainHalfTheme', formats: ['iife'] },
  } });
  const themeChunks = (Array.isArray(themeBuild) ? themeBuild : [themeBuild]).flatMap(result => result.output).filter(item => item.type === 'chunk');
  if (themeChunks.length !== 1 || themeChunks[0].imports.length || themeChunks[0].dynamicImports.length) throw new Error('Theme startup must remain a standalone script.');
  const themeCode = themeChunks[0].code;
  const themeHash = createHash('sha256').update(themeCode).digest('hex').slice(0, 12);
  const themePath = `/assets/theme-init-${themeHash}.js`;
  await mkdir(resolve('dist/assets'), { recursive: true });
  await writeFile(resolve('dist', themePath.slice(1)), themeCode);
  template = template.replace(themeTag, `<script src="${themePath}"></script>`);
  for (const path of paths) {
    const { head, html } = render(path, { galleryApps });
    const destination = resolve('dist', path === '/' ? 'index.html' : `${path.slice(1)}.html`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, template.replace(/<!--seo-head-start-->[\s\S]*?<!--seo-head-end-->/, head).replace('<div id="root"></div>', `<div id="root" data-prerendered="true" data-prerender-path="${path}">${html}</div>`));
  }
  // The authenticated shell (/dashboard, /admin) must NOT serve prerendered
  // public markup — hydrating a different view against it throws React #418
  // and leaks landing-page SEO head (title, canonical) onto operator routes.
  // Give the worker an empty-root shell with a noindex head for those routes.
  const shellHead = '<title>BrainHalf</title><meta name="robots" content="noindex, nofollow" />';
  await writeFile(resolve('dist/shell.html'), template.replace(/<!--seo-head-start-->[\s\S]*?<!--seo-head-end-->/, shellHead));
  await writeFile(resolve('dist/sitemap.xml'), sitemap());
  await writeFile(resolve('dist/llms.txt'), llmsText());
  console.log(`Prerendered ${paths.length} pages and generated sitemap.xml and llms.txt.`);
} finally {
  await server.close();
}
