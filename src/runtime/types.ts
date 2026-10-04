import { MAX_HOSTED_APP_SPACES } from '../lib/limits';

export type ProjectEnvironment = 'development' | 'production';
export type IntegrationProvider = 'resend' | 'google' | 'github';
export type JobKind = 'build' | 'preview' | 'verify' | 'deploy' | 'migrate' | 'publish';
export type JobStatus = 'queued' | 'running' | 'passed' | 'failed' | 'stopping' | 'stopped';
export type SourceFiles = Record<string, string>;
export interface ProjectScope { projectId: string; ownerId: string; unlimited?: boolean }
export interface SourceSnapshot { files: SourceFiles; revision: string }
export interface RuntimeJob {
  id: string; kind: JobKind; environment: ProjectEnvironment; revision: string;
  status: JobStatus; createdAt: number; updatedAt: number; leaseUntil: number;
  processIds: string[]; message: string; startedAt?: number; finishedAt?: number;
  releaseId?: string;
  previewReady?: boolean;
  publishStage?: 'build' | 'verify' | 'services' | 'deploy' | 'check' | 'live';
}
export interface RuntimeLog { id: number; jobId: string; at: number; level: 'info' | 'error'; text: string }
export interface DatabaseResource { id: string; name: string; createdAt: number }
export interface MigrationReceipt { name: string; checksum: string; appliedAt: number }
export interface ProjectRelease {
  id: string; revision: string; environment: ProjectEnvironment; scriptName: string;
  createdAt: number; databaseId: string; migrations: MigrationReceipt[]; artifactKey: string;
}
export interface IntegrationConfig {
  resend?: { apiKey: string; from: string; contactTo: string; webhookSecret?: string };
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
}
export interface IntegrationStatus {
  provider: IntegrationProvider; configured: boolean; updatedAt?: number;
  fields: Record<string, string>; callbackUrl?: string;
}
export interface VerificationCheck { name: string; passed: boolean; detail: string }
export interface VerificationReport {
  jobId: string; revision: string; environment: ProjectEnvironment; at: number;
  passed: boolean; checks: VerificationCheck[]; screenshotKey?: string;
}
export interface RuntimeAvailability {
  state: 'disabled' | 'pilot_only' | 'setup_required' | 'ready';
  message: string;
}
export type RuntimeUsageKind = 'jobs' | 'requests' | 'emails';
export interface RuntimeUsage {
  day: string;
  used: Record<RuntimeUsageKind, number>;
  limits: Record<RuntimeUsageKind, number>;
  storageBytes: number;
  storageLimitBytes: number;
}
export interface ProjectUpload {
  id: string; name: string; contentType: string; size: number; createdAt: number; url: string;
}
/** BrainHalf pilot policy, not Cloudflare platform limits or monetary billing. */
export const OWNER_RUNTIME_LIMITS = { jobs: 30, requests: 25_000, emails: 50, storageBytes: 104_857_600 } as const;
export interface RuntimeStatus {
  enabled: boolean; projectId: string; environment: ProjectEnvironment;
  availability?: RuntimeAvailability;
  usage?: RuntimeUsage;
  capabilities: { sandbox: boolean; database: boolean; deployment: boolean; browser: boolean; secrets: boolean };
  database: DatabaseResource | null; migrations: MigrationReceipt[];
  jobs: RuntimeJob[]; releases: ProjectRelease[]; activeRelease: ProjectRelease | null;
  verification: VerificationReport | null; integrations: IntegrationStatus[];
  previewUrl: string; productionUrl: string;
}
export const PILOT_LIMITS = {
  projects: MAX_HOSTED_APP_SPACES, sandboxes: 2, browsers: 1, commandTimeoutMs: 600_000,
  idleTimeoutMs: 300_000, leaseMs: 45_000, sourceBytes: 4_000_000,
  sourceFiles: 500, logBytes: 64_000, artifactBytes: 12_000_000,
  dailyJobs: 30, dailyEmails: 20,
  uploadBytes: 5_242_880, uploadFiles: 100, parallelUploads: 2,
} as const;

export class RuntimeError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'RuntimeError'; }
}
export function environmentFrom(value: unknown): ProjectEnvironment {
  if (value !== 'development' && value !== 'production') throw new RuntimeError('Choose development or production.');
  return value;
}
export function assertScope(scope: ProjectScope): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(scope.projectId) || !scope.ownerId || scope.ownerId.length > 128) throw new RuntimeError('Invalid project scope.');
}
export function runtimeHost(projectId: string, environment: ProjectEnvironment, domain: string): string {
  // UUID project IDs remain recognizable; overlong legacy IDs use a stable host alias at the control boundary.
  if (!/^[a-z0-9-]{1,58}$/.test(projectId)) throw new RuntimeError('This legacy project ID needs a hostname alias before deployment.');
  return `${environment === 'development' ? 'dev-' : ''}${projectId}.${domain}`;
}
