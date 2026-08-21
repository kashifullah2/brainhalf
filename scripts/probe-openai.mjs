#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Capability probe for the configured OCR models.
//
//   node scripts/probe-openai.mjs                  # synthetic test image
//   node scripts/probe-openai.mjs ./invoice.png    # a real page, for token cost
//   node scripts/probe-openai.mjs ./scan.pdf       # also probes native PDF input
//
// Why this exists: server/openai-params.ts carries a static table of which
// parameters each model family accepts, and the GPT-5 tiers are newer than that
// table. Rather than guess, run this and correct the table from the output.
//
// Each parameter is probed on its own request. An all-at-once probe only tells
// you that *something* was rejected, which is the least useful answer.
//
// WHAT THIS CANNOT TELL YOU: whether Cloudflare Worker subrequests to the
// provider succeed. This runs in Node, not in a Worker. The previous provider
// blocked Worker subrequests, which is the whole reason a browser-side fallback
// existed. To verify that, run `pnpm dev:api` (wrangler pages dev) and extract a
// document through the real Function.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

// --- .env reading (no dependency on dotenv) --------------------------------

function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const root = process.cwd();
// .dev.vars wins over .env: it is what `wrangler pages dev` actually reads.
const fileEnv = { ...readEnvFile(path.join(root, '.env')), ...readEnvFile(path.join(root, '.dev.vars')) };
const env = { ...fileEnv, ...process.env };

const apiKey = env.OCR_API_KEY;
const baseUrl = (env.OCR_API_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const models = [
  env.OCR_MODEL || 'gpt-5.4-mini',
  env.OCR_MODEL_ESCALATION || 'gpt-5.4',
];

if (!apiKey) {
  console.error(
    'OCR_API_KEY is not set.\n\n' +
      'Put your OpenAI key in .env (or .dev.vars, or the environment) and re-run:\n' +
      '  OCR_API_KEY=sk-... node scripts/probe-openai.mjs\n',
  );
  process.exit(1);
}

// --- synthetic test image --------------------------------------------------
// A real PNG built here so the probe needs no fixture file. A 1x1 pixel can be
// rejected as too small by some vision endpoints, so this is 320x120 with dark
// bars on white — enough to look like a document to the tiler.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function syntheticPng(width = 320, height = 120) {
  // 8-bit grayscale. Each scanline is a filter byte followed by one byte/pixel.
  const stride = width + 1;
  const raw = Buffer.alloc(stride * height, 0xff);
  for (let y = 0; y < height; y += 1) raw[y * stride] = 0;

  for (let bar = 0; bar < 5; bar += 1) {
    const top = 14 + bar * 20;
    const barWidth = 60 + bar * 40;
    for (let y = top; y < top + 8 && y < height; y += 1) {
      for (let x = 20; x < 20 + barWidth && x < width; x += 1) {
        raw[y * stride + 1 + x] = 0x10;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: grayscale

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

const inputPath = process.argv[2];
let isPdf = false;
let dataUrl;
let sourceLabel;
let filename = 'document.png';

if (inputPath) {
  if (!existsSync(inputPath)) {
    console.error(`No such file: ${inputPath}`);
    process.exit(1);
  }
  const ext = path.extname(inputPath).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    console.error(`Unsupported extension ${ext}. Use png, jpg, webp, gif or pdf.`);
    process.exit(1);
  }
  isPdf = mime === 'application/pdf';
  filename = path.basename(inputPath);
  const bytes = readFileSync(inputPath);
  dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  sourceLabel = `${filename} (${(bytes.length / 1024).toFixed(0)} KB)`;
} else {
  const png = syntheticPng();
  dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  sourceLabel = `synthetic 320x120 PNG (${(png.length / 1024).toFixed(1)} KB)`;
}

// The prompt must contain the word "json" whenever response_format is
// json_object, or the request is rejected for that reason alone and the probe
// would wrongly report the parameter as unsupported.
const PROMPT = 'Transcribe any text in this document. Return ONLY a valid JSON object with a "text" key.';

function contentPart() {
  return isPdf
    ? { type: 'file', file: { filename, file_data: dataUrl } }
    : { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } };
}

async function call(model, extraParams) {
  const body = {
    model,
    messages: [
      { role: 'user', content: [{ type: 'text', text: PROMPT }, contentPart()] },
    ],
    ...extraParams,
  };

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Leave json null; the raw text is reported instead.
    }

    if (!res.ok) {
      const err = json?.error ?? {};
      return {
        ok: false,
        status: res.status,
        code: err.code ?? '',
        param: err.param ?? '',
        message: err.message ?? text.slice(0, 200),
      };
    }
    return { ok: true, status: res.status, json };
  } catch (error) {
    return { ok: false, status: 0, message: String(error?.message ?? error) };
  }
}

