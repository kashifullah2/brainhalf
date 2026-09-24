import { PILOT_LIMITS, RuntimeError } from './types';

export interface BuildArtifact { worker: string; assets: Record<string, { content: string; type: string }> }

// Runs after build inside the untrusted container. The Worker validates the result again.
export const COLLECT_ARTIFACT = `
const fs = require('node:fs'), path = require('node:path');
let size = 0; const assets = {};
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'};
function read(file) { const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Invalid artifact'); size += stat.size; if (size > ${PILOT_LIMITS.artifactBytes}) throw Error('Artifact too large'); return fs.readFileSync(file); }
function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes:true})) { const file = path.join(dir, entry.name); if(entry.isSymbolicLink()) throw Error('Symlink in artifact'); if(entry.isDirectory()) walk(file); else { const key = '/' + path.relative('dist', file).split(path.sep).join('/'); if(key.endsWith('.map')) continue; if(Object.keys(assets).length >= 500) throw Error('Too many assets'); assets[key] = {content:read(file).toString('base64'),type:types[path.extname(file)] || 'application/octet-stream'}; } } }
walk('dist'); const worker = read('dist-worker/index.js').toString('utf8'); fs.writeFileSync('/workspace/artifact.json', JSON.stringify({worker,assets}));
`;

// Static apps still produce an immutable artifact. Never fake missing API responses.
export const COLLECT_STATIC_ARTIFACT = COLLECT_ARTIFACT.replace(
  "read('dist-worker/index.js').toString('utf8')",
  JSON.stringify('export default { fetch() { return Response.json({ error: "API route not found" }, { status: 404 }); } };'),
);

export function validateArtifact(value: unknown): BuildArtifact {
  if (!value || typeof value !== 'object') throw new RuntimeError('Build artifact is missing.');
  const artifact = value as BuildArtifact;
  if (typeof artifact.worker !== 'string' || !artifact.worker || !artifact.assets || typeof artifact.assets !== 'object' || Array.isArray(artifact.assets)) throw new RuntimeError('Build must produce dist/ and dist-worker/index.js.');
  let bytes = new TextEncoder().encode(artifact.worker).length;
  const entries = Object.entries(artifact.assets);
  if (entries.length > 500) throw new RuntimeError('Too many build assets.');
  for (const [path, asset] of entries) {
    // eslint-disable-next-line no-control-regex -- control bytes are invalid URL/file characters.
    if (!path.startsWith('/') || /[\\?#\0-\x1f]/.test(path) || path.split('/').some(part => part === '..' || part === '.') || !asset || typeof asset.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.content) || typeof asset.type !== 'string' || /[\r\n]/.test(asset.type)) throw new RuntimeError('Invalid build asset.');
    bytes += asset.content.length * 0.75;
  }
  if (bytes > PILOT_LIMITS.artifactBytes || !artifact.assets['/index.html']) throw new RuntimeError('Build assets are missing or too large.');
  return artifact;
}
