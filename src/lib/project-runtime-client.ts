import { useCallback, useEffect, useState } from 'react';
import { authFetch } from './auth-client';
import { appEvents } from './events';
import { getProjectStorageScope, updateProjectDeployment } from './project-store';
import type { RuntimeStatus, ProjectEnvironment } from '../runtime/types';

const STATUS_RETRY_FALLBACK_MS = 15_000;
const STATUS_ERROR_RETRY_MIN_MS = 5_000;
const STATUS_ERROR_RETRY_MAX_MS = 120_000;

const statusCooldownUntil = new Map<string, number>();
const inflightStatusRequests = new Map<string, Promise<unknown>>();

// A caller can stop waiting without cancelling a status fetch shared by other panels.
function waitForStatus<T>(request: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return request;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class RuntimeRequestError extends Error {
  status: number;
  retryAfterMs: number | null;

  constructor(message: string, status: number, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'RuntimeRequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.max(0, Math.ceil(numeric * 1000));
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, timestamp - now);
}

function statusRequestKey(projectId: string, environment: ProjectEnvironment): string {
  const scope = getProjectStorageScope();
  return `${scope.accountId || 'anon'}:${projectId}:${environment}`;
}

function computeRetryDelay(cause: unknown, attempts: number): number {
  const exponential = Math.min(
    STATUS_ERROR_RETRY_MAX_MS,
    STATUS_ERROR_RETRY_MIN_MS * 2 ** Math.max(0, Math.min(attempts - 1, 6))
  );

  if (cause instanceof RuntimeRequestError) {
    if (cause.status === 429) {
      return Math.max(cause.retryAfterMs ?? STATUS_RETRY_FALLBACK_MS, exponential);
    }
    if (cause.status >= 500) {
      return Math.max(10_000, exponential);
    }
    if (cause.status === 401 || cause.status === 403) {
      return Math.max(30_000, exponential);
    }
    return Math.max(15_000, Math.min(60_000, exponential));
  }

  return Math.max(STATUS_ERROR_RETRY_MIN_MS, Math.min(60_000, exponential));
}

function withJitter(delayMs: number): number {
  const jitter = Math.round(delayMs * 0.15 * Math.random());
  return delayMs + jitter;
}

export function runtimeBase(projectId: string): string {
  const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const origin = local ? (import.meta.env.VITE_BACKEND_HOST || '') : '';
  return `${origin}/api/projects/${encodeURIComponent(projectId)}/runtime`;
}

export interface HostedSlot { alias: string; projectId: string }

/** Lists this account's hosted-slot registrations, including orphans whose
 *  projects no longer exist. Routed through any project the account owns. */
export async function listHostedSlots(projectId: string): Promise<HostedSlot[]> {
  const result = await runtimeRequest<{ hosted: HostedSlot[] }>(projectId, '/hosted', 'development', { signal: AbortSignal.timeout(10_000) });
  return Array.isArray(result.hosted) ? result.hosted : [];
}

/** Releases a hosted slot. Accounting only — live projects re-register on their next job. */
export async function releaseHostedSlot(projectId: string, alias: string): Promise<void> {
  await runtimeRequest(projectId, '/hosted/release', 'development', {
    method: 'POST', body: JSON.stringify({ alias }), signal: AbortSignal.timeout(10_000),
  });
}

export async function runtimeRequest<T>(
  projectId: string,
  path: string,
  environment: ProjectEnvironment,
  init: RequestInit = {}
): Promise<T> {
  init.signal?.throwIfAborted();
  const method = (init.method || 'GET').toUpperCase();
  const isStatusRequest = method === 'GET' && path.split('?')[0] === '/status';
  const requestKey = statusRequestKey(projectId, environment);
  const now = Date.now();

  if (isStatusRequest) {
    const cooldownUntil = statusCooldownUntil.get(requestKey) || 0;
    if (cooldownUntil > now) {
      throw new RuntimeRequestError(
        'Runtime is rate limited. Waiting before the next status check.',
        429,
        cooldownUntil - now
      );
    }
    const inflight = inflightStatusRequests.get(requestKey) as Promise<T> | undefined;
    if (inflight) return waitForStatus(inflight, init.signal);
  }

  const execute = async (): Promise<T> => {
    const response = await authFetch(
      `${runtimeBase(projectId)}${path}${path.includes('?') ? '&' : '?'}environment=${environment}`,
      { ...init, ...(isStatusRequest ? { signal: AbortSignal.timeout(15_000) } : {}), headers: { 'Content-Type': 'application/json', ...init.headers } }
    );

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
      if (isStatusRequest && response.status === 429) {
        statusCooldownUntil.set(
          requestKey,
          Date.now() + Math.max(retryAfterMs ?? STATUS_RETRY_FALLBACK_MS, STATUS_RETRY_FALLBACK_MS)
        );
      }
      throw new RuntimeRequestError(
        body?.error || 'The project runtime could not complete this request.',
        response.status,
        retryAfterMs
      );
    }

    if (isStatusRequest) statusCooldownUntil.delete(requestKey);
    return body as T;
  };

  if (!isStatusRequest) return execute();

  const request = execute().finally(() => {
    inflightStatusRequests.delete(requestKey);
  });
  inflightStatusRequests.set(requestKey, request as Promise<unknown>);
  return waitForStatus(request, init.signal);
}

