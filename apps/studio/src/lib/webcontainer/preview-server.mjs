/**
 * Zero-dependency static file server for instant preview (no npm install).
 * Vite takes over once dependencies are installed in the background.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

const PORT = 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".ts": "application/javascript; charset=utf-8",
  ".tsx": "application/javascript; charset=utf-8",
  ".jsx": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function resolveFile(urlPath) {
  let p = (urlPath || "/").split("?")[0];
  if (p === "/") p = "/index.html";
  const rel = p.replace(/^\//, "");
  for (const candidate of [rel, `public/${rel}`]) {
    try {
      const s = await stat(candidate);
      if (s.isFile()) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

createServer(async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin"
  };

  try {
    const file = await resolveFile(req.url);
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", ...headers });
      res.end("Not found");
      return;
    }
    const data = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", ...headers });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", ...headers });
    res.end(String(err));
  }
}).listen(PORT);
