/** Maps a project file path to the URL path Vite serves in the preview iframe. */
export function vitePreviewUrlForFile(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized === "index.html") return "/";
  if (normalized.startsWith("public/")) {
    const rest = normalized.slice("public/".length);
    return rest === "index.html" ? "/" : `/${rest}`;
  }
  return `/${normalized}`;
}

/** Builds the full iframe src from the dev-server base URL and a preview path. */
export function buildPreviewSrc(baseUrl: string, previewPath: string): string {
  if (!previewPath || previewPath === "/") return baseUrl;
  const base = baseUrl.replace(/\/$/, "");
  return `${base}${previewPath.startsWith("/") ? previewPath : `/${previewPath}`}`;
}
