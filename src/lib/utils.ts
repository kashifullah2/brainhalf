/**
 * BrainHalf shared utilities and path normalization helpers.
 */

export interface NormalizePathOptions {
  /**
   * If true (default), ensures the path begins with a forward slash: `/src/App.jsx`
   * If false, strips any leading forward slash: `src/App.jsx`
   */
  leadingSlash?: boolean;
}

/**
 * Normalizes file paths across the virtual workspace, edge SQLite, and preview runtime.
 * Prevents issues with inconsistent leading slashes, redundant slashes, and whitespace.
 */
export function normalizePath(rawPath: string, options: NormalizePathOptions = { leadingSlash: true }): string {
  if (!rawPath) return options.leadingSlash ? '/' : '';

  // 1. Trim, strip null bytes, and convert backslashes
  const clean = rawPath.trim().replace(/\0/g, '').replace(/\\/g, '/');

  // 2. Filter out traversal sequences (. and ..) and empty parts
  const segments = clean.split('/').filter(s => s && s !== '.' && s !== '..');
  const pathBody = segments.join('/');

  // 3. Apply leading slash preference
  if (options.leadingSlash) {
    return `/${pathBody}`;
  } else {
    return pathBody;
  }
}

/**
 * Extracts the file name (basename) from a given path.
 */
export function getFileName(filePath: string): string {
  const normalized = normalizePath(filePath, { leadingSlash: false });
  return normalized.split('/').pop() || normalized;
}

/**
 * Returns the lowercase extension of a file without the leading dot (e.g. "jsx", "css").
 */
export function getFileExtension(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

/**
 * Checks whether a given path is safe from directory traversal (Zip Slip, escaping root, etc.)
 */
export function isSafeFilePath(rawPath: string): boolean {
  if (!rawPath || typeof rawPath !== 'string') return false;
  // Check for null bytes
  if (rawPath.includes('\0')) return false;
  // Check for relative traversal segments
  const segments = rawPath.replace(/\\/g, '/').split('/');
  for (const seg of segments) {
    if (seg === '..') return false;
  }
  return true;
}