const PROBES = [
  { key: 'vision/baseline', params: {} },
  { key: 'temperature: 0', params: { temperature: 0 } },
  { key: 'seed: 42', params: { seed: 42 } },
  { key: 'logprobs: true', params: { logprobs: true } },
  { key: 'response_format', params: { response_format: { type: 'json_object' } } },
  { key: 'max_completion_tokens', params: { max_completion_tokens: 512 } },
];

function pad(value, width) {
  return String(value).padEnd(width);
}

console.log(`\nProbing ${baseUrl}`);
console.log(`Input:   ${sourceLabel}${isPdf ? '  [native PDF input]' : ''}`);

for (const model of models) {
  console.log(`\n── ${model} ${'─'.repeat(Math.max(0, 56 - model.length))}`);

  const baseline = await call(model, {});
  if (!baseline.ok) {
    console.log(`  ${pad('vision/baseline', 24)} FAIL  ${baseline.status} ${baseline.message}`);
    if (isPdf) {
      console.log(
        '\n  Native PDF input was rejected. Keep PDFs out of ACCEPTED_TYPES in\n' +
          '  src/components/UploadModal.tsx, or rasterise them client-side with pdf.js.',
      );
    } else {
      console.log('\n  The model could not read an image. Check the name, or fall back to gpt-4o-mini.');
    }
    continue;
  }

  const supported = [];
  const rejected = [];

  for (const probe of PROBES) {
    const result = probe.key === 'vision/baseline' ? baseline : await call(model, probe.params);

    if (result.ok) {
      supported.push(probe.key);
      let note = '';

      if (probe.key === 'logprobs: true') {
        // Accepted is not the same as returned. confidence-scorer.ts needs the
        // content array to actually be populated, or it silently falls back to
        // the flat 0.92 baseline.
        const entries = result.json?.choices?.[0]?.logprobs?.content;
        note = Array.isArray(entries) && entries.length > 0
          ? `returned ${entries.length} token logprobs`
          : 'ACCEPTED BUT RETURNED NOTHING — confidence would stay constant';
      }
      if (probe.key === 'vision/baseline') {
        const tokens = result.json?.usage?.total_tokens;
        note = tokens ? `${tokens} tokens for this page` : 'no usage reported';
      }

      console.log(`  ${pad(probe.key, 24)} ok    ${note}`);
    } else {
      rejected.push(probe.key);
      const named = result.param ? ` (param: ${result.param})` : '';
      console.log(
        `  ${pad(probe.key, 24)} FAIL  ${result.status}${named} ${String(result.message).slice(0, 110)}`,
      );
    }
  }

  const baseTokens = baseline.json?.usage?.total_tokens;
  if (baseTokens) {
    // The quota, not accuracy, is the binding constraint on this platform.
    console.log(
      `\n  At ${baseTokens} tokens/page: ~${Math.floor(2_500_000 / baseTokens)} pages/day on the mini quota, ` +
        `~${Math.floor(250_000 / baseTokens)} on the premium quota.`,
    );
  }

  if (rejected.length > 0) {
    console.log(
      `\n  Update server/openai-params.ts so ${model} does not send: ${rejected.join(', ')}`,
    );
  } else {
    console.log(`\n  All parameters accepted. The capability table needs no change for ${model}.`);
  }
}

console.log(
  '\nStill to verify by hand: that a Cloudflare Worker subrequest reaches the\n' +
    'provider. Run `pnpm dev:api` and extract one document through /api/ocr.\n',
);
