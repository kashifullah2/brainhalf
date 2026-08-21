// ---------------------------------------------------------------------------
// Minimal, dependency-free .xlsx writer.
//
// Replaces `xlsx@0.18.5`, which carries unpatched advisories (prototype
// pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9) with no fixed
// version published to npm. We only ever WROTE spreadsheets from our own data,
// so the practical exposure was low — but a ~300 KB dependency with open
// advisories is not worth keeping for that.
//
// An .xlsx file is a ZIP of XML parts. ZIP permits STORED (uncompressed)
// entries, so no deflate implementation is needed: just local headers, a central
// directory, and CRC-32.
// ---------------------------------------------------------------------------

/** Escapes text for XML character data / attribute values. */
function escapeXml(value: string): string {
  let out = '';
  for (const char of value) {
    switch (char) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case "'":
        out += '&apos;';
        break;
      default: {
        const code = char.codePointAt(0) ?? 0;
        // Strip control characters Excel rejects outright (tab/LF/CR are legal).
        if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break;
        out += char;
      }
    }
  }
  return out;
}

/** Converts a zero-based column index to a spreadsheet letter (0 -> A, 26 -> AA). */
export function columnLetter(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

/** Builds a ZIP archive with every entry STORED (compression method 0). */
function buildZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const size = entry.bytes.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // local file header signature
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0, true); // flags
    localView.setUint16(8, 0, true); // method: stored
    localView.setUint16(10, 0, true); // mod time
    localView.setUint16(12, 0x2100, true); // mod date (1996-01-01, deterministic)
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true); // compressed size
    localView.setUint32(22, size, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); // extra length
    local.set(nameBytes, 30);

    locals.push(local, entry.bytes);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); // central directory signature
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x2100, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true); // comment length
    centralView.setUint16(34, 0, true); // disk number
    centralView.setUint16(36, 0, true); // internal attrs
    centralView.setUint32(38, 0, true); // external attrs
    centralView.setUint32(42, offset, true); // relative offset of local header
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + size;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); // end of central directory
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  // Concatenated into one buffer rather than passed as many Blob parts: it keeps
  // the type a plain Uint8Array<ArrayBuffer>, which is a valid BlobPart.
  const parts = [...locals, ...centrals, end];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }

  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** True for values Excel should store as a number rather than text. */
function isNumeric(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return false;

  const digits = text.replace(/^-/, '');

  // Leading zeros are significant in this domain: account numbers, mobile
  // numbers, and reference IDs. "03151929161" as a number becomes 3151929161.
  if (digits.length > 1 && digits[0] === '0' && digits[1] !== '.') return false;

  // Excel stores numbers as IEEE-754 doubles and silently rounds past 15
  // significant digits, so long numeric strings stay text.
  if (digits.split('.').join('').length > 15) return false;

  return true;
}

function sheetXml(headers: string[], rows: string[][]): string {
  const lines: string[] = [];

  const renderRow = (cells: string[], rowNumber: number, forceText: boolean) => {
    const parts = cells.map((raw, columnIndex) => {
      const ref = `${columnLetter(columnIndex)}${rowNumber}`;
      const value = raw ?? '';
      if (!forceText && isNumeric(value)) {
        return `<c r="${ref}"><v>${escapeXml(value.trim())}</v></c>`;
      }
      // t="inlineStr" avoids maintaining a shared-strings table.
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    });
    return `<row r="${rowNumber}">${parts.join('')}</row>`;
  };

  lines.push(renderRow(headers, 1, true));
  rows.forEach((row, index) => {
    lines.push(renderRow(row, index + 2, false));
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lines.join('')}</sheetData></worksheet>`;
}

/**
 * Builds a single-sheet .xlsx Blob from a list of records.
 *
 * Column order follows the union of keys in order of first appearance, so a
 * record that introduces a field later still gets a column.
 */
export function recordsToXlsx(
  records: Array<Record<string, string>>,
  sheetName = 'Sheet1',
): Blob {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }

  const rows = records.map((record) => headers.map((key) => record[key] ?? ''));

  // Excel rejects these characters in a sheet name, and caps it at 31 chars.
  const safeSheetName =
    sheetName.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet1';

  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      bytes: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      bytes: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      bytes: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      bytes: encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      bytes: encoder.encode(sheetXml(headers, rows)),
    },
  ];

  return buildZip(entries);
}

/**
 * Serialises records to RFC 4180 CSV.
 *
 * Values are expected to have passed through sanitizeForExport() already, which
 * neutralises spreadsheet formula injection.
 */
export function recordsToCsv(records: Array<Record<string, string>>): string {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }

  const quote = (value: string): string => {
    const text = value ?? '';
    // Quote when the value contains a delimiter, quote, or newline.
    if (/[",\r\n]/.test(text)) {
      return `"${text.split('"').join('""')}"`;
    }
    return text;
  };

  const lines = [headers.map(quote).join(',')];
  for (const record of records) {
    lines.push(headers.map((key) => quote(record[key] ?? '')).join(','));
  }
  // CRLF is what RFC 4180 specifies and what Excel expects.
  return lines.join('\r\n');
}

/** Triggers a browser download for a generated blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
