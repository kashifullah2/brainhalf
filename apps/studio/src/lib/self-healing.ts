/**
 * Self-healing orchestration helpers.
 *
 * Collects errors from every available source (preview runtime, Vite dev-server
 * stdio, and an optional active `vite build` check), normalizes them, and builds
 * the repair prompt fed back to the model. The retry loop itself lives in
 * `agent-runner.ts`; this module is the error-collection + config layer.
 */
import { webContainerManager } from "./webcontainer";
import {
  normalizeErrors,
  formatErrorsForPrompt,
  type NormalizedError,
} from "./error-normalizer";

export interface RepairConfig {
  /** Maximum self-healing repair attempts before giving up. */
  maxAttempts: number;
  /** Run an active `vite build` when no passive errors are found. */
  runBuildCheck: boolean;
  /** How long to let HMR/preview settle before collecting errors (ms). */
  settleMs: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_SETTLE_MS = 2500;

function readIntEnv(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Resolves repair configuration from Vite env vars, with safe defaults. */
export function getRepairConfig(): RepairConfig {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  const maxAttempts = readIntEnv(env.VITE_MAX_REPAIR_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
  const runBuildCheck = env.VITE_AGENT_BUILD_CHECK !== "false";
  const settleMs = readIntEnv(env.VITE_REPAIR_SETTLE_MS, DEFAULT_SETTLE_MS);
  return { maxAttempts, runBuildCheck, settleMs };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Collects and normalizes errors from all sources.
 *
 * Strategy: wait for the preview to settle, then drain passive errors
 * (runtime + dev-server). If there are none and an active build check is
 * enabled, run `vite build` to surface build/import/TS failures that never
 * reached the iframe.
 */
export async function collectErrors(cfg: RepairConfig): Promise<NormalizedError[]> {
  await delay(cfg.settleMs);

  const passive = normalizeErrors([
    ...webContainerManager.consumePreviewErrors(),
    ...webContainerManager.consumeBuildErrors(),
  ]);
  if (passive.length > 0) return passive;

  if (!cfg.runBuildCheck) return [];

  const { code, output } = await webContainerManager.verifyBuild();
  if (code !== 0 && output.trim()) {
    return normalizeErrors([{ text: output, hint: "build" }]);
  }
  return [];
}

/** Builds the repair instruction injected back into the conversation. */
export function buildRepairPrompt(errors: NormalizedError[]): string {
  const summary = formatErrorsForPrompt(errors);
  const details = errors
    .map((e) => e.raw)
    .filter(Boolean)
    .join("\n---\n")
    .slice(0, 3000);

  return (
    `The live preview / build reported the following error(s) after your last changes. ` +
    `Diagnose the root cause, read the relevant file(s) if needed, fix them with create_file, then stop. ` +
    `Do not explain at length — just fix:\n\n` +
    `${summary}\n\n` +
    `Raw output:\n${details}`
  );
}
