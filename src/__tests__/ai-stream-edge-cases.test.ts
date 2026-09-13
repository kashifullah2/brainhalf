import { describe, it, expect } from 'vitest';
import { parseMessageSegments } from '../lib/message-parser';
import { transform } from 'sucrase';

describe('AI Output Robustness & Sucrase Transpile Compatibility', () => {
  it('handles multi-file generation where first file lacks closing tag', () => {
    const aiOutput = `<file path="src/App.jsx">
import React from 'react';

export default function App() {
  return <div>Hello</div>;
}
<file path="src/styles.css">
body {
  margin: 0;
  padding: 0;
}
</file>`;

    const { fileMap } = parseMessageSegments(aiOutput, true);
    expect(fileMap['src/App.jsx']).toBeDefined();
    expect(fileMap['src/styles.css']).toBeDefined();

    // Check that src/App.jsx does NOT contain styles.css content!
    expect(fileMap['src/App.jsx']).not.toContain('body {');
    expect(fileMap['src/App.jsx']).not.toContain('margin: 0;');

    // Test that Sucrase can transpile App.jsx cleanly!
    expect(() => {
      transform(fileMap['src/App.jsx'], { transforms: ['typescript', 'jsx'] });
    }).not.toThrow();
  });

  it('handles code wrapped in markdown code fence with explanation at the bottom', () => {
    const aiOutput = `<file path="src/App.jsx">
\`\`\`jsx
import React from 'react';

export default function App() {
  return <h1>Dashboard</h1>;
}
\`\`\`
Hope this helps! You can customize the dashboard components.
</file>`;

    const { fileMap } = parseMessageSegments(aiOutput, true);
    expect(fileMap['src/App.jsx']).toBeDefined();
    expect(fileMap['src/App.jsx']).not.toContain('Hope this helps!');

    // Test that Sucrase transpiles it cleanly without Unexpected token, expected ";"
    expect(() => {
      transform(fileMap['src/App.jsx'], { transforms: ['typescript', 'jsx'] });
    }).not.toThrow();
  });

  it('preserves native Lucide icons like Facebook, Filter, FileText and heals cebook', () => {
    const lucideAliases: Record<string, string> = {
      Chat: 'MessageSquare',
      Dashboard: 'LayoutDashboard',
      cebook: 'Facebook',
      FaFacebook: 'Facebook',
      FaTwitter: 'Twitter',
    };

    function rewriteLucideImports(content: string): string {
      return content.replace(/import\s*\{([^}]+)\}\s*from\s*['"](?:https:\/\/esm\.sh\/)?lucide-react['"]/g, (match, importsStr) => {
        const parts = importsStr.split(',').map((p: string) => {
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
            const prefixMatch = importedName.match(/^(?:Fi|Fa|Ai|Bs|Md|Hi|Lu|Bi|Tb|Ri|Io|Ti|Go|Vsc|Cg|Rx)(?=[A-Z])/);
            if (prefixMatch) {
              const stripped = importedName.slice(prefixMatch[0].length);
              importedName = lucideAliases[stripped] || stripped;
            }
          }

          if (importedName === localName) {
            return importedName;
          }
          return `${importedName} as ${localName}`;
        }).filter(Boolean);
        return `import { ${parts.join(', ')} } from 'lucide-react'`;
      });
    }

    // 1. Facebook must NOT become cebook!
    const facebookCode = `import { Facebook, Twitter, Instagram } from 'lucide-react';`;
    const res1 = rewriteLucideImports(facebookCode);
    expect(res1).toBe(`import { Facebook, Twitter, Instagram } from 'lucide-react';`);
    expect(res1).not.toContain('cebook as');
    expect(res1).not.toMatch(/\bcebook\b/);

    // 2. FaFacebook must become Facebook as FaFacebook
    const faCode = `import { FaFacebook, FaTwitter } from 'lucide-react';`;
    const res2 = rewriteLucideImports(faCode);
    expect(res2).toBe(`import { Facebook as FaFacebook, Twitter as FaTwitter } from 'lucide-react';`);

    // 3. Corrupted cebook must heal to Facebook as cebook
    const cebookCode = `import { cebook } from 'lucide-react';`;
    const res3 = rewriteLucideImports(cebookCode);
    expect(res3).toBe(`import { Facebook as cebook } from 'lucide-react';`);

    // 4. Other native icons with 2-letter prefixes (Filter, FileText, History)
    const otherIcons = `import { Filter, FileText, Film, History } from 'lucide-react';`;
    const res4 = rewriteLucideImports(otherIcons);
    expect(res4).toBe(`import { Filter, FileText, Film, History } from 'lucide-react';`);
  });
});
