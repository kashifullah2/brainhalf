#!/usr/bin/env node
/**
 * Gemini streaming proxy — patches missing `index` in tool_calls deltas.
 *
 * Claude Code's validator requires tool_calls[N].index: number, but
 * Gemini's API omits it. This proxy sits between Claude Code and Gemini,
 * injecting index=0 (or the array position) into each tool_call object.
 *
 * Usage:
 *   node scripts/gemini-proxy.mjs          # listens on port 4242
 *   node scripts/gemini-proxy.mjs 4243     # custom port
 *
 * Then configure Claude Code to use this proxy as the API base URL:
 *   ANTHROPIC_BASE_URL=http://localhost:4242 claude
 * Or add to ~/.claude/settings.json:
 *   { "env": { "ANTHROPIC_BASE_URL": "http://localhost:4242" } }
 *
 * Set GEMINI_API_KEY in your environment for auth forwarding.
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const PORT = parseInt(process.argv[2] || '4242', 10);
const UPSTREAM = process.env.GEMINI_UPSTREAM || 'https://generativelanguage.googleapis.com';

function patchChunk(line) {
  if (!line.startsWith('data: ')) return line;
  const payload = line.slice(6).trim();
  if (payload === '[DONE]') return line;
  try {
    const obj = JSON.parse(payload);
    let patched = false;
    for (const choice of obj?.choices ?? []) {
      const calls = choice?.delta?.tool_calls;
      if (Array.isArray(calls)) {
        calls.forEach((tc, i) => {
          if (typeof tc.index !== 'number') {
            tc.index = i;
            patched = true;
          }
        });
      }
    }
    return patched ? `data: ${JSON.stringify(obj)}` : line;
  } catch {
    return line;
  }
}

const server = http.createServer((req, res) => {
  const upstream = new URL(req.url, UPSTREAM);
  const options = {
    hostname: upstream.hostname,
    port: upstream.port || 443,
    path: upstream.pathname + upstream.search,
    method: req.method,
    headers: { ...req.headers, host: upstream.hostname },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const isStream = (proxyRes.headers['content-type'] || '').includes('text/event-stream');
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    if (!isStream) {
      proxyRes.pipe(res);
      return;
    }
    let buffer = '';
    proxyRes.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        res.write(patchChunk(line) + '\n');
      }
    });
    proxyRes.on('end', () => {
      if (buffer) res.write(patchChunk(buffer) + '\n');
      res.end();
    });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`Gemini proxy running on http://localhost:${PORT}`);
  console.log(`Upstream: ${UPSTREAM}`);
  console.log(`Set ANTHROPIC_BASE_URL=http://localhost:${PORT} before running claude`);
});
