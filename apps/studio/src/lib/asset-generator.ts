import { webContainerManager } from "./webcontainer";

export type AssetType = "texture" | "model" | "sound";

export interface GeneratedAsset {
  /** WebContainer-relative path the asset was written to (null if not produced). */
  path: string | null;
  /** Human/model-readable note describing what happened and how to use it. */
  note: string;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "asset"
  );
}

/** Picks a base palette from keywords in the description. */
function paletteFor(description: string): { base: string; accent: string; pattern: string } {
  const d = description.toLowerCase();
  const has = (...keys: string[]) => keys.some((k) => d.includes(k));

  if (has("grass", "lawn", "leaf", "foliage")) return { base: "#3a7d2c", accent: "#56a83c", pattern: "noise" };
  if (has("water", "ocean", "sea", "lake")) return { base: "#1d4e89", accent: "#3a8ed0", pattern: "wave" };
  if (has("lava", "fire", "magma")) return { base: "#7a1500", accent: "#ff6a00", pattern: "noise" };
  if (has("metal", "steel", "iron", "chrome")) return { base: "#6b6f76", accent: "#9aa0a8", pattern: "brushed" };
  if (has("wood", "plank", "timber", "bark")) return { base: "#5a3a1e", accent: "#7a4f29", pattern: "wood" };
  if (has("stone", "rock", "concrete", "cobble")) return { base: "#5f6063", accent: "#7c7d80", pattern: "noise" };
  if (has("brick", "wall")) return { base: "#8a3b2a", accent: "#a64a36", pattern: "brick" };
  if (has("sand", "desert", "dune")) return { base: "#c2a25e", accent: "#d8bd80", pattern: "noise" };
  if (has("sky", "cloud")) return { base: "#5fa8e8", accent: "#bfe0ff", pattern: "wave" };
  if (has("space", "star", "galaxy", "night")) return { base: "#0a0a1e", accent: "#ffffff", pattern: "stars" };
  return { base: "#444a55", accent: "#6b7280", pattern: "noise" };
}

