import { AI_TIMEOUT_MS, MAX_OUTPUT_TOKENS } from './models';

export interface ReliabilityControls {
  fastMode: boolean;
  maxTokens: number;
  maxSteps: number;
  timeoutMs: number;
}

export const DEFAULT_RELIABILITY: Readonly<ReliabilityControls> = {
  fastMode: true,
  // 64k matches the CF model's actual maximum and gives complex multi-file
  // apps the full token budget. The previous 32k cap truncated larger apps.
  maxTokens: 65536,
  maxSteps: 10,
  timeoutMs: AI_TIMEOUT_MS,
};

function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback;
}

export function normalizeReliabilityControls(input: unknown): ReliabilityControls {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    fastMode: typeof value.fastMode === 'boolean' ? value.fastMode : DEFAULT_RELIABILITY.fastMode,
    maxTokens: bounded(value.maxTokens, 300, MAX_OUTPUT_TOKENS, DEFAULT_RELIABILITY.maxTokens),
    maxSteps: bounded(value.maxSteps, 1, 20, DEFAULT_RELIABILITY.maxSteps),
    timeoutMs: bounded(value.timeoutMs, 15_000, AI_TIMEOUT_MS, DEFAULT_RELIABILITY.timeoutMs),
  };
}

export function generationControls(input: Record<string, unknown>): ReliabilityControls {
  return normalizeReliabilityControls({
    fastMode: input.fast_mode,
    maxTokens: input.max_tokens ?? input.max_completion_tokens,
    maxSteps: input.max_steps,
    timeoutMs: input.timeout_ms,
  });
}

export function generationContextLimits(fastMode: boolean) {
  return fastMode
    ? { sourceChars: 24_000, maxFiles: 20, historyTokens: 3_400 }
    : { sourceChars: 64_000, maxFiles: 40, historyTokens: 8_000 };
}
