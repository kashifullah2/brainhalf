export type PreviewDiagnostic = {
  category: 'react-render' | 'reference' | 'syntax' | 'network' | 'unknown';
  likelyCause: string;
  suggestedFix: string;
};

export function diagnosePreviewError(error: string): PreviewDiagnostic {
  const text = String(error || '').toLowerCase();

  if (text.includes('minified react error #130') || text.includes('element type is invalid')) {
    return {
      category: 'react-render',
      likelyCause: 'Invalid component import/export (default vs named) or rendering a non-component object.',
      suggestedFix: 'Verify component exports and imports match exactly, and ensure JSX only renders valid components/elements.',
    };
  }

  if (text.includes('cannot read properties of undefined') || text.includes('cannot read properties of null')) {
    return {
      category: 'react-render',
      likelyCause: 'Null/undefined access in render path before data initializes.',
      suggestedFix: 'Add optional chaining/defaults in render and initialize state with safe fallback objects/arrays.',
    };
  }

  if (text.includes('is not defined')) {
    return {
      category: 'reference',
      likelyCause: 'Missing import or variable used outside its scope.',
      suggestedFix: 'Add the missing import/definition and verify variable names are in scope where used.',
    };
  }

  if (text.includes('unexpected token') || text.includes('unterminated') || text.includes('invalid or unexpected token')) {
    return {
      category: 'syntax',
      likelyCause: 'Syntax error in generated source (unclosed bracket/string or malformed JSX).',
      suggestedFix: 'Check the file around the reported line for unclosed tags/brackets/quotes and malformed JSX.',
    };
  }

  if (text.includes('dependency loading failed') || text.includes('failed to fetch dynamically imported module')) {
    return {
      category: 'network',
      likelyCause: 'A package the app uses could not be loaded from the CDN.',
      suggestedFix: 'Check that the package name and version exist on npm. The builder can fix this automatically.',
    };
  }

  if (text.includes('failed to fetch') || text.includes('networkerror') || text.includes('cors')) {
    return {
      category: 'network',
      likelyCause: 'Request blocked by CORS/CSP or endpoint unreachable.',
      suggestedFix: 'Validate endpoint URL, CORS headers, and CSP connect-src/permission rules for preview runtime.',
    };
  }

  return {
    category: 'unknown',
    likelyCause: 'Unhandled runtime error in preview execution.',
    suggestedFix: 'Inspect stack trace and narrow the failure to the last changed file before regenerating targeted fixes.',
  };
}

/**
 * Best-effort extraction of a source file path from an error message.
 * Returns empty string when no path can be found — never fabricates one.
 */
export function extractFileFromError(error: string): string {
  const patterns = [
    /(?:at|in|from)\s+(\/src\/[^\s:,'"()\]]+)/,
    /(?:Module not found|Cannot find module|Cannot resolve)[^'"]*['"]([^'"]+)['"]/,
    /(\/(?:src|worker|server|shared|migrations)\/[^\s:,'"()\]]+\.(?:[cm]?[jt]sx?|sql|css))/,
  ];
  for (const p of patterns) {
    const m = p.exec(error);
    if (m?.[1]) return m[1];
  }
  return '';
}

/**
 * Detects whether an error originated from the frontend or backend layer.
 * Defaults to 'frontend' when the layer cannot be determined.
 */
export function detectLayerFromError(error: string): 'frontend' | 'backend' {
  const lower = error.toLowerCase();
  if (
    lower.includes('[backend') ||
    lower.includes('/worker/') ||
    lower.includes('/server/') ||
    lower.includes('d1_error') ||
    lower.includes('d1 error') ||
    lower.includes('no such table') ||
    lower.includes('sql') ||
    lower.includes('database') ||
    lower.includes('workers runtime')
  ) return 'backend';
  return 'frontend';
}

/**
 * Strips patterns that commonly carry secrets before showing an error in the UI.
 * Not a guaranteed sanitizer — just a best-effort filter.
 */
export function sanitizeErrorForDisplay(error: string): string {
  return error
    .replace(/([?&](?:key|token|api_key|apikey|access_token|secret|auth)[=:])([^\s&"'<>{}\]]{4,})/gi, '$1[redacted]')
    .replace(/(Authorization:\s*(?:Bearer|Basic)\s+)[^\s"']{6,}/gi, '$1[redacted]')
    .replace(/\b[A-Za-z0-9+/]{60,}={0,2}\b/g, '[encoded-data]')
    .slice(0, 600);
}

/**
 * Plain-language explanation of a preview error for non-technical users.
 * Used in the preview strip instead of the raw error message.
 */
export function plainPreviewError(diagnostic: PreviewDiagnostic, layer: 'backend' | 'frontend'): string {
  const where = layer === 'backend' ? "your app's backend" : 'your app';
  const Where = where.charAt(0).toUpperCase() + where.slice(1);
  switch (diagnostic.category) {
    case 'react-render':
      return `Something went wrong showing ${where}. The builder can fix this — click "Ask the builder to fix".`;
    case 'reference':
      return `${Where} tried to use something that wasn't set up yet. The builder can fix this — click "Ask the builder to fix".`;
    case 'syntax':
      return `There's a typo in ${where}'s code. The builder can fix this — click "Ask the builder to fix".`;
    case 'network':
      return `${Where} couldn't reach something it needed. Check your connection, or ask the builder to fix it.`;
    default:
      return `${Where} ran into a problem. The builder can try to fix it — click "Ask the builder to fix".`;
  }
}

