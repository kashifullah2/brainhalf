export type BrainhalfPublicEnv = {
  API_URL?: string;
  STUDIO_URL?: string;
};

/** Server-side (Remix loaders): use worker URL in production, same-origin in dev */
export function getServerApiUrl(request: Request, env?: BrainhalfPublicEnv): string {
  const configured = env?.API_URL?.trim().replace(/\/$/, '');
  if (configured) return configured;
  return new URL(request.url).origin;
}

export function apiPath(base: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

declare global {
  interface Window {
    __BRAINHALF_API_URL?: string;
  }
}

/** Client-side: empty string = same-origin (dev proxy) */
export function getClientApiBase(): string {
  if (typeof window !== 'undefined' && window.__BRAINHALF_API_URL) {
    return window.__BRAINHALF_API_URL.replace(/\/$/, '');
  }
  return '';
}

export function clientApi(path: string): string {
  return apiPath(getClientApiBase(), path);
}

export function cloudflareEnv(context: { cloudflare?: unknown }): BrainhalfPublicEnv | undefined {
  return (context.cloudflare as { env?: BrainhalfPublicEnv } | undefined)?.env;
}
