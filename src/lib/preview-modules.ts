import { buildDynamicImportMap, previewImportSpecifiers } from './preview-import-map.ts';
import { selectAppEntry, selectHtmlEntry } from './preview-entry.ts';

export function resolvePreviewImport(files: Record<string, string>, from: string, specifier: string): string | null {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(specifier)) return null;
  const path = specifier.split(/[?#]/, 1)[0];
  const normalized = path.startsWith('@/') ? `/src/${path.slice(2)}` : path;
  const base = new URL(normalized, `https://preview.invalid/${from.replace(/^\//, '')}`).pathname;
  const roots = normalized.startsWith('.') || normalized.startsWith('/') ? [base, `/public${base}`] : [`/${normalized}`, `/src/${normalized}`, `/public/${normalized}`];
  for (const root of roots) {
    for (const suffix of ['', '.jsx', '.tsx', '.js', '.ts', '.mjs', '.cjs', '.json', '/index.jsx', '/index.tsx', '/index.js', '/index.ts', '/index.mjs']) {
      for (const candidate of [root + suffix, (root + suffix).slice(1)]) {
        if (Object.prototype.hasOwnProperty.call(files, candidate)) return candidate;
      }
    }
  }
  return null;
}

export function previewDependencyMap(files: Record<string, string>): Record<string, string> {
  const entry = selectHtmlEntry(files) || selectAppEntry(files);
  const pending = entry ? [entry] : Object.keys(files).filter(path => !/^\/?server\//.test(path));
  const visited = new Set<string>();
  const sources: Array<{ path: string; content: string }> = [];
  for (let index = 0; index < pending.length; index += 1) {
    const path = pending[index];
    if (visited.has(path)) continue;
    visited.add(path);
    const content = files[path];
    sources.push({ path, content });
    const references = previewImportSpecifiers(content);
    if (path.endsWith('.html')) references.push(...Array.from(content.matchAll(/<script\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]/gi), match => match[1]));
    for (const reference of references) {
      const resolved = resolvePreviewImport(files, path, reference);
      if (resolved) pending.push(resolved);
    }
  }
  const manifestPath = ['/package.json', 'package.json'].find(path => typeof files[path] === 'string');
  if (manifestPath && !visited.has(manifestPath)) sources.push({ path: manifestPath, content: files[manifestPath] });
  const imports = JSON.parse(buildDynamicImportMap(sources)).imports as Record<string, string>;
  const needed: Record<string, string> = {};
  for (const { path, content } of sources) {
    if (!/\.(?:[cm]?[jt]sx?|html)$/.test(path)) continue;
    for (const name of previewImportSpecifiers(content)) {
      if (imports[name] && !resolvePreviewImport(files, path, name)) needed[name] = imports[name];
    }
  }
  return needed;
}

let builtinImportMap: Record<string, string> | null = null;
const loadedDependencies = new Map<string, Promise<unknown>>();

export async function loadPreviewDependencies(files: Record<string, string>, builtins: Record<string, unknown>): Promise<Record<string, unknown>> {
  const dependencies = Object.entries(previewDependencyMap(files)).filter(([name]) => !(name in builtins));
  if (dependencies.length === 0) return builtins;
  if (!builtinImportMap) {
    Object.assign(globalThis, { __brainhalfPreviewLibraries: builtins });
    builtinImportMap = {};
    for (const [name, library] of Object.entries(builtins)) {
      const names = Object.keys(library as object).filter(key => key !== 'default' && /^[a-zA-Z_$][\w$]*$/.test(key));
      const source = `const library = globalThis.__brainhalfPreviewLibraries[${JSON.stringify(name)}]; export default library; ${names.map(key => `export const ${key} = library[${JSON.stringify(key)}];`).join('\n')}`;
      builtinImportMap[name] = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    }
    const map = document.createElement('script');
    map.type = 'importmap';
    map.textContent = JSON.stringify({ imports: builtinImportMap });
    document.head.append(map);
  }
  const modules = await Promise.all(dependencies.map(async ([name, url]) => {
    let loading = loadedDependencies.get(url);
    if (!loading) {
      loading = import(/* @vite-ignore */ url);
      loadedDependencies.set(url, loading);
      void loading.catch(() => loadedDependencies.delete(url));
    }
    return [name, { ...await loading as Record<string, unknown>, __esModule: true }] as const;
  }));
  return { ...builtins, ...Object.fromEntries(modules) };
}
