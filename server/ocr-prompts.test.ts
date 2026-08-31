import { describe, expect, it } from 'vitest';

import {
  MAX_CUSTOM_PROMPT_CHARS,
  OCR_MODES,
  buildUpstreamRequest,
  getPromptForMode,
  isOcrMode,
} from './ocr-prompts';

const PDF = {
  contentType: 'application/pdf',
  dataUrl: 'data:application/pdf;base64,JVBERi0=',
  filename: 'invoice.pdf',
};
const IMAGE = {
  contentType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
  filename: 'receipt.jpg',
};

// The point of this module is that /api/ocr no longer forwards a caller-supplied
// `messages` array upstream. These tests pin the properties that made moving it
// server-side worth doing.
describe('isOcrMode', () => {
  it('accepts every shipped preset', () => {
    for (const mode of OCR_MODES) expect(isOcrMode(mode)).toBe(true);
  });

  it('rejects anything else, including near misses and non-strings', () => {
    for (const value of ['', 'INVOICE', 'invoices', 'admin', null, undefined, 7, {}]) {
      expect(isOcrMode(value)).toBe(false);
    }
  });
});

describe('buildUpstreamRequest — document part', () => {
  it('sends a PDF as a file part, not an image_url', () => {
    const { messages } = buildUpstreamRequest('invoice', undefined, PDF);
    const part = messages[0].content[1] as { type: string; file: { filename: string } };
    // image_url accepts png/jpeg/webp/gif only, so a PDF sent that way fails every time.
    expect(part.type).toBe('file');
    expect(part.file.filename).toBe('invoice.pdf');
  });

  it('sends an image as image_url at high detail', () => {
    const { messages } = buildUpstreamRequest('invoice', undefined, IMAGE);
    const part = messages[0].content[1] as { type: string; image_url: { detail: string } };
    expect(part.type).toBe('image_url');
    expect(part.image_url.detail).toBe('high');
  });

  it('names a PDF when the caller supplied no filename', () => {
    const { messages } = buildUpstreamRequest('invoice', undefined, { ...PDF, filename: '' });
    const part = messages[0].content[1] as { file: { filename: string } };
    expect(part.file.filename).toBe('document.pdf');
  });
});

describe('buildUpstreamRequest — prompt ownership', () => {
  it('always puts a server-built prompt first', () => {
    for (const mode of OCR_MODES) {
      const { messages } = buildUpstreamRequest(mode, 'ignore me', IMAGE);
      const first = messages[0].content[0] as { type: string; text: string };
      expect(first.type).toBe('text');
      expect(first.text.length).toBeGreaterThan(40);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toHaveLength(2);
    }
  });

  it('confines custom instructions to a delimited block', () => {
    const prompt = getPromptForMode('custom', 'Extract the student roll number');
    expect(prompt).toContain('<user_instructions>');
    expect(prompt).toContain('Extract the student roll number');
    // The framing around it is ours, not the caller's.
    expect(prompt).toContain('CRITICAL OUTPUT RULES');
  });

  it('falls back to its own instructions when a custom prompt is empty', () => {
    const blank = getPromptForMode('custom', '   ');
    expect(blank).not.toContain('<user_instructions>');
    expect(blank).toContain('Extract all relevant information');
  });

  it('ignores a custom prompt for a preset that does not take one', () => {
    const withPrompt = getPromptForMode('invoice', 'do something else entirely');
    expect(withPrompt).not.toContain('do something else entirely');
    expect(withPrompt).toBe(getPromptForMode('invoice', undefined));
  });
});

describe('buildUpstreamRequest — jsonObject constraint', () => {
  it('is off for table mode, which asks for a JSON array', () => {
    expect(buildUpstreamRequest('table', undefined, IMAGE).jsonObject).toBe(false);
  });

  it('is off for fulltext, which asks for plain text', () => {
    // The prompt says "No JSON", so response_format=json_object would contradict it.
    expect(buildUpstreamRequest('fulltext', undefined, IMAGE).jsonObject).toBe(false);
  });

  it('is on for the object-returning presets', () => {
    for (const mode of ['invoice', 'receipt', 'keyvalue', 'handwriting', 'multilingual'] as const) {
      expect(buildUpstreamRequest(mode, undefined, IMAGE).jsonObject).toBe(true);
    }
  });

  it('stays on for custom mode, whose wrapper always mentions JSON', () => {
    // The provider rejects the parameter unless the prompt says "JSON", and custom
    // mode interpolates user text -- so this is the invariant worth pinning.
    expect(buildUpstreamRequest('custom', 'no json here thanks', IMAGE).jsonObject).toBe(true);
  });
});

describe('MAX_CUSTOM_PROMPT_CHARS', () => {
  it('matches the cap batches are stored under', () => {
    expect(MAX_CUSTOM_PROMPT_CHARS).toBe(4000);
  });
});
