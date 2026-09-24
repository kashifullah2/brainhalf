import { normalizePath } from './utils.ts';

const STARTER_MARKERS = [
  'Architect your idea into living software',
  'What do you want to build?',
  'BRAINHALF CORE // REACTIVE ENGINE',
  'BrainHalf Studio',
  'From interactive workflows to full-stack reactive prototypes',
];

export function isStarterApp(source: string): boolean {
  return STARTER_MARKERS.some(marker => source.includes(marker));
}

export function selectAppEntry(files: Record<string, string>): string | null {
  const candidates = Object.keys(files).filter(path => /(^|\/)App\.(jsx|tsx|js|ts)$/.test(path));
  const generated = candidates.filter(path => !isStarterApp(files[path]));
  const eligible = generated.length ? generated : candidates;
  const mains = Object.keys(files).filter(path => /(^|\/)main\.(jsx|tsx|js|ts)$/.test(path)).sort();
  for (const main of mains) {
    const match = files[main].match(/from\s*['"]\.\/App(?:\.(jsx|tsx|js|ts))?['"]/);
    if (!match) continue;
    const directory = normalizePath(main).replace(/\/[^/]+$/, '');
    const extensions = match[1] ? [match[1]] : ['tsx', 'jsx', 'ts', 'js'];
    for (const extension of extensions) {
      const configured = eligible.find(path => normalizePath(path) === `${directory}/App.${extension}`);
      if (configured) return configured;
    }
  }
  const rank = (path: string) => normalizePath(path).startsWith('/src/App.') ? 0 : /^\/App\./.test(normalizePath(path)) ? 1 : 2;
  return eligible.sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))[0] || null;
}

export function selectHtmlEntry(files: Record<string, string>): string | null {
  const app = selectAppEntry(files);
  if (app && !isStarterApp(files[app])) return null;
  const candidates = Object.keys(files).filter(path => /(^|\/)index\.html$/.test(path));
  const rank = (path: string) => normalizePath(path) === '/index.html' ? 0 : normalizePath(path) === '/public/index.html' ? 1 : 2;
  return candidates.sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))[0] || null;
}

export function relativeProjectImport(fromPath: string, targetPath: string): string {
  const from = normalizePath(fromPath).split('/').filter(Boolean).slice(0, -1);
  const target = normalizePath(targetPath).split('/').filter(Boolean);
  while (from.length && target.length && from[0] === target[0]) {
    from.shift();
    target.shift();
  }
  const relative = [...from.map(() => '..'), ...target].join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}
