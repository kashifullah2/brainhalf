import type { Ai, VectorizeIndex } from '@cloudflare/workers-types';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

export interface VectorizeEnv {
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
}

/** Embed and upsert a project into the Vectorize index. No-op when bindings are absent. */
export async function upsertProjectVector(
  env: VectorizeEnv,
  projectId: string,
  name: string,
  description: string
): Promise<void> {
  if (!env.VECTORIZE || !env.AI) return;
  try {
    const text = [name.trim(), description.trim()].filter(Boolean).join(' — ').slice(0, 500) || projectId;
    const result = await env.AI.run(EMBED_MODEL, { text: [text] }) as { data: number[][] };
    const embedding = result.data?.[0];
    if (!embedding?.length) return;
    await env.VECTORIZE.upsert([{ id: projectId, values: embedding }]);
  } catch { /* non-critical — index stays stale */ }
}

/** Remove a project from the Vectorize index. No-op when binding is absent. */
export async function deleteProjectVector(
  env: Pick<VectorizeEnv, 'VECTORIZE'>,
  projectId: string
): Promise<void> {
  if (!env.VECTORIZE) return;
  try {
    await env.VECTORIZE.deleteByIds([projectId]);
  } catch { /* non-critical */ }
}

/**
 * Semantic search over showcased projects.
 * Returns project IDs ordered by cosine similarity. Returns [] when bindings are absent.
 */
export async function searchProjects(
  env: VectorizeEnv,
  query: string,
  topK = 20
): Promise<string[]> {
  if (!env.VECTORIZE || !env.AI) return [];
  try {
    const result = await env.AI.run(EMBED_MODEL, { text: [query.slice(0, 200)] }) as { data: number[][] };
    const embedding = result.data?.[0];
    if (!embedding?.length) return [];
    const matches = await env.VECTORIZE.query(embedding, { topK, returnMetadata: false });
    return matches.matches.map((m: { id: string }) => m.id);
  } catch {
    return [];
  }
}
