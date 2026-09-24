/// <reference types="vite/client" />
declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    protected env: Env;
    protected ctx: import('@cloudflare/workers-types').DurableObjectState;
    constructor(ctx: import('@cloudflare/workers-types').DurableObjectState, env: Env);
  }
  export const tracing: any;
  export class WorkerEntrypoint<Env = unknown> {
    protected env: Env;
    protected ctx: ExecutionContext;
    constructor(ctx: ExecutionContext, env: Env);
  }
}
