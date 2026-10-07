import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';

const ROOT = process.cwd();
const SRC_DIRS = ['src', 'scripts', 'tests', 'runtime-tests'];
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', ''];

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) yield p;
  }
}
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return { ok: true, external: spec };
  const base = spec.startsWith('/') ? join(ROOT, 'public' /* vite public */, spec) : resolve(dirname(fromFile), spec);
  const candidates = [];
  if (spec.startsWith('/')) candidates.push(join(ROOT, spec), join(ROOT, 'public', spec));
  candidates.push(base);
  for (const ext of EXTS) candidates.push(base + ext);
  for (const ext of EXTS) candidates.push(join(base, 'index' + ext));
  for (const c of candidates) if (c && existsSync(c) && statSync(c).isFile()) return { ok: true, resolved: c };
  return { ok: false, spec };
}
const importRe = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
let bad = 0, total = 0;
for (const dir of SRC_DIRS) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const text = readFileSync(file, 'utf8');
    let m;
    while ((m = importRe.exec(text))) {
      const spec = m[1] || m[2] || m[3] || m[4];
      if (!spec || spec.startsWith('cloudflare:') || spec.startsWith('node:')) continue;
      // skip template-string code samples (generated app source embedded as strings)
      const line = text.slice(0, m.index).split('\n').length;
      const r = resolveImport(file, spec);
      total++;
      if (!r.ok) { bad++; console.log(`BROKEN ${file}:${line} -> ${spec}`); }
    }
  }
}
console.log(`\nchecked ${total} relative imports, ${bad} broken`);
