import { useStudioStore } from "@stores/studio-store";
import { webContainerManager } from "./webcontainer";
import { ensureNpmImportsFromSource } from "./ensure-npm-imports";
import { buildPreviewSrc, vitePreviewUrlForFile } from "./preview-urls";

export { buildPreviewSrc, vitePreviewUrlForFile };

function prepareRootIndexFromPublic(publicIndexHtml: string): string {
  return publicIndexHtml
    .replace(/<script[^>]*src=["'][^"']*game\.js[^"']*["'][^>]*>\s*<\/script>/gi, "")
    .replace(/\.\.\/src\//g, "src/")
    .replace(/href=["']\.\.\/([^"']+)["']/g, 'href="$1"');
}

/**
 * Keeps the live preview in sync after files are written.
 * Vite/static server has no HMR — the iframe must reload to pick up JS/CSS changes.
 */
export async function syncPreviewAfterFileWrite(filePath: string, content?: string): Promise<void> {
  const normalized = filePath.replace(/\\/g, "/");

  if (normalized.endsWith(".html")) {
    await syncPreviewAfterHtmlWrite(normalized, content ?? "");
    return;
  }

  if (normalized === "package.json") {
    await webContainerManager.ensureDependenciesInstalled();
  }

  if (/^src\/.*\.(js|ts|jsx|tsx)$/.test(normalized) && content) {
    await ensureNpmImportsFromSource(content);
  }

  const store = useStudioStore.getState();
  const affectsPreview =
    /^src\/.*\.(js|ts|jsx|tsx|css)$/.test(normalized) ||
    normalized.startsWith("assets/") ||
    normalized.startsWith("public/") ||
    normalized === "package.json" ||
    normalized === "vite.config.js" ||
    normalized === "vite.config.ts";

  if (affectsPreview) {
    store.setPreviewPath("/");
    store.bumpPreviewReload();
  }
}

/**
 * Keeps the live preview in sync after HTML files are written.
 * Vite serves root index.html at `/`; files under public/ are served at `/filename`.
 */
export async function syncPreviewAfterHtmlWrite(filePath: string, content: string): Promise<void> {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.endsWith(".html")) return;

  const store = useStudioStore.getState();

  if (normalized === "public/index.html") {
    const rootContent = prepareRootIndexFromPublic(content);
    await webContainerManager.writeFiles({ "index.html": rootContent });
    store.setPreviewPath("/");
    store.bumpPreviewReload();
    return;
  }

  if (normalized === "index.html") {
    store.setPreviewPath("/");
    store.bumpPreviewReload();
    return;
  }

  store.setPreviewPath(vitePreviewUrlForFile(normalized));
  store.bumpPreviewReload();
}