export function useProjectRuntime(projectId: string, environment: ProjectEnvironment, waitForSession = false) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [error, setError] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [readyProject, setReadyProject] = useState('');

  useEffect(() => {
    setReadyProject('');
    return appEvents.on('workspace-session-ready', event => {
      if (event.projectId === projectId) setReadyProject(projectId);
    });
  }, [projectId]);

  const enabled = !waitForSession || readyProject === projectId;
  const refresh = useCallback(() => setRefreshVersion(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failedAttempts = 0;

    setStatus(null);
    setError('');
    if (!enabled) return () => controller.abort();

    const update = async () => {
      try {
        const scope = getProjectStorageScope();
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
        const data = await runtimeRequest<RuntimeStatus>(projectId, '/status', environment, { signal });

        if (controller.signal.aborted || scope !== getProjectStorageScope()) return;

        setStatus(data);
        setError('');

        if (environment === 'production' && data.availability?.state === 'ready') {
          updateProjectDeployment(projectId, !!data.activeRelease);
        }

        const running = data.jobs.some(job => ['queued', 'running', 'stopping'].includes(job.status));

        // Publication is a durable server job and can finish after the workspace closes.
        appEvents.emit('runtime-status', {
          projectId,
          running: data.jobs.some(job => job.kind !== 'publish' && ['queued', 'running', 'stopping'].includes(job.status)),
        });

        if (running) {
          await runtimeRequest(projectId, '/heartbeat', environment, {
            method: 'POST',
            body: '{}',
            signal,
          });
        }

        failedAttempts = 0;
        if (!controller.signal.aborted) timer = setTimeout(update, running ? 10_000 : 30_000);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Runtime unavailable.');
          failedAttempts += 1;
          // Transient failures should not abandon the runtime lease, but must
          // respect server rate limiting and avoid a retry storm.
          timer = setTimeout(update, withJitter(computeRetryDelay(cause, failedAttempts)));
        }
      }
    };

    void update();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [projectId, environment, refreshVersion, enabled]);

  useEffect(() => {
    const onPageHide = () => {
      const job = status?.jobs.find(job => job.kind !== 'publish' && ['queued', 'running', 'stopping'].includes(job.status));
      if (job) {
        void authFetch(`${runtimeBase(projectId)}/stop`, {
          method: 'POST',
          body: JSON.stringify({ expectedJobId: job.id }),
          keepalive: true,
        }).catch(() => {});
      }
    };

    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [projectId, status]);

  return { status, error, refresh };
}
