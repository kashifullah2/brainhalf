import { isBlockedSecretFile } from '../lib/secret-files';
import { lucideCompatibleSource } from '../lib/lucide-compat';
import { PILOT_LIMITS, RuntimeError, type SourceFiles, type SourceSnapshot } from './types';

export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function sourceSnapshot(input: SourceFiles): Promise<SourceSnapshot> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RuntimeError('A source snapshot is required.');
  const files: SourceFiles = {};
  let bytes = 0;
  const entries = Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length > PILOT_LIMITS.sourceFiles) throw new RuntimeError('Project has too many files for this pilot.');
  for (const [raw, content] of entries) {
    const path = raw.replace(/^\//, '');
    if (!path || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..') || /[\\\0\r\n]/.test(path) || path.length > 300) throw new RuntimeError('Project contains an unsafe file path.');
    if (typeof content !== 'string') throw new RuntimeError('Project source must contain text files.');
    if (isBlockedSecretFile(path) && !path.endsWith('.env.example')) continue;
    if (/^(?:node_modules|\.git|\.brainhalf|dist)\//.test(path)) continue;
    // A model-authored lockfile cannot be trusted to match package.json, and
    // `npm ci` hard-fails on any mismatch — the most common reason dependency
    // installation failed for otherwise valid projects. Resolution always runs
    // fresh with `npm install`, matching agent-context and workers-starter.
    if (/^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path)) continue;
    if (Object.prototype.hasOwnProperty.call(files, path)) throw new RuntimeError('Project contains duplicate normalized file paths.');
    bytes += new TextEncoder().encode(content).length;
    if (bytes > PILOT_LIMITS.sourceBytes) throw new RuntimeError('Project exceeds the pilot source size limit.');
    Object.defineProperty(files, path, { value: content, enumerable: true, configurable: true, writable: true });
  }
  if (!files['package.json']) throw new RuntimeError('Publishing and app checks need a package.json in the project. Frontend-only apps can skip this.');
  const compatible = lucideCompatibleSource(files);
  if (Object.keys(compatible).length > PILOT_LIMITS.sourceFiles || Object.values(compatible).reduce((size, content) => size + new TextEncoder().encode(content).length, 0) > PILOT_LIMITS.sourceBytes) throw new RuntimeError('Project exceeds the source limit after applying icon compatibility.');
  const canonicalFiles = Object.fromEntries(Object.entries(compatible).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return { files: canonicalFiles, revision: await digest(JSON.stringify(canonicalFiles)) };
}
export function projectManifest(files: SourceFiles): { scripts: Record<string, string>; brainhalf?: { runtime?: string } } {
  try {
    const value = JSON.parse(files['package.json'] || '{}');
    if (!value || typeof value !== 'object') throw new Error();
    return { ...value, scripts: value.scripts || {} };
  } catch { throw new RuntimeError('Fix package.json before starting the runtime.'); }
}
export function migrationFiles(files: SourceFiles): Array<{ name: string; sql: string }> {
  return Object.entries(files).filter(([name]) => /^migrations\/\d+_[\w-]+\.sql$/.test(name)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, sql]) => ({ name, sql }));
}
export function assertSafeMigration(sql: string): void {
  // The pilot supports additive migrations. Destructive schema changes require a separate reviewed migration workflow.
  // Strip line comments, block comments, and single-quoted string literals before
  // scanning for banned keywords so a column default like DEFAULT 'DO NOT DELETE'
  // or a CHECK constraint mentioning 'VACUUM' is never falsely rejected.
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  if (/\b(?:DROP|TRUNCATE|DELETE|REPLACE|UPDATE|ATTACH|DETACH|VACUUM|PRAGMA)\b/i.test(stripped) || /\bALTER\s+TABLE\b[\s\S]*\b(?:DROP|RENAME)\b/i.test(stripped)) throw new RuntimeError('This migration changes existing data or schema. Export a backup and use a reviewed migration workflow.');
}