/** Deterministic pseudo-random from a seed so the same prompt yields the same asset. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Renders a 256x256 procedural, seamless-ish texture from the description. */
async function generateTexturePng(description: string): Promise<Uint8Array> {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const { base, accent, pattern } = paletteFor(description);
  const rng = makeRng(seedFromString(description));

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  if (pattern === "brick") {
    const bh = 32, bw = 64, mortar = 4;
    ctx.fillStyle = accent;
    for (let y = 0; y < size; y += bh) {
      const offset = ((y / bh) % 2) * (bw / 2);
      for (let x = -bw; x < size; x += bw) {
        ctx.fillRect(x + offset + mortar, y + mortar, bw - mortar * 2, bh - mortar * 2);
      }
    }
  } else if (pattern === "wood") {
    for (let y = 0; y < size; y += 1) {
      const shade = 0.5 + 0.5 * Math.sin(y * 0.15 + rng() * 0.4);
      ctx.fillStyle = `rgba(0,0,0,${0.08 * shade})`;
      ctx.fillRect(0, y, size, 1);
    }
    ctx.fillStyle = accent;
    for (let i = 0; i < 6; i++) ctx.fillRect(0, Math.floor(rng() * size), size, 2);
  } else if (pattern === "brushed") {
    for (let i = 0; i < 1200; i++) {
      const y = Math.floor(rng() * size);
      ctx.fillStyle = rng() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
      ctx.fillRect(0, y, size, 1);
    }
  } else if (pattern === "wave") {
    for (let y = 0; y < size; y++) {
      const a = 0.12 + 0.12 * Math.sin(y * 0.08);
      ctx.fillStyle = `rgba(255,255,255,${a * rng()})`;
      ctx.fillRect(0, y, size, 1);
    }
  } else if (pattern === "stars") {
    for (let i = 0; i < 220; i++) {
      const x = Math.floor(rng() * size), y = Math.floor(rng() * size);
      const r = rng() * 1.6;
      ctx.fillStyle = `rgba(255,255,255,${0.4 + rng() * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // noise
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rng() - 0.5) * 60;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
  }

  return canvasToPngBytes(canvas);
}

/** Encodes mono Float32 samples (-1..1) into a 16-bit PCM WAV byte array. */
function encodeWav(samples: Float32Array, sampleRate = 44100): Uint8Array {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

/** Synthesizes a short sound effect from the description. */
function generateSoundWav(description: string): Uint8Array {
  const d = description.toLowerCase();
  const sr = 44100;
  const rng = makeRng(seedFromString(description));
  const has = (...keys: string[]) => keys.some((k) => d.includes(k));

  let duration = 0.35;
  let kind: "laser" | "explosion" | "jump" | "coin" | "hit" | "beep" = "beep";
  if (has("laser", "shoot", "blast", "zap")) kind = "laser";
  else if (has("explos", "boom", "bomb")) { kind = "explosion"; duration = 0.6; }
  else if (has("jump", "hop", "bounce")) kind = "jump";
  else if (has("coin", "pickup", "collect", "powerup", "power-up")) { kind = "coin"; duration = 0.25; }
  else if (has("hit", "hurt", "damage", "punch")) { kind = "hit"; duration = 0.18; }

  const n = Math.floor(sr * duration);
  const out = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t * (kind === "explosion" ? 5 : 12));
    let sample = 0;

    switch (kind) {
      case "laser": {
        const freq = 1200 - 900 * (t / duration);
        sample = Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.4;
        break;
      }
      case "explosion": {
        sample = (rng() * 2 - 1) * 0.8;
        break;
      }
      case "jump": {
        const freq = 300 + 500 * (t / duration);
        sample = Math.sin(2 * Math.PI * freq * t) * 0.5;
        break;
      }
      case "coin": {
        const f1 = 988, f2 = 1319;
        const freq = t < duration * 0.4 ? f1 : f2;
        sample = Math.sin(2 * Math.PI * freq * t) * 0.4;
        break;
      }
      case "hit": {
        sample = ((rng() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * 140 * t) * 0.4);
        break;
      }
      default: {
        sample = Math.sin(2 * Math.PI * 440 * t) * 0.4;
      }
    }
    out[i] = sample * env;
  }

  return encodeWav(out, sr);
}

/**
 * Produces a real, usable asset and writes it into the WebContainer project.
 * Textures are procedurally rendered PNGs; sounds are synthesized WAVs. Models
 * return actionable guidance (primitive geometry) since meaningful 3D meshes
 * can't be generated procedurally in-browser.
 */
export async function generateAsset(assetType: AssetType, description: string): Promise<GeneratedAsset> {
  const slug = slugify(description);

  if (assetType === "texture") {
    const bytes = await generateTexturePng(description);
    const path = `assets/textures/${slug}.png`;
    await webContainerManager.writeBinaryFile(path, bytes);
    return {
      path,
      note: `Generated procedural texture at ${path} (256x256 PNG). Load it in code (e.g. new THREE.TextureLoader().load('/${path}') or as a CSS/Phaser image).`,
    };
  }

  if (assetType === "sound") {
    const bytes = generateSoundWav(description);
    const path = `assets/sounds/${slug}.wav`;
    await webContainerManager.writeBinaryFile(path, bytes);
    return {
      path,
      note: `Synthesized sound effect at ${path} (WAV). Play it with new Audio('/${path}') or your engine's audio loader.`,
    };
  }

  // model
  return {
    path: null,
    note:
      `3D models can't be generated procedurally in-browser. Build "${description}" from primitive geometry instead ` +
      `(e.g. THREE.BoxGeometry/SphereGeometry/CylinderGeometry composed into a Group), or install a small glTF via install_package.`,
  };
}
