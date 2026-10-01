import { describe, expect, it } from 'vitest';
import { resolveAvailableModels } from '../components/ChatPanel';

const catalog = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic', category: 'recommended' },
  { id: 'gpt-oss-120b', name: 'GPT OSS 120B', provider: 'cloudflare', category: 'fast' },
] as Parameters<typeof resolveAvailableModels>[0];

const identity = <T,>(x: T): T => x;

/**
 * B6: the model picker must reflect /api/models/status — disabled models are
 * filtered out, custom models carry their badge, and a stale saved selection
 * falls back instead of pointing at a model that no longer exists.
 */
describe('B6: resolveAvailableModels', () => {
  it('filters out admin-disabled models', () => {
    const { models } = resolveAvailableModels(
      catalog,
      { integratedModelsEnabled: true, disabledModels: ['anthropic:claude-sonnet-4-6'] },
      null, identity,
    );
    expect(models.map(m => m.id)).toEqual(['gpt-oss-120b']);
  });

  it('hides all built-ins when integrated models are switched off', () => {
    const { models } = resolveAvailableModels(
      catalog,
      { integratedModelsEnabled: false, disabledModels: [] },
      null, identity,
    );
    expect(models).toHaveLength(0);
  });

  it('badges custom admin models as Custom', () => {
    const { models } = resolveAvailableModels(
      catalog,
      { customModels: [{ id: 'cm-1', name: 'MiniMax', baseUrl: 'https://x', modelId: 'm2' }] },
      null, identity,
    );
    const custom = models.find(m => m.id === 'cm-1');
    expect(custom?.badge).toBe('Custom');
  });

  it('falls back when the saved selection was disabled', () => {
    const { selectedModelId } = resolveAvailableModels(
      catalog,
      { disabledModels: ['anthropic:claude-sonnet-4-6'] },
      'claude-sonnet-4-6', identity,
    );
    expect(selectedModelId).toBe('gpt-oss-120b');
  });

  it('keeps a saved selection that is still available', () => {
    const { selectedModelId } = resolveAvailableModels(
      catalog, {}, 'gpt-oss-120b', identity,
    );
    expect(selectedModelId).toBe('gpt-oss-120b');
  });
});

describe('friendlyModelName', () => {
  it('humanizes raw model ids without an explicit display entry', async () => {
    const { friendlyModelName } = await import('../components/ChatPanel');
    expect(friendlyModelName('@cf/some-org/new-model-xl')).toBe('New Model Xl');
    expect(friendlyModelName('plain-model-id')).toBe('Plain Model Id');
    expect(friendlyModelName('@cf/openai/gpt-oss-120b')).toBe('Gpt Oss 120b');
  });
});
