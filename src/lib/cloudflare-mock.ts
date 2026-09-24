/**
 * Cloudflare Workers builtin module mock for Vite/Vitest environments.
 */
export const tracing = {
  enterSpan: async (_name: string, fn: (span: any) => Promise<any> | any) => {
    return fn({
      setAttribute: () => {},
      addEvent: () => {},
      recordException: () => {},
    });
  },
};
export class WorkerEntrypoint<Env = unknown> {
  constructor(protected ctx: unknown, protected env: Env) {}
}
