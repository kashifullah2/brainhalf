/// <reference types="vite/client" />
declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    protected env: Env;
    protected ctx: import('@cloudflare/workers-types').DurableObjectState;
    constructor(ctx: import('@cloudflare/workers-types').DurableObjectState, env: Env);
  }
  export interface TracingSpan {
    setAttribute(name: string, value: string | number | boolean): void;
    addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
    recordException(error: unknown): void;
  }
  export const tracing: {
    enterSpan<T>(name: string, fn: (span: TracingSpan) => T | Promise<T>): Promise<T>;
  };
  export class WorkerEntrypoint<Env = unknown> {
    protected env: Env;
    protected ctx: ExecutionContext;
    constructor(ctx: ExecutionContext, env: Env);
  }
}
