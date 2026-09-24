import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TEXT, imageMimeFromBytes, validateAttachment } from './builder-attachments';

const toDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('The file could not be read. Try again.'));
  reader.onload = () => resolve(String(reader.result));
  reader.readAsDataURL(file);
});

export async function readUpload(file: File) {
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new Error('Choose a non-empty file up to 5 MB.');
  const ext = file.name.split('.').pop()?.toLowerCase();
  const imageMime = imageMimeFromBytes(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  let mime = imageMime || file.type || 'application/octet-stream';
  let text = ''; let note: string | undefined;
  if (!imageMime && ext === 'pdf') {
    mime = 'application/pdf';
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    const task = pdfjs.getDocument({ data: await file.arrayBuffer(), useSystemFonts: true });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 100) throw new Error('Please split PDFs longer than 100 pages before uploading.');
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const content = await page.getTextContent();
        text += `\n[Page ${number}]\n` + content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
        page.cleanup();
        if (text.length > MAX_ATTACHMENT_TEXT) { note = `Text preview shortened to ${MAX_ATTACHMENT_TEXT.toLocaleString()} characters. Split this PDF to read the remaining pages.`; break; }
      }
      if (!text.replace(/\[Page \d+\]/g, '').trim()) throw new Error('This PDF contains scanned pages without selectable text. Run OCR first, or upload the pages as images.');
    } catch (error) {
      if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is password-protected. Upload an unlocked copy.');
      throw error;
    } finally { await task.destroy(); }
  } else if (!imageMime && ext === 'docx') {
    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const document = zip.file('word/document.xml');
    if (!document) throw new Error('This file is not a readable DOCX document.');
    const expanded = (document as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!expanded || expanded > 2 * 1024 * 1024) throw new Error('This Word document is too large to extract. Save the relevant section as a smaller DOCX or Markdown file.');
    const xml = new DOMParser().parseFromString(await document.async('string'), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('The Word document is damaged. Save it again and retry.');
    text = [...xml.getElementsByTagNameNS('*', 'p')].map(paragraph => [...paragraph.getElementsByTagNameNS('*', 't')].map(node => node.textContent).join('')).join('\n');
    if (!text.trim()) throw new Error('No readable text was found in this Word document.');
  } else if (!mime.startsWith('image/')) {
    if (['doc', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'exe', 'mp3', 'mp4'].includes(ext || '')) throw new Error('For documents, use PDF, DOCX, Markdown, or plain text. For tabular data, use CSV.');
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('This binary format cannot be read as text. Convert it to PDF, DOCX, Markdown, or a text file.'); }
    if (text.includes('\0')) throw new Error('This file contains binary data. Upload a readable document or image.');
    mime = file.type || 'text/plain';
  }
  if (text.length > MAX_ATTACHMENT_TEXT) note ||= `Text preview shortened to ${MAX_ATTACHMENT_TEXT.toLocaleString()} characters. Split the document to read the rest.`;
  const originalUrl = await toDataUrl(file);
  const dataUrl = `data:${mime};base64,${originalUrl.slice(originalUrl.indexOf(',') + 1)}`;
  return validateAttachment({ name: file.name, mime, size: file.size, dataUrl, text: text.slice(0, MAX_ATTACHMENT_TEXT), note });
}
