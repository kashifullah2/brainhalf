/**
 * Structural Cloudflare bindings typed against DOM fetch types. The
 * @cloudflare/workers-types Request/Response flavors drift from the DOM lib
 * this project compiles with, so bindings are declared structurally at the
 * exact surface the platform uses.
 */
export interface BindingFetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface DurableBinding {
  idFromName(name: string): unknown;
  get(id: unknown): BindingFetcher;
}

export interface DispatchBinding {
  get(name: string): BindingFetcher;
}
