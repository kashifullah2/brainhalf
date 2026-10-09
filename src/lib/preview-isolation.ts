import { isPublicPreviewFile } from './project-access.ts';
import { resolvePreviewImport } from './preview-modules.ts';
import { previewImportSpecifiers } from './preview-import-map.ts';
import { usesSimulatedApi } from './preview-mode.ts';

// allow-popups lets generated apps open /__brainhalf/auth in a new tab; without
// it window.open() is silently dropped and auth links go nowhere in the iframe.
export const PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups';

// Feature delegation: generated apps may use these browser APIs.
// camera is omitted intentionally — add it here and to the shell Permissions-Policy
// only when camera apps are actively supported.
export const PREVIEW_ALLOW = 'microphone; fullscreen; autoplay';

export function previewFiles(files: Record<string, string>, includeBackend = false): Record<string, string> {
  const visibleFiles = Object.fromEntries(Object.entries(files).filter(([path, content]) => {
    if (typeof content !== 'string') return false;
    if (path.split('/').some(segment => segment.startsWith('.'))) return false;
    if (/\.(pem|key|p12|pfx|sqlite|db)$/i.test(path)) return false;
    if (/(^|\/)(credentials|secrets)\.(json|yaml|yml|toml|ini)$/i.test(path)) return false;
    return isPublicPreviewFile(path) || (includeBackend && /^\/?server\/.+\.(js|ts|json)$/.test(path));
  }));
  const manifest = files['/package.json'] ?? files['package.json'];
  const queue = Object.keys(visibleFiles);
  for (let index = 0; index < queue.length; index += 1) {
    const path = queue[index];
    const source = visibleFiles[path];
    if (!/\.(?:html|css|[cm]?[jt]sx?)$/.test(path)) continue;
    const references = [
      ...previewImportSpecifiers(source),
      ...Array.from(source.matchAll(/(?:src|href)\s*=\s*['"]([^'"]+)['"]/g), match => match[1]),
      ...Array.from(source.matchAll(/url\(\s*['"]?([^)'"\s]+)/g), match => match[1]),
    ];
    for (const reference of references) {
      const resolved = resolvePreviewImport(files, path, reference);
      if (!resolved || resolved in visibleFiles || typeof files[resolved] !== 'string') continue;
      if (!/^\/?(?:[^/]+\/)*[^/]+\.(?:[cm]?[jt]sx?|css|svg)$/.test(resolved)) continue;
      if (/(?:^|[/_.-])(?:server|backend|env|secrets?|credentials?|config|key|cert)(?:[/_.-]|$)/i.test(resolved)) continue;
      if (resolved.split('/').some(segment => segment.startsWith('.'))) continue;
      visibleFiles[resolved] = files[resolved];
      queue.push(resolved);
    }
  }
  if (typeof manifest === 'string') {
    try {
      const dependencies = JSON.parse(manifest)?.dependencies;
      const safeDependencies = dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)
        ? Object.fromEntries(Object.entries(dependencies).filter(([, version]) => typeof version === 'string')) : {};
      visibleFiles['/package.json'] = JSON.stringify({ dependencies: safeDependencies, ...(usesSimulatedApi(files) ? { brainhalf: { previewApi: 'simulated' } } : {}) });
    } catch {}
  }
  return visibleFiles;
}

export function previewSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src 'none'; script-src blob: 'unsafe-inline' 'unsafe-eval' 'self' https://esm.sh https://*.esm.sh https://cdn.tailwindcss.com https://static.cloudflareinsights.com; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: https:; font-src data: https://fonts.gstatic.com; connect-src https: http://localhost:5173 http://127.0.0.1:5173; frame-src 'none'; worker-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'self' http://localhost:5173 http://127.0.0.1:5173",
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    // microphone is intentionally absent: the shell page delegates it to
    // preview iframes via allow="microphone". Including microphone=() here
    // would block getUserMedia even when the parent has delegated the feature,
    // because the effective policy is the intersection of delegation and this
    // document's own policy. camera=() stays because camera is not supported.
    'Permissions-Policy': 'camera=(), geolocation=(), clipboard-read=(), clipboard-write=()',
    'Access-Control-Allow-Origin': 'null',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    // An explicit empty ruleset prevents Speed Brain from injecting its
    // same-origin prefetch URL into an opaque-origin sandbox document.
    'Speculation-Rules': '"/preview-rules.json"',
  };
}

export function isolatedPreviewHtml(projectId: string, files: Record<string, string> = {}): string {
  const bootstrap = JSON.stringify({ projectId, files }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="preconnect" href="https://esm.sh" crossorigin><title>Application Preview</title><style>html,body,#root{margin:0;min-height:100%;font-family:system-ui}body{background:#090a0f;color:#fff}.bh-load-err{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:12px;color:#9ca3af;font-size:14px;text-align:center;padding:24px}.bh-load-err button{background:#3659D9;color:#fff;border:none;border-radius:6px;padding:8px 18px;font-size:13px;cursor:pointer;margin-top:4px}</style><script>(function(){const w=console.warn.bind(console);console.warn=function(...a){if(typeof a[0]==='string'&&a[0].includes('cdn.tailwindcss.com should not be used in production'))return;w(...a);};const block=(u)=>typeof u==='string'&&u.includes('/cdn-cgi/rum');const of=window.fetch?.bind(window);if(of){window.fetch=(i,n)=>{const u=typeof i==='string'?i:(i&&typeof i==='object'&&'url'in i?String(i.url):'');if(block(u))return Promise.resolve(new Response('',{status:204}));return of(i,n);};}const osb=navigator.sendBeacon?.bind(navigator);if(osb){navigator.sendBeacon=(u,d)=>block(String(u))?true:osb(u,d);}const XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){this.__bhRumBlocked=block(String(u));return XO.call(this,m,u,...r);};const XS=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(b){if(this.__bhRumBlocked){try{this.abort();}catch{}return;}return XS.call(this,b);};})();</script><script src="https://cdn.tailwindcss.com" defer></script></head><body><div id="root"></div><script type="application/json" id="preview-data">${bootstrap}</script><script src="/preview-runtime.js" crossorigin="anonymous" onerror="document.body.innerHTML='<div class=bh-load-err><div>Preview runtime failed to load.</div><div style=font-size:12px>Check your connection or try refreshing.</div><button onclick=location.reload()>Refresh Preview</button></div>'"></script></body></html>`;
}
