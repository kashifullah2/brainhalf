import { webContainerManager } from './webcontainer';

const IMPORT_PATTERNS = [
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+|)\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Resolve an import specifier to an npm package name (e.g. "phaser", "@scope/pkg"). */
export function npmPackageFromImport(spec: string): string | null {
  const trimmed = spec.trim();
  if (
    !trimmed ||
    trimmed.startsWith('.') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('node:') ||
    trimmed.startsWith('@/') ||
    trimmed.startsWith('~/')
  ) {
    return null;
  }

  if (trimmed.startsWith('@')) {
    const slash = trimmed.indexOf('/');
    if (slash === -1) return null;
    return `${trimmed.slice(0, slash)}/${trimmed.slice(slash + 1).split('/')[0]}`;
  }

  return trimmed.split('/')[0] || null;
}

/** Collect npm package names referenced by import/export/require statements. */
export function extractNpmPackageNames(source: string): string[] {
  const names = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const pkg = npmPackageFromImport(match[1] ?? '');
      if (pkg) names.add(pkg);
    }
  }

  return [...names];
}

/** Installs any npm packages imported by a source file but not yet present. */
export async function ensureNpmImportsFromSource(source: string): Promise<string[]> {
  const packages = extractNpmPackageNames(source);
  const installed: string[] = [];

  for (const pkg of packages) {
    const result = await webContainerManager.installPackage(pkg);
    if (result.code === 0 && !result.skipped) {
      installed.push(pkg);
    }
  }

  return installed;
}
