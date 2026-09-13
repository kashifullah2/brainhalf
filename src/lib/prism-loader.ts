import Prism from 'prismjs';

// Guarantee global Prism is initialized before component extensions evaluate
if (typeof window !== 'undefined') {
  (window as any).Prism = Prism;
}
if (typeof globalThis !== 'undefined') {
  (globalThis as any).Prism = Prism;
}

// Dynamically import extensions so global Prism is guaranteed in browser/worker runtimes
if (typeof window !== 'undefined') {
  Promise.all([
    // @ts-ignore
    import('prismjs/components/prism-jsx'),
    // @ts-ignore
    import('prismjs/components/prism-typescript'),
    // @ts-ignore
    import('prismjs/components/prism-tsx'),
    // @ts-ignore
    import('prismjs/components/prism-json')
  ]).catch(() => {});
}

export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'jsx':
      return 'jsx';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
      return 'typescript';
    case 'css':
      return 'css';
    case 'json':
      return 'json';
    case 'html':
    case 'xml':
    case 'svg':
      return 'markup';
    default:
      return 'javascript';
  }
}

export function highlightCodeToLines(code: string, language: string): string[] {
  const langGrammar = Prism.languages[language] || Prism.languages.javascript || Prism.languages.markup;
  const rawHtml = Prism.highlight(code, langGrammar, language);
  
  const rawLines = rawHtml.split('\n');
  const openTags: string[] = [];

  return rawLines.map((line) => {
    const prefix = openTags.join('');
    
    // Track opened and closed span tags to keep line HTML well-formed
    const tagRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*)?>/g;
    let match;
    while ((match = tagRegex.exec(line)) !== null) {
      if (match[0].startsWith('</')) {
        openTags.pop();
      } else if (!match[0].endsWith('/>')) {
        openTags.push(match[0]);
      }
    }
    
    const suffix = openTags
      .map(tag => {
        const tagName = tag.match(/<([a-zA-Z0-9]+)/)?.[1];
        return tagName ? `</${tagName}>` : '';
      })
      .reverse()
      .join('');
      
    return prefix + line + suffix;
  });
}

export default Prism;
