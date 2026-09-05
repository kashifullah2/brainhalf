import { getApiBaseUrl } from "./urls";

export { getApiBaseUrl, getWebUrl, PROD_API_URL, PROD_WEB_URL } from "./urls";

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base}${normalized}` : normalized;
}

// Game generation runs entirely through the streaming agentic loop in
// `agent-runner.ts` (POST /api/ai/chat). The legacy queue-based one-shot
// generator (/api/ai/generate + job polling) has been removed in favour of it.
