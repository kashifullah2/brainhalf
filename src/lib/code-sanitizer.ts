/**
 * Sanitizes and shields code before writing to WebContainer filesystem.
 * Protects against common LLM hallucinations like non-existent lucide-react exports ('Chat', etc.)
 */
export function sanitizeCodeForPreview(content: string, path: string): string {
  if (!path.endsWith('.jsx') && !path.endsWith('.tsx') && !path.endsWith('.js')) {
    return content;
  }

  // Intercept and safeguard Lucide icon imports
  let sanitized = content.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"];?/g,
    (_match, importsList) => {
      const names = importsList
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);

      return (
        `import * as _LucideIcons from 'lucide-react';\n` +
        names
          .map((rawName: string) => {
            // Handle aliases like "Chat as ChatIcon"
            const parts = rawName.split(/\s+as\s+/);
            const importedName = parts[0].trim();
            const localName = (parts[1] || parts[0]).trim();

            let fallback = 'Sparkles';
            if (/^chat/i.test(importedName) || /^comment/i.test(importedName) || /^message/i.test(importedName)) {
              fallback = 'MessageSquare';
            } else if (/^profile/i.test(importedName) || /^account/i.test(importedName) || /^avatar/i.test(importedName)) {
              fallback = 'User';
            } else if (/^edit/i.test(importedName) || /^pencil/i.test(importedName)) {
              fallback = 'Pencil';
            } else if (/^delete/i.test(importedName) || /^trash/i.test(importedName) || /^remove/i.test(importedName)) {
              fallback = 'Trash2';
            } else if (/^cart/i.test(importedName)) {
              fallback = 'ShoppingCart';
            } else if (/^warning/i.test(importedName)) {
              fallback = 'AlertTriangle';
            } else if (/^error/i.test(importedName)) {
              fallback = 'AlertCircle';
            } else if (/^done/i.test(importedName) || /^check/i.test(importedName)) {
              fallback = 'Check';
            } else if (/^close/i.test(importedName)) {
              fallback = 'X';
            } else if (/^gear/i.test(importedName)) {
              fallback = 'Settings';
            }

            return `const ${localName} = _LucideIcons['${importedName}'] || _LucideIcons['${fallback}'] || _LucideIcons.Sparkles || ((p) => <span {...p}>★</span>);`;
          })
          .join('\n')
      );
    }
  );

  return sanitized;
}
