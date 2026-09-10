import { describe, it, expect } from 'vitest';
import { normalizePath, getFileName, getFileExtension } from '../lib/utils';

describe('Path and String Utilities (normalizePath, getFileName, getFileExtension)', () => {
  describe('normalizePath', () => {
    it('normalizes paths with default leading slash', () => {
      expect(normalizePath('src/App.jsx')).toBe('/src/App.jsx');
      expect(normalizePath('/src/App.jsx')).toBe('/src/App.jsx');
      expect(normalizePath('///src///components//Button.jsx')).toBe('/src/components/Button.jsx');
    });

    it('handles leadingSlash: false option', () => {
      expect(normalizePath('/src/App.jsx', { leadingSlash: false })).toBe('src/App.jsx');
      expect(normalizePath('src/App.jsx', { leadingSlash: false })).toBe('src/App.jsx');
      expect(normalizePath('///src/index.css', { leadingSlash: false })).toBe('src/index.css');
    });

    it('converts Windows backslashes to forward slashes', () => {
      expect(normalizePath('src\\components\\Card.tsx')).toBe('/src/components/Card.tsx');
      expect(normalizePath('C:\\project\\src\\main.jsx')).toBe('/C:/project/src/main.jsx');
      expect(normalizePath('src\\styles.css', { leadingSlash: false })).toBe('src/styles.css');
    });

    it('trims outer whitespace', () => {
      expect(normalizePath('   src/App.jsx   ')).toBe('/src/App.jsx');
      expect(normalizePath('   /index.html   ', { leadingSlash: false })).toBe('index.html');
    });

    it('handles empty or blank paths safely', () => {
      expect(normalizePath('')).toBe('/');
      expect(normalizePath('', { leadingSlash: false })).toBe('');
      expect(normalizePath('   ')).toBe('/');
    });
  });

  describe('getFileName', () => {
    it('extracts basename from paths with or without leading slashes', () => {
      expect(getFileName('/src/components/Modal.tsx')).toBe('Modal.tsx');
      expect(getFileName('src/App.jsx')).toBe('App.jsx');
      expect(getFileName('index.html')).toBe('index.html');
      expect(getFileName('package.json')).toBe('package.json');
    });
  });

  describe('getFileExtension', () => {
    it('extracts lowercase file extensions without dot', () => {
      expect(getFileExtension('App.jsx')).toBe('jsx');
      expect(getFileExtension('/src/styles.CSS')).toBe('css');
      expect(getFileExtension('main.TSX')).toBe('tsx');
      expect(getFileExtension('archive.tar.gz')).toBe('gz');
    });

    it('returns empty string for files without extension', () => {
      expect(getFileExtension('Dockerfile')).toBe('');
      expect(getFileExtension('LICENSE')).toBe('');
    });
  });
});
