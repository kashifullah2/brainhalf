import { projectManifest } from './source';
import { RuntimeError, type SourceFiles } from './types';
import type { ManagedSettings, ProviderReadiness } from './managed-types';

/** Fail closed instead of publishing only the frontend of an unsupported server. */
export function publicationTarget(files: SourceFiles): 'workers' | 'static' {
  const normalized = Object.fromEntries(Object.entries(files).map(([path, value]) => [path.replace(/^\//, ''), value]));
  const manifest = projectManifest(normalized);
  if (manifest.brainhalf?.runtime === 'workers') return 'workers';
  const backend = Object.keys(normalized).some(path => /^(?:src\/)?(?:server|backend|worker|api|functions)(?:\/|\.(?:[cm]?[jt]s|py)$)|^(?:src\/)?app\/.*\/(?:route|actions)\.[jt]s$|^(?:src\/)?pages\/api\/|^(?:manage\.py|requirements\.txt|go\.mod|Cargo\.toml|Gemfile)$/.test(path));
  const pkg = JSON.parse(normalized['package.json'] || '{}');
  const serverDependencies = ['express', 'fastify', 'koa', 'hono', 'next', 'nuxt', '@nestjs/core', '@hapi/hapi', 'restify', 'sails', 'elysia', '@sveltejs/kit', '@remix-run/node', '@remix-run/serve'];
  const serverScript = Object.entries(manifest.scripts).some(([name, command]) => /^(?:start|server|dev)(?::|$)/.test(name) && typeof command === 'string' && /(?:^|[\s;&|])(?:node|tsx|ts-node|nodemon|bun|deno|python3?|uvicorn|gunicorn|flask|django-admin|php|go|rails)(?:\s|$)/.test(command));
  if (backend || manifest.scripts.server || serverScript || serverDependencies.some(name => pkg.dependencies?.[name] || pkg.devDependencies?.[name]) || (manifest.brainhalf?.runtime && manifest.brainhalf.runtime !== 'static')) {
    throw new RuntimeError('This backend needs a Workers deployment entry before it can be published. Prepare the backend for managed hosting; publishing only its frontend would leave the app incomplete.', 422);
  }
  return 'static';
}

export function assertProductionServices(settings: ManagedSettings, readiness: ProviderReadiness): void {
  if ((settings.emailEnabled || settings.passwordEnabled || settings.magicLinkEnabled || settings.welcomeEnabled) && (!readiness.ownerVerified || !readiness.emailReady)) {
    throw new RuntimeError('Production email is not ready. Verify your BrainHalf account email and configure email in Authentication & email before publishing. Password signup and recovery also require email.', 409);
  }
  if (settings.googleEnabled && !readiness.googleReady) throw new RuntimeError('Google sign-in is enabled but its production connection is not ready. Configure it in Authentication & email before publishing.', 409);
}

/** A custom endpoint is allowed, but production checks must remain read-only and same-origin. */
export function productionHealthPath(files: SourceFiles): string {
  const pkg = JSON.parse(files['package.json'] || '{}');
  const path = pkg.brainhalf?.healthPath ?? '/api/health';
  if (typeof path !== 'string' || !/^\/api\/[a-zA-Z0-9/_-]+$/.test(path) || /^\/api\/(?:auth|contact|storage)(?:\/|$)/.test(path)) {
    throw new RuntimeError('Set brainhalf.healthPath to a read-only backend health endpoint under /api/.');
  }
  return path;
}
