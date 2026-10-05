// Client-side timeouts (ms)
export const PREVIEW_LOAD_TIMEOUT = 45_000;
export const PENDING_REQUEST_TIMEOUT = 60_000;
export const WS_SNAPSHOT_SYNC_TIMEOUT = 30_000;
export const WS_RECONNECT_BACKOFF_CAP = 30_000;
export const WS_MAX_RECONNECT_ATTEMPTS = 20;
// 150ms: fast enough to feel instant while still coalescing burst writes
// from the AI streaming multiple files at once. The old 800ms made every
// file update lag visibly behind the chat — this closes the gap to Lovable.
export const PREVIEW_SYNC_DEBOUNCE = 150;
export const COMPOSER_UNLOCK_DELAY = 300;
export const WORKSPACE_EXIT_TIMEOUT = 10_000;
export const WORKSPACE_EXIT_ATTEMPTS = 2;

// Server-side timeouts (ms) — used in agent.ts
export const AUTH_CACHE_TTL = 30_000;
export const BACKEND_READY_POSITIVE_TTL = 60_000;
export const BACKEND_READY_NEGATIVE_TTL = 5_000;
export const DISCONNECT_STOP_DELAY = 10_000;
