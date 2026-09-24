/** Snapshot of an in-flight generation, shared only within its authorized project. */
export interface GenerationSession {
  id: string;
  model: string;
  prompt: string;
  response: string;
  startedAt: number;
  filesChanged: boolean;
  truncated: boolean;
}

// Keep reconnection frames bounded even for long, multi-step responses.
export const MAX_GENERATION_RESUME_CHARS = 128_000;
