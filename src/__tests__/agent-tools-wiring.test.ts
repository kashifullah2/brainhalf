import { budgetRegistry } from './helpers/storage';
import { describe, expect, it, vi } from 'vitest';

const stream = vi.hoisted(() => vi.fn(() => ({ text: Promise.resolve('') })));

vi.mock('cloudflare:workers', () => ({
  tracing: { enterSpan: async (_name: string, fn: (span: { setAttribute: () => void }) => any) => fn({ setAttribute: () => {} }) },
}));
vi.mock('agents', () => ({ Agent: class Agent {} }));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: vi.fn(() => vi.fn(() => ({ provider: 'anthropic' }))) }));
vi.mock('@ai-sdk/amazon-bedrock', () => ({ createAmazonBedrock: vi.fn(() => vi.fn(() => ({ provider: 'aws' }))) }));
vi.mock('@ai-sdk/openai', () => ({ createOpenAI: vi.fn(() => ({ chat: vi.fn(() => ({ provider: 'atria' })) })) }));
vi.mock('ai', () => ({
  streamText: stream,
  tool: (definition: unknown) => definition,
  isStepCount: (count: number) => ({ count }),
}));

import { ChatAgent } from '../agent';
import { DEFAULT_RELIABILITY } from '../lib/generation-controls';

describe('Agent tool wiring', () => {
  it('passes defined tools and step policy into streamText', async () => {
    const agent: any = Object.create(ChatAgent.prototype);
    agent.runSql = vi.fn(() => []);
    agent.writeEpoch = { accepts: () => true };
    agent.broadcast = vi.fn();
    agent.extractAndSaveFiles = vi.fn();
    agent.saveTurn = vi.fn();
    agent.env = { REGISTRY: budgetRegistry(),
      REQUIRED_MODEL_PROVIDERS: 'aws',
      AWS_BEARER_TOKEN_BEDROCK: 'test-key',
    };

    agent.connectionUserIds = new Map([['conn-1', 'owner']]);
    agent.authCache = new Map();
    const connection = { id: 'conn-1', send: vi.fn() };
    await agent.runGeneration(connection, { model: 'claude-sonnet-6' }, 'system', 'Build app', 1);

    expect(stream).toHaveBeenCalledTimes(1);
    const options = (stream as any).mock.calls[0]?.[0] as Record<string, any>;
    expect(options).toBeTruthy();
    expect(options.toolChoice).toBe('auto');
    expect(options.stopWhen).toEqual({ count: DEFAULT_RELIABILITY.maxSteps + 1 });
    expect(options.tools.write_file.inputSchema).toBeDefined();
    expect(Object.keys(options.tools || {})).toEqual(expect.arrayContaining([
      'read_file',
      'write_file',
      'edit_file',
      'list_files',
      'check_syntax',
      'fetch_api',
      'call_cloudflare_model',
    ]));
  });
});
