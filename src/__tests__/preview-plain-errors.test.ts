import { describe, expect, it } from 'vitest';
import { diagnosePreviewError, plainPreviewError } from '../lib/preview-diagnostics';

describe('plainPreviewError', () => {
  it('explains react-render errors in plain language', () => {
    const diagnostic = diagnosePreviewError('TypeError: Cannot read properties of undefined (reading \'map\')');
    const plain = plainPreviewError(diagnostic, 'frontend');
    expect(plain).not.toContain('TypeError');
    expect(plain).not.toContain('undefined');
    expect(plain).toContain('Ask the builder to fix');
  });

  it('explains backend errors in plain language', () => {
    const diagnostic = diagnosePreviewError('[Backend Error] TypeError: Cannot read properties of null');
    const plain = plainPreviewError(diagnostic, 'backend');
    expect(plain).not.toContain('TypeError');
    expect(plain).toContain("your app's backend");
    expect(plain).toContain('Ask the builder to fix');
  });

  it('explains syntax errors in plain language', () => {
    const diagnostic = diagnosePreviewError('SyntaxError: Unexpected token <');
    const plain = plainPreviewError(diagnostic, 'frontend');
    expect(plain).not.toContain('SyntaxError');
    expect(plain).not.toContain('Unexpected token');
    expect(plain.toLowerCase()).toContain('typo');
  });

  it('explains network errors in plain language', () => {
    const diagnostic = diagnosePreviewError('Failed to fetch');
    const plain = plainPreviewError(diagnostic, 'frontend');
    expect(plain).not.toContain('Failed to fetch');
    expect(plain.toLowerCase()).toContain('connection');
  });

  it('explains unknown errors in plain language', () => {
    const diagnostic = diagnosePreviewError('Some weird error nobody has seen');
    const plain = plainPreviewError(diagnostic, 'frontend');
    expect(plain).toContain('ran into a problem');
    expect(plain).toContain('Ask the builder to fix');
  });
});

describe('app-space backend messages use plain language', () => {
  it('hosted/release errors say "app space" not "slot"', async () => {
    const src = await import('fs').then(fs =>
      fs.readFileSync('src/runtime/project.ts', 'utf8')
    );
    expect(src).not.toContain('hosted slot id');
    expect(src).not.toContain('Hosted slot not found');
    expect(src).not.toContain('This slot belongs to');
    expect(src).toContain('A valid app space id is required.');
    expect(src).toContain('App space not found on your account.');
  });
});
