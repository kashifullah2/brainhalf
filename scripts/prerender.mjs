import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { build, createServer } from 'vite';
import react from '@vitejs/plugin-react';

// Render the same public React components seen by visitors. No bot-specific output.
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
try {
  const { paths, render, sitemap, llmsText } = await server.ssrLoadModule('/src/seo/render.tsx');
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
    const { head, html } = render(path);
    const destination = resolve('dist', path === '/' ? 'index.html' : `${path.slice(1)}.html`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, template.replace(/<!--seo-head-start-->[\s\S]*?<!--seo-head-end-->/, head).replace('<div id="root"></div>', `<div id="root" data-prerendered="true">${html}</div>`));
  }
  await writeFile(resolve('dist/sitemap.xml'), sitemap());
  await writeFile(resolve('dist/llms.txt'), llmsText());
  console.log(`Prerendered ${paths.length} pages and generated sitemap.xml and llms.txt.`);
} finally {
  await server.close();
}
