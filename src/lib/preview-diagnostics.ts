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

