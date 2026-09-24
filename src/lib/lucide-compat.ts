// Legacy brand glyphs from lucide-react 0.468.0. Kept as project source so
// modern Lucide builds retain the app's existing social links and appearance.
export const LUCIDE_BRAND_SOURCE = "/* ISC License\n\nCopyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n*/\nimport { createLucideIcon } from 'lucide-react';\nexport const Github = createLucideIcon(\"Github\", [\n  [\n    \"path\",\n    {\n      d: \"M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4\",\n      key: \"tonef\"\n    }\n  ],\n  [\"path\", { d: \"M9 18c-4.51 2-5-2-7-2\", key: \"9comsn\" }]\n]);\nexport const Linkedin = createLucideIcon(\"Linkedin\", [\n  [\n    \"path\",\n    {\n      d: \"M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z\",\n      key: \"c2jq9f\"\n    }\n  ],\n  [\"rect\", { width: \"4\", height: \"12\", x: \"2\", y: \"9\", key: \"mk3on5\" }],\n  [\"circle\", { cx: \"4\", cy: \"4\", r: \"2\", key: \"bt5ra8\" }]\n]);\nexport const Twitter = createLucideIcon(\"Twitter\", [\n  [\n    \"path\",\n    {\n      d: \"M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z\",\n      key: \"pff0z6\"\n    }\n  ]\n]);\n";

/** Mark strings/comments so examples containing import syntax remain untouched. */
function codePositions(source: string): Uint8Array {
  const code = new Uint8Array(source.length);
  let quote = ''; let lineComment = false; let blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index], next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (char === '\\') index++; else if (char === quote) quote = ''; continue; }
    if (char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    code[index] = 1;
  }
  return code;
}

/** Normalize a pinned publishing snapshot without replacing user files or dependencies. */
export function lucideCompatibleSource(files: Record<string, string>): Record<string, string> {
  let modulePath = 'src/brainhalf-brand-icons.tsx'; let suffix = 0;
  while (files[modulePath] !== undefined && files[modulePath] !== LUCIDE_BRAND_SOURCE) modulePath = `src/brainhalf-brand-icons-${++suffix}.tsx`;
  const result = { ...files }; let changed = false;
  for (const [path, source] of Object.entries(files)) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
    const code = codePositions(source);
    result[path] = source.replace(/\bimport\s*\{([^}]+)\}\s*from\s*(['"])lucide-react\2\s*;?/g, (match, names: string, _quote: string, offset: number) => {
      if (!code[offset]) return match;
      const imports = names.split(',').map(name => name.trim()).filter(Boolean);
      const legacy = imports.filter(name => /^(Github|Linkedin|Twitter)(?:\s+as\s+[\w$]+)?$/.test(name));
      if (!legacy.length) return match;
      const keep = imports.filter(name => !legacy.includes(name));
      const from = path.split('/'); from.pop(); const to = modulePath.replace(/\.tsx$/, '').split('/');
      while (from.length && from[0] === to[0]) { from.shift(); to.shift(); }
      const relative = (from.length ? '../'.repeat(from.length) : './') + to.join('/');
      changed = true;
      return (keep.length ? `import { ${keep.join(', ')} } from 'lucide-react';\n` : '') + `import { ${legacy.join(', ')} } from '${relative}';`;
    });
  }
  if (changed) result[modulePath] = LUCIDE_BRAND_SOURCE;
  return changed ? result : files;
}
