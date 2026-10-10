import { describe, it, expect, vi } from 'vitest';
import { upsertProjectVector, deleteProjectVector, searchProjects } from '../lib/vectorize';

const FAKE_EMBEDDING = Array.from({ length: 768 }, (_, i) => i / 768);

function makeAI(embedding = FAKE_EMBEDDING) {
  return { run: vi.fn(async () => ({ data: [embedding] })) };
}

function makeVectorize() {
  return {
    upsert: vi.fn(async () => ({ count: 1 })),
    deleteByIds: vi.fn(async () => ({ count: 1 })),
    query: vi.fn(async () => ({ matches: [{ id: 'proj-a', score: 0.9 }, { id: 'proj-b', score: 0.7 }] })),
  };
}

describe('upsertProjectVector', () => {
  it('calls AI with name + description joined, then upserts to Vectorize', async () => {
    const ai = makeAI();
    const vectorize = makeVectorize();
    await upsertProjectVector({ AI: ai as any, VECTORIZE: vectorize as any }, 'proj-1', 'Todo App', 'A simple task manager');
    expect(ai.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', { text: ['Todo App — A simple task manager'] });
    expect(vectorize.upsert).toHaveBeenCalledWith([{ id: 'proj-1', values: FAKE_EMBEDDING }]);
  });

  it('uses projectId as fallback text when name and description are empty', async () => {
    const ai = makeAI();
    const vectorize = makeVectorize();
    await upsertProjectVector({ AI: ai as any, VECTORIZE: vectorize as any }, 'proj-1', '', '');
    expect(ai.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', { text: ['proj-1'] });
  });

  it('is a no-op when VECTORIZE binding is absent', async () => {
    const ai = makeAI();
    await upsertProjectVector({ AI: ai as any }, 'proj-1', 'App', 'Desc');
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('is a no-op when AI binding is absent', async () => {
    const vectorize = makeVectorize();
    await upsertProjectVector({ VECTORIZE: vectorize as any }, 'proj-1', 'App', 'Desc');
    expect(vectorize.upsert).not.toHaveBeenCalled();
  });

  it('swallows errors silently', async () => {
    const ai = { run: vi.fn(async () => { throw new Error('AI unavailable'); }) };
    const vectorize = makeVectorize();
    await expect(upsertProjectVector({ AI: ai as any, VECTORIZE: vectorize as any }, 'proj-1', 'App', '')).resolves.toBeUndefined();
    expect(vectorize.upsert).not.toHaveBeenCalled();
  });

  it('does not upsert when AI returns empty embedding', async () => {
    const ai = { run: vi.fn(async () => ({ data: [[]] })) };
    const vectorize = makeVectorize();
    await upsertProjectVector({ AI: ai as any, VECTORIZE: vectorize as any }, 'proj-1', 'App', '');
    expect(vectorize.upsert).not.toHaveBeenCalled();
  });
});

describe('deleteProjectVector', () => {
  it('calls deleteByIds with the project ID', async () => {
    const vectorize = makeVectorize();
    await deleteProjectVector({ VECTORIZE: vectorize as any }, 'proj-del');
    expect(vectorize.deleteByIds).toHaveBeenCalledWith(['proj-del']);
  });

  it('is a no-op when VECTORIZE binding is absent', async () => {
    await expect(deleteProjectVector({}, 'proj-1')).resolves.toBeUndefined();
  });

  it('swallows errors silently', async () => {
    const vectorize = { deleteByIds: vi.fn(async () => { throw new Error('Vectorize down'); }) };
    await expect(deleteProjectVector({ VECTORIZE: vectorize as any }, 'proj-1')).resolves.toBeUndefined();
  });
});

describe('searchProjects', () => {
  it('returns project IDs ordered by similarity score', async () => {
    const ai = makeAI();
    const vectorize = makeVectorize();
    const ids = await searchProjects({ AI: ai as any, VECTORIZE: vectorize as any }, 'todo app');
    expect(ids).toEqual(['proj-a', 'proj-b']);
    expect(ai.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', { text: ['todo app'] });
    expect(vectorize.query).toHaveBeenCalledWith(FAKE_EMBEDDING, { topK: 20, returnMetadata: false });
  });

  it('returns [] when VECTORIZE binding is absent', async () => {
    const ai = makeAI();
    expect(await searchProjects({ AI: ai as any }, 'query')).toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('returns [] when AI binding is absent', async () => {
    const vectorize = makeVectorize();
    expect(await searchProjects({ VECTORIZE: vectorize as any }, 'query')).toEqual([]);
    expect(vectorize.query).not.toHaveBeenCalled();
  });

  it('swallows errors and returns []', async () => {
    const ai = { run: vi.fn(async () => { throw new Error('AI unavailable'); }) };
    const vectorize = makeVectorize();
    expect(await searchProjects({ AI: ai as any, VECTORIZE: vectorize as any }, 'query')).toEqual([]);
  });

  it('truncates long queries to 200 chars', async () => {
    const ai = makeAI();
    const vectorize = makeVectorize();
    const longQuery = 'a'.repeat(300);
    await searchProjects({ AI: ai as any, VECTORIZE: vectorize as any }, longQuery);
    expect(ai.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', { text: ['a'.repeat(200)] });
  });

  it('passes topK override to Vectorize query', async () => {
    const ai = makeAI();
    const vectorize = makeVectorize();
    await searchProjects({ AI: ai as any, VECTORIZE: vectorize as any }, 'query', 5);
    expect(vectorize.query).toHaveBeenCalledWith(FAKE_EMBEDDING, { topK: 5, returnMetadata: false });
  });
});
