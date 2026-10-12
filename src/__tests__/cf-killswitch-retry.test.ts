import { describe, expect, it, vi, afterEach } from 'vitest';
import { ChatAgent } from '../agent';

vi.mock('cloudflare:workers', () => ({ tracing: { enterSpan: async (_name: string, callback: any) => callback({ setAttribute: () => {} }) } }));
vi.mock('agents', () => ({ Agent: class {} }));

describe('CF Workers AI kill-switch mid-retry', () => {
  const controllers: AbortController[] = [];
  afterEach(() => { for (const c of controllers) c.abort(); controllers.length = 0; });

  it('aborts the token-ladder loop when onKillSwitch fires, before exhausting all attempts', async () => {
    const abortController = new AbortController();
    controllers.push(abortController);

    const aiRunCalls: number[] = [];
    const agent: any = Object.create(ChatAgent.prototype);
    agent.env = {
      AI: {
        run: vi.fn((_model: string, input: Record<string, any>) => {
          aiRunCalls.push(input.max_tokens ?? input.max_completion_tokens);
          throw new Error('max_tokens limit exceeded for this model');
        }),
      },
    };
    agent.activeAccounting = { providerCalls: 0, firstResponseAt: null };
    agent.activeGeneration = { id: 'gen-1' };
    agent.writeEpoch = { accepts: () => true };
    agent.currentAbortController = abortController;
    agent.erasing = false;
    agent.broadcast = vi.fn();
    agent.rememberGenerationText = vi.fn();

    const sentMessages: string[] = [];
    const connection: any = {
      send: (msg: string) => sentMessages.push(msg),
      id: 'conn-1',
    };

    let callCount = 0;
    const onKillSwitch = vi.fn(async () => {
      callCount++;
      if (callCount >= 2) return 'Model "test" is currently turned off by the administrator.';
      return null;
    });

    const result = await agent.runCloudflareWorkersAI(
      '@cf/deepseek-ai/deepseek-v4-flash-0731',
      'You are a helpful assistant.',
      [{ role: 'user' as const, content: 'Hello' }],
      connection,
      'Hello',
      undefined,
      0,
      true,
      {},
      [],
      new Set<string>(),
      (fn: () => void) => fn(),
      6,
      true,
      onKillSwitch,
    );

    expect(result).toEqual({ ok: false, repairMarker: null });
    expect(onKillSwitch).toHaveBeenCalledTimes(2);
    expect(aiRunCalls.length).toBe(1);
  });

  it('does not call onKillSwitch when the callback is not provided', async () => {
    const abortController = new AbortController();
    controllers.push(abortController);

    const aiRunCalls: number[] = [];
    const agent: any = Object.create(ChatAgent.prototype);
    agent.env = {
      AI: {
        run: vi.fn((_model: string, input: Record<string, any>) => {
          aiRunCalls.push(input.max_tokens ?? input.max_completion_tokens);
          throw new Error('max_tokens limit exceeded for this model');
        }),
      },
    };
    agent.activeAccounting = { providerCalls: 0, firstResponseAt: null };
    agent.activeGeneration = { id: 'gen-1' };
    agent.writeEpoch = { accepts: () => true };
    agent.currentAbortController = abortController;
    agent.erasing = false;
    agent.broadcast = vi.fn();
    agent.rememberGenerationText = vi.fn();

    const connection: any = { send: vi.fn(), id: 'conn-1' };

    await expect(agent.runCloudflareWorkersAI(
      '@cf/deepseek-ai/deepseek-v4-flash-0731',
      'You are a helpful assistant.',
      [{ role: 'user' as const, content: 'Hello' }],
      connection,
      'Hello',
      undefined,
      0,
      true,
      {},
      [],
      new Set<string>(),
      (fn: () => void) => fn(),
      6,
      true,
    )).rejects.toThrow('max_tokens');

    expect(aiRunCalls.length).toBe(5);
  });
});
