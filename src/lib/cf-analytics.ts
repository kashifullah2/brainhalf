/**
 * Cloudflare Analytics Engine helper.
 *
 * Writes structured data points to the `brainhalf_events` dataset so
 * generation performance, model health, and auth activity can be queried
 * via Cloudflare's SQL API or GraphQL explorer.
 *
 * Schema (fixed by Cloudflare AE slot positions):
 *   blobs[0]  event type        e.g. 'generation', 'auth'
 *   blobs[1]  model id          e.g. '@cf/deepseek-ai/deepseek-v4-flash-0731'
 *   blobs[2]  status            'completed' | 'failed' | 'stopped' | 'ok'
 *   blobs[3]  prompt_category   'build' | 'edit' | 'question' | ...
 *   blobs[4]  repair_types      comma-separated e.g. 'truncation,syntax' or ''
 *   blobs[5]  auth_method       'email' | 'google' | '' for non-auth events
 *
 *   doubles[0] ttft_ms          time to first token (ms), -1 if unknown
 *   doubles[1] total_ms         wall-clock generation time (ms)
 *   doubles[2] input_tokens     prompt tokens consumed
 *   doubles[3] output_tokens    completion tokens produced
 *   doubles[4] files_written    number of files extracted
 *   doubles[5] repair_count     total repair turns (truncation+syntax+completeness)
 *   doubles[6] provider_calls   total upstream AI calls
 *
 *   indexes[0] user_id          for per-user filtering in AE SQL queries
 */

export interface AnalyticsDataset {
  writeDataPoint(event: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface GenerationEvent {
  userId: string;
  modelId: string;
  status: 'completed' | 'failed' | 'stopped';
  promptCategory: string;
  repairTypes: string[];
  ttftMs: number;
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  filesWritten: number;
  repairCount: number;
  providerCalls: number;
}

export interface AuthEvent {
  userId: string;
  method: 'email' | 'google';
  status: 'ok' | 'failed';
}

export function writeGenerationEvent(dataset: AnalyticsDataset | undefined | null, event: GenerationEvent): void {
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      blobs: [
        'generation',
        event.modelId,
        event.status,
        event.promptCategory,
        event.repairTypes.join(','),
        '',
      ],
      doubles: [
        event.ttftMs,
        event.totalMs,
        event.inputTokens,
        event.outputTokens,
        event.filesWritten,
        event.repairCount,
        event.providerCalls,
      ],
      indexes: [event.userId],
    });
  } catch { /* Analytics is best-effort — never break generation */ }
}

export function writeAuthEvent(dataset: AnalyticsDataset | undefined | null, event: AuthEvent): void {
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      blobs: ['auth', '', event.status, '', '', event.method],
      doubles: [0, 0, 0, 0, 0, 0, 0],
      indexes: [event.userId],
    });
  } catch { /* best-effort */ }
}
