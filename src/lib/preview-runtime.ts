import { transform } from 'sucrase';
import { resolvePreviewImport } from './preview-modules';

export function previewAssetUrl(files: Record<string, string>, from: string, specifier: string): string {
  const resolved = resolvePreviewImport(files, from, specifier);
  if (!resolved) return specifier;
  const types: Record<string, string> = { svg: 'image/svg+xml', css: 'text/css', json: 'application/json', txt: 'text/plain', html: 'text/html' };
  const extension = resolved.split('.').pop() || '';
  if (!types[extension]) return specifier;
  return `data:${types[extension]};charset=utf-8,${encodeURIComponent(files[resolved])}${specifier.includes('#') ? `#${specifier.split('#')[1]}` : ''}`;
}

export function previewCss(files: Record<string, string>, path: string, source: string): string {
  return source.replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g, (_match, _quote, specifier: string) => `url(${JSON.stringify(previewAssetUrl(files, path, specifier))})`);
}

export function createPreviewModuleLoader(
  files: Record<string, string>,
  libraries: Record<string, unknown>,
  react: unknown,
  transpileCache = new Map<string, { source: string; code: string }>(),
) {
  const modules = new Map<string, { exports: any }>();
  const execute = (path: string, source = files[path]): any => {
    if (modules.has(path)) return modules.get(path)!.exports;
    const module = { exports: {} as any };
    modules.set(path, module);
    try {
      let cached = transpileCache.get(path);
      if (cached?.source !== source) {
        cached = { source, code: transform(source, { transforms: ['jsx', 'imports', 'typescript'], jsxRuntime: 'classic' }).code };
        transpileCache.set(path, cached);
      }
      const run = new Function('require', 'exports', 'module', 'React', cached.code);
      run((specifier: string) => requireModule(path, specifier), module.exports, module, react);
      return module.exports;
    } catch (error) {
      modules.delete(path);
      throw error;
    }
  };
  const requireModule = (from: string, specifier: string): any => {
    if (Object.prototype.hasOwnProperty.call(libraries, specifier)) return libraries[specifier];
    const path = resolvePreviewImport(files, from, specifier);
    if (!path) throw new Error(`Cannot resolve module "${specifier}" imported from "${from}"`);
    if (new URL(specifier, 'https://preview.invalid').searchParams.has('raw')) return files[path];
    if (path.endsWith('.css')) return {};
    if (path.endsWith('.json')) {
      if (!modules.has(path)) modules.set(path, { exports: JSON.parse(files[path]) });
      return modules.get(path)!.exports;
    }
    if (path.endsWith('.svg') || new URL(specifier, 'https://preview.invalid').searchParams.has('url')) return previewAssetUrl(files, from, specifier);
    return execute(path);
  };
  return { execute, require: requireModule };
}
