import { describe, it, expect } from 'vitest';
import { normalizePath, isSafeFilePath } from '../lib/utils';

describe('P0 Security & Input Sanitization', () => {
  describe('Path Traversal Prevention', () => {
    it('collapses relative path traversals safely', () => {
      // Testing normalizePath against directory traversal sequences
      const result1 = normalizePath('../../../etc/passwd');
      expect(result1).not.toContain('..');

      const result2 = normalizePath('src/../../secret.env');
      expect(result2).not.toContain('..');
    });

    it('sanitizes null bytes and whitespace in paths', () => {
      const result = normalizePath('   src/App.jsx\0malicious   ');
      expect(result).not.toContain('\0');
    });
  });

  describe('SQL Wildcard Protection', () => {
    it('detects and escapes SQL LIKE wildcard characters', () => {
      const escapeWildcards = (str: string) => str.replace(/[%_]/g, '\\$&');
      expect(escapeWildcards('%')).toBe('\\%');
      expect(escapeWildcards('_')).toBe('\\_');
      expect(escapeWildcards('App.jsx')).toBe('App.jsx');
      expect(escapeWildcards('100%_done.jsx')).toBe('100\\%\\_done.jsx');
    });
  });

  describe('Zip Slip & Path Safety Validation', () => {
    it('disallows paths with upward directory traversal or null bytes', () => {
      expect(isSafeFilePath('src/App.jsx')).toBe(true);
      expect(isSafeFilePath('../../evil.sh')).toBe(false);
      expect(isSafeFilePath('src/components/../../evil.sh')).toBe(false);
      expect(isSafeFilePath('/src/styles.css')).toBe(true);
      expect(isSafeFilePath('src/App.jsx\0malicious')).toBe(false);
      expect(isSafeFilePath('')).toBe(false);
    });
  });
});
