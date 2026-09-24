export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT = 120_000;
export const MAX_TURN_ATTACHMENTS = 5;
export interface BuilderAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  text: string;
  dataUrl: string;
  note?: string;
}
export type AttachmentSummary = Pick<BuilderAttachment, 'id' | 'name' | 'mime' | 'size' | 'note'>;

/** File extensions and browser MIME labels can disagree with downloaded images. */
export function imageMimeFromBytes(bytes: Uint8Array): string | undefined {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38) && [0x37, 0x39].includes(bytes[4]) && bytes[5] === 0x61) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return undefined;
}

export function validateAttachment(value: unknown): Omit<BuilderAttachment, 'id'> {
  const input = value as Partial<BuilderAttachment>;
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160 || (/[\\/]/.test(input.name) || [...input.name].some(character => character.charCodeAt(0) < 32))) throw new Error('Use a file name without path separators or control characters.');
  if (typeof input.mime !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(input.mime)) throw new Error('Invalid file type.');
  if (typeof input.dataUrl !== 'string' || input.dataUrl.length > MAX_ATTACHMENT_BYTES * 4 / 3 + 256) throw new Error('Files must be 5 MB or smaller.');
  const prefix = `data:${input.mime};base64,`;
  if (!input.dataUrl.startsWith(prefix)) throw new Error('Invalid attachment encoding.');
  let bytes: string;
  try { bytes = atob(input.dataUrl.slice(prefix.length)); } catch { throw new Error('Invalid attachment encoding.'); }
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || bytes.length !== input.size) throw new Error('The uploaded file size is invalid.');
  if (typeof input.text !== 'string' || input.text.length > MAX_ATTACHMENT_TEXT) throw new Error('The extracted document is too large.');
  if (input.mime.startsWith('image/') && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mime)) throw new Error('Use PNG, JPEG, WebP, or GIF images.');
  if (input.mime === 'image/png' && !bytes.startsWith('\x89PNG\r\n\x1a\n') || input.mime === 'image/jpeg' && !bytes.startsWith('\xff\xd8\xff') || input.mime === 'image/gif' && !/^GIF8[79]a/.test(bytes) || input.mime === 'image/webp' && !(bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP') || input.mime === 'application/pdf' && !bytes.slice(0, 1024).includes('%PDF-')) throw new Error('The file contents do not match its type.');
  return { name: input.name.trim(), mime: input.mime, size: bytes.length, dataUrl: input.dataUrl, text: input.text, ...(typeof input.note === 'string' ? { note: input.note.slice(0, 500) } : {}) };
}

export function attachmentSummary(file: BuilderAttachment): AttachmentSummary {
  return { id: file.id, name: file.name, mime: file.mime, size: file.size, ...(file.note ? { note: file.note } : {}) };
}

/** Text modules preserve the original bytes through preview, ZIP and GitHub exports. */
export function attachmentModules(file: BuilderAttachment): { path: string; files: Record<string, string> } {
  const root = `/src/assets/uploads/${file.id}`;
  const chunks = file.dataUrl.match(/[\s\S]{1,500000}/g) || [];
  const files: Record<string, string> = {};
  for (const [index, chunk] of chunks.entries()) files[`${root}.${index}.js`] = `export default ${JSON.stringify(chunk)};\n`;
  files[`${root}.js`] = chunks.map((_, index) => `import part${index} from './${file.id}.${index}.js';`).join('\n') + `\nexport default ${chunks.map((_, index) => `part${index}`).join(' + ')};\n`;
  // Strict TypeScript consumers need a declaration beside the JS entry point.
  files[`${root}.d.ts`] = 'declare const url: string;\nexport default url;\n';
  return { path: `${root}.js`, files };
}
