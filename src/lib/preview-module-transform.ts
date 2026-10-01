/**
 * Edge-preview module pipeline: takes a stored source file and produces the
 * JavaScript module the sandboxed preview iframe evaluates. Extracted from
 * ChatAgent — the only state it needs is file existence, injected as
 * `hasAnyFile` so the import-path rewrites can resolve sibling layouts.
 */
import { transform } from 'sucrase';
import { autoHealAppCode } from './model-tester';

export function prepareModuleSource(raw: string, cleanPath: string, path: string, hasAnyFile: (paths: string[]) => boolean): string {
    // 1. Strip stray markdown fences the model may have left in the file.
    let c = raw.trim();
    const fenceStart = c.match(/^\s*```(?:[a-zA-Z0-9_-]+)?\r?\n/);
    if (fenceStart) {
      const afterFence = c.substring(fenceStart[0].length);
      const fenceEnd = afterFence.search(/\r?\n```/);
      c = fenceEnd !== -1 ? afterFence.substring(0, fenceEnd) : afterFence.replace(/\r?\n```[\s\S]*$/, '');
    } else {
      const trailingFence = c.search(/\r?\n```(?:\s*\r?\n|$)/);
      if (trailingFence !== -1) c = c.substring(0, trailingFence);
      c = c.replace(/^\s*```(?:[a-zA-Z0-9_-]+)?\r?\n/, '').replace(/\r?\n```[\s\S]*$/, '');
    }
    let content = autoHealAppCode(c.trim());

    // 2. Map common icon-name mistakes onto real lucide-react exports.
    const lucideAliases: Record<string, string> = {
      Chat: 'MessageSquare', Dashboard: 'LayoutDashboard', Spinner: 'Loader2',
      Gear: 'Settings', Robot: 'Bot', Bin: 'Trash2', Cross: 'X', Close: 'X',
      Logout: 'LogOut', Exit: 'LogOut', Profile: 'User', Graph: 'BarChart2',
      Stats: 'BarChart', Tick: 'Check', Add: 'Plus', Warning: 'AlertTriangle',
      Information: 'Info', Magnifier: 'Search', Delete: 'Trash2',
      FaFacebook: 'Facebook', FaTwitter: 'Twitter', FaInstagram: 'Instagram',
      FaLinkedin: 'Linkedin', FaGithub: 'Github', FaYoutube: 'Youtube'
    };
    content = content.replace(/import\s*\{([^}]+)\}\s*from\s*['"](?:https:\/\/esm\.sh\/)?lucide-react['"]/g, (_m, importsStr) => {
      const parts = String(importsStr).split(',').map((p: string) => {
        const trimmed = p.trim();
        if (!trimmed) return '';
        let importedName = trimmed;
        let localName = trimmed;
        if (trimmed.includes(' as ')) {
          const partsAs = trimmed.split(/\s+as\s+/);
          importedName = partsAs[0].trim();
          localName = partsAs[1].trim();
        }
        if (lucideAliases[importedName]) {
          importedName = lucideAliases[importedName];
        } else {
          // Strip react-icons 2-3 letter prefixes ONLY when followed by an
          // uppercase letter, so native Lucide names like Facebook, Filter,
          // Film, FileText, History and Binary survive untouched.
          const prefixMatch = importedName.match(/^(?:Fi|Fa|Ai|Bs|Md|Hi|Lu|Bi|Tb|Ri|Io|Ti|Go|Vsc|Cg|Rx)(?=[A-Z])/);
          if (prefixMatch) {
            const stripped = importedName.slice(prefixMatch[0].length);
            importedName = lucideAliases[stripped] || stripped;
          }
        }
        return importedName === localName ? importedName : `${importedName} as ${localName}`;
      }).filter(Boolean);
      return `import { ${parts.join(', ')} } from 'lucide-react'`;
    });

    // 3. Add React hook imports the model used but forgot to import.
    const commonHooks = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useContext', 'useReducer'];
    const importedFromReact = new Set<string>();
    const reactImportRegex = /(?:^|\n)\s*import\s+((?:(?!import)[^;])+?)\s+from\s*['"]react['"]/g;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = reactImportRegex.exec(content)) !== null) {
      const namedMatch = rMatch[1].match(/\{([^}]+)\}/);
      if (namedMatch) {
        namedMatch[1].split(',').forEach(item => {
          const name = item.trim().split(/\s+as\s+/)[0].trim();
          if (name) importedFromReact.add(name);
        });
      }
    }
    const missingHooks = commonHooks.filter(hook => {
      if (importedFromReact.has(hook)) return false;
      if (!new RegExp(`(?<![.\\w])${hook}\\s*\\(`).test(content)) return false;
      return !new RegExp(`(?:const|let|var|function|type|interface)\\s+${hook}\\b`).test(content);
    });
    if (missingHooks.length > 0) {
      const reactImportWithBraces = /((?:^|\n)\s*import\s+[^;]*?\{)([^}]+)(\}[^;]*?\s+from\s*['"]react['"])/;
      const matchBraces = content.match(reactImportWithBraces);
      if (matchBraces) {
        content = content.replace(reactImportWithBraces, (_m, prefix, inside, suffix) => {
          const trimmedInside = String(inside).trim();
          const sep = trimmedInside.length > 0 ? ', ' : '';
          return `${prefix}${trimmedInside}${sep}${missingHooks.join(', ')}${suffix}`;
        });
      } else if (/(?:^|\n)\s*import\s+React\b([^;]*from\s*['"]react['"])/.test(content)) {
        content = content.replace(/(?:^|\n)\s*import\s+React\b([^;]*from\s*['"]react['"])/, (_m, rest) => `\nimport React, { ${missingHooks.join(', ')} } ${rest}`);
      } else {
        content = `import React, { ${missingHooks.join(', ')} } from 'react';\n${content}`;
      }
    }

    // 4. Wrap a bare top-level return in a component function.
    const hasExportDefault = /export\s+default\b/.test(content);
    const hasTopLevelReturn = /\breturn\s*[(<]/.test(content);
    const hasComponentFn = /(?:function|const|let|var)\s+[A-Z][a-zA-Z0-9_$]*\s*(?:=|\()/.test(content);
    if (hasTopLevelReturn && !hasExportDefault && !hasComponentFn) {
      const compName = path.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '') || 'Component';
      const lines = content.split('\n');
      const importLines: string[] = [];
      const bodyLines: string[] = [];
      let pastImports = false;
      for (const line of lines) {
        if (!pastImports && (line.trim().startsWith('import ') || line.trim().startsWith('//') || !line.trim())) {
          importLines.push(line);
        } else {
          pastImports = true;
          bodyLines.push(line);
        }
      }
      content = importLines.join('\n') + `\n\nexport default function ${compName}(props) {\n` + bodyLines.join('\n') + '\n}\n';
    }

    // 5. Canonicalize relative imports BEFORE transpiling, so the rewrite sees
    //    the original specifier rather than whatever sucrase emitted.
    if (/^\/src\/(components|context|pages)\//.test(cleanPath)) {
      content = content.replace(/from\s+['"](\.\/)([^'"]+)['"]/g, (m, _dot, rest) => {
        const filename = String(rest).split('/').pop() || rest;
        const baseName = filename.replace(/\.[^.]+$/, '');
        const extensions = ['.jsx', '.tsx', '.js', '.ts', '.json', '.css'];
        const dir = cleanPath.slice(0, cleanPath.lastIndexOf('/'));
        const siblingPaths = extensions.map(ext => `${dir}/${baseName}${ext}`);
        if (hasAnyFile(siblingPaths)) return m;
        const parentPaths = [
          ...extensions.map(ext => `/src/${baseName}${ext}`),
          ...extensions.map(ext => `src/${baseName}${ext}`),
        ];
        return hasAnyFile(parentPaths) ? `from '../${rest}'` : m;
      });
    }

    // Ensure React is in scope for Sucrase's JSX transform (which converts JSX to React.createElement)
    if (/\.([jt]sx)$/.test(cleanPath) || /<[A-Za-z0-9_$]+/.test(content)) {
      if (!/\bimport\s+React\b/.test(content)) {
        const reactNamedImportRegex = /((?:^|\n)\s*import\s+)\{([^}]+)\}(\s+from\s*['"]react['"])/;
        if (reactNamedImportRegex.test(content)) {
          content = content.replace(reactNamedImportRegex, "$1React, { $2 }$3");
        } else if (!/from\s*['"]react['"]/.test(content)) {
          content = `import React from 'react';\n${content}`;
        }
      }
    }

    // Replace Vite import.meta.env and Node process.env with runtime-safe access
    content = content.replace(/import\.meta\.env/g, '(window.__BH_ENV__ || {})');
    content = content.replace(/process\.env/g, '(window.process?.env || {})');

    // 6. Transpile.
    content = transform(content, { transforms: ['typescript', 'jsx'] }).code;

    // 7. Turn side-effect CSS imports into runtime <link> injection.
    content = content.replace(/import\s+['"]([^'"]+\.css)['"];?/g, (_m, p1) => {
      const filename = String(p1).split('/').pop() || 'styles.css';
      return `
        (function() {
          const id = 'bh-css-' + ${JSON.stringify(filename)}.replace(/[^a-zA-Z0-9]/g, '-');
          if (!document.getElementById(id)) {
            const link = document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            link.href = ${JSON.stringify(filename)};
            document.head.appendChild(link);
          }
        })();
      `;
    });

    // 8. Guarantee a default export so the loader always finds a component.
    if (!/export\s+default\b/.test(content)) {
      const namedMatch = content.match(/export\s+(?:function|const|class)\s+([A-Za-z0-9_$]+)/) ||
        content.match(/(?:function|const|class)\s+([A-Z][A-Za-z0-9_$]+)/);
      if (namedMatch && namedMatch[1]) {
        content += `\nexport default ${namedMatch[1]};\n`;
      } else {
        const compName = path.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '');
        if (compName && content.includes(compName)) content += `\nexport default ${compName};\n`;
      }
    }

    // 8b. Guarantee that any default-exported component is also available as a named export.
    const defExportMatch = content.match(/export\s+default\s+(?:(?:async\s+)?function\s*\*?\s+|class\s+)([A-Za-z_$][\w$]*)\b/) ||
      content.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*(?:;|$)/);
    if (defExportMatch && defExportMatch[1]) {
      const defName = defExportMatch[1];
      if (!['function', 'class', 'async', 'null', 'true', 'false', 'undefined'].includes(defName) &&
          !new RegExp(`export\\s+(?:const|let|var|function|class)\\s+${defName}\\b`).test(content) &&
          !new RegExp(`export\\s*\\{[^}]*\\b${defName}\\b[^}]*\\}`).test(content)) {
        content += `\nexport { ${defName} };\n`;
      }
    }

    // 8c. Guarantee that top-level declared functions and variables are exported
    // so named imports from other modules find them.
    const topLevelDecls = content.matchAll(/^(?:const|let|var|function)\s+([a-zA-Z0-9$][a-zA-Z0-9_$]*)\b/gm);
    const namesToExport = new Set<string>();
    for (const m of topLevelDecls) {
      const name = m[1];
      if (name && !name.startsWith('_') && !name.startsWith('bh') && name !== 'default' &&
          !new RegExp(`export\\s+(?:const|let|var|function|class)\\s+${name}\\b`).test(content) &&
          !new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(content)) {
        namesToExport.add(name);
      }
    }
    if (namesToExport.size > 0) {
      content += `\nexport { ${[...namesToExport].join(', ')} };\n`;
    }

    // 9. Add extensions to extensionless relative imports so the browser's
    //    module resolver can find them.
    content = content.replace(/from\s+['"](\.[^'"]+)['"]/g, (m, p1) => {
      if (/\.(css|jsx|tsx|ts|js|json)$/.test(p1)) return m;
      return `from '${p1}.jsx'`;
    });

    return content;
  }

/** A module that renders the transpile error instead of a blank preview. */
export function buildTranspileErrorModule(path: string, errMsg: string): string {
    return `
      import React from 'react';
      console.error("Transpile Error in " + ${JSON.stringify(path)} + ":\\n" + ${JSON.stringify(errMsg)});
      try {
        if (typeof window !== 'undefined' && window.parent !== window) {
          window.parent.postMessage({
            type: 'preview-error',
            file: ${JSON.stringify(path)},
            error: "Transpile Error in " + ${JSON.stringify(path)} + ": " + ${JSON.stringify(errMsg)}
          }, window.location.origin);
        }
      } catch (_) {}

      export default function TranspileErrorView() {
        return React.createElement('div', {
          style: {
            padding: '32px 20px', fontFamily: 'system-ui, -apple-system, sans-serif',
            background: '#0a0a12', color: '#f87171', minHeight: '100vh',
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box'
          }
        }, React.createElement('div', {
          style: {
            background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '16px', padding: '24px 28px', maxWidth: '560px', width: '100%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }
        }, [
          React.createElement('h3', { key: 'title', style: { margin: '0 0 12px', fontSize: '16px', fontWeight: 600, color: '#fca5a5' } }, 'Syntax or Runtime Error'),
          React.createElement('div', { key: 'file', style: { fontSize: '12px', color: '#94a3b8', marginBottom: '10px' } }, 'File: ' + ${JSON.stringify(path)}),
          React.createElement('pre', {
            key: 'msg',
            style: {
              margin: '0', padding: '14px', background: 'rgba(0,0,0,0.5)', borderRadius: '8px',
              fontSize: '13px', color: '#f87171', fontFamily: 'monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid rgba(239, 68, 68, 0.15)'
            }
          }, ${JSON.stringify(errMsg)})
        ]));
      }
      export const App = TranspileErrorView;
    `;
  }
