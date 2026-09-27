/**
 * The esm.sh import map the preview index.html ships.
 *
 * Extracted from ChatAgent because it is a pure function of the project's files
 * and never touches agent state. It is also a security boundary: every key and
 * value is derived from generated, prompt-controlled code, so the escaping at
 * the end is what keeps a crafted package name from breaking out of the inline
 * <script> tag it is embedded in.
 */
import { isValidBareModuleSpecifier } from './utils.ts';

export function previewImportSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g), match => match[1]);
}

export function isHarnessEntry(cleanPath: string): boolean {
  return (
    cleanPath === '/src/main.jsx' ||
    cleanPath === 'src/main.jsx' ||
    cleanPath === '/src/main.tsx' ||
    cleanPath === 'src/main.tsx'
  );
}

export function buildDynamicImportMap(files: Array<{ path: string, content: string }>): string {
  const KNOWN_PACKAGES: Record<string, string> = {
    'react': 'https://esm.sh/react@18.2.0',
    'react-dom': 'https://esm.sh/react-dom@18.2.0?external=react',
    'react-dom/client': 'https://esm.sh/react-dom@18.2.0/client?external=react',
    'lucide-react': 'https://esm.sh/lucide-react@0.344.0?external=react',
    'framer-motion': 'https://esm.sh/framer-motion@10.16.4?external=react,react-dom',
    'clsx': 'https://esm.sh/clsx@2.1.0',
    'tailwind-merge': 'https://esm.sh/tailwind-merge@2.2.1',
    'zustand': 'https://esm.sh/zustand@4.5.2?external=react',
    'axios': 'https://esm.sh/axios@1.6.7',
    'date-fns': 'https://esm.sh/date-fns@3.3.1',
    '@tanstack/react-query': 'https://esm.sh/@tanstack/react-query@5.24.1?external=react',
    'react-router-dom': 'https://esm.sh/react-router-dom@7.18.4?external=react,react-dom',
    'react-router': 'https://esm.sh/react-router@7.18.4?external=react,react-dom',
    'recharts': 'https://esm.sh/recharts@2.12.2?external=react,react-dom',
    'react-hook-form': 'https://esm.sh/react-hook-form@7.50.1?external=react',
    'zod': 'https://esm.sh/zod@3.22.4',
    'swr': 'https://esm.sh/swr@2.2.5?external=react',
    '@headlessui/react': 'https://esm.sh/@headlessui/react@1.7.18?external=react,react-dom',
    'react-icons': 'https://esm.sh/react-icons@5.0.1?external=react',
    'react-hot-toast': 'https://esm.sh/react-hot-toast@2.4.1?external=react',
    'sonner': 'https://esm.sh/sonner@1.4.0?external=react,react-dom',
    'chart.js': 'https://esm.sh/chart.js@4.4.1',
    'react-chartjs-2': 'https://esm.sh/react-chartjs-2@5.2.0?external=react,chart.js',
    'three': 'https://esm.sh/three@0.161.0',
    '@react-three/fiber': 'https://esm.sh/@react-three/fiber@8.15.16?external=react,three',
    'lodash-es': 'https://esm.sh/lodash-es@4.17.21',
    'uuid': 'https://esm.sh/uuid@9.0.1',
    'nanoid': 'https://esm.sh/nanoid@5.0.5',
    'classnames': 'https://esm.sh/classnames@2.5.1',
    'motion': 'https://esm.sh/motion@10.16.4?external=react'
  };

  const importMap: Record<string, string> = {
    'react': KNOWN_PACKAGES['react'],
    'react/': KNOWN_PACKAGES['react'] + '/',
    'react-dom': KNOWN_PACKAGES['react-dom'],
    'react-dom/': 'https://esm.sh/react-dom@18.2.0/',
    'react-dom/client': KNOWN_PACKAGES['react-dom/client'],
    'react-router-dom': KNOWN_PACKAGES['react-router-dom'],
    'react-router': KNOWN_PACKAGES['react-router'],
    'lucide-react': KNOWN_PACKAGES['lucide-react'],
    'lucide-react/': 'https://esm.sh/lucide-react@0.344.0/',
    'react-icons': KNOWN_PACKAGES['react-icons'],
    'react-icons/': 'https://esm.sh/react-icons@5.0.1/',
    'framer-motion': KNOWN_PACKAGES['framer-motion'],
    'clsx': KNOWN_PACKAGES['clsx'],
    'tailwind-merge': KNOWN_PACKAGES['tailwind-merge'],
  };

  // Parse package.json if it exists.
  let packageDeps: Record<string, string> = {};
  const packageJsonFile = files.find(file => file.path.replace(/^\//, '') === 'package.json');
  if (packageJsonFile) {
    try {
      const pkg = JSON.parse(packageJsonFile.content);
      if (pkg.dependencies && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) {
        packageDeps = pkg.dependencies;
      }
    } catch (e) {
      console.error('Failed to parse package.json', e);
    }
  }

  for (const file of files) {
    if (!/\.(?:[cm]?[jt]sx?|html)$/.test(file.path)) continue;
    // FIX: `importRegex` was declared once outside the loop with the /g flag
    // and reused across files. `lastIndex` carried over between iterations, so
    // imports near the start of a later file were skipped. It is now built per
    // file, which is also what makes the scan deterministic.
    for (const pkg of previewImportSpecifiers(file.content)) {

      // The spec is model-authored and ends up both in an esm.sh URL and in an
      // inline <script> block. Reject anything that is not a bare npm
      // identifier rather than relying on escaping alone.
      if (!isValidBareModuleSpecifier(pkg)) continue;

      const parts = pkg.split('/');
      const packageName = parts.slice(0, pkg.startsWith('@') ? 2 : 1).join('/');
      const subpath = pkg.slice(packageName.length);
      let version = '';
      if (packageDeps[packageName]) {
        version = '@' + String(packageDeps[packageName]).replace(/^[\^~]/, '');
      }
      // A version string comes from a generated package.json — constrain it to
      // digits/dots/pre-release tags so it cannot carry a payload either.
      if (version && !/^@[0-9A-Za-z.+-]+$/.test(version)) version = '';

      if (KNOWN_PACKAGES[pkg] && !version) {
        importMap[pkg] = KNOWN_PACKAGES[pkg];
      } else if (!pkg.startsWith('.')) {
        if (!version && KNOWN_PACKAGES[packageName]) {
          version = new URL(KNOWN_PACKAGES[packageName]).pathname.slice(packageName.length + 1);
        }
        const suffix = packageName === 'react' ? '' : '?external=react,react-dom';
        importMap[pkg] = `https://esm.sh/${packageName}${version}${subpath}${suffix}`;
      }
    }
  }

  // Keys and values derive from generated code, which is prompt-controlled.
  // JSON.stringify escapes quotes and backslashes but NOT `</script>` — a
  // package name containing it would terminate this script tag early.
  const raw = JSON.stringify({ imports: importMap }, null, 2);
  return raw
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  }
