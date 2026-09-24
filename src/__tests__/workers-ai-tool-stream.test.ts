import { describe, expect, it, vi } from 'vitest';
import { readToolStream } from '../lib/workers-ai-tool-stream';
import { runCapabilityLoop } from '../lib/agent-capabilities';

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
function stream(input: string) {
  const bytes = new TextEncoder().encode(input);
  return new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
}
describe('Workers AI streaming tool turns', () => {
  it('runs independent reads together and waits before each mutation', async () => {
    const order: string[] = [];
    const finishReads: Array<() => void> = [];
    const read = vi.fn((args: Record<string, unknown>) => {
      order.push(`read ${args.id}`);
      return args.id === 'after' ? Promise.resolve('updated') : new Promise<string>(resolve => finishReads.push(() => resolve('source')));
    });
    const write = vi.fn(async () => { order.push('write'); return 'saved'; });
    const calls = ['first', 'second', 'third', 'write', 'after'].map((id, index) => ({ id: String(index), function: { name: id === 'write' ? 'write' : 'read', arguments: JSON.stringify({ id }) } }));
    const run = vi.fn().mockResolvedValueOnce({ choices: [{ message: { tool_calls: calls } }] }).mockResolvedValueOnce({ response: 'Done' });
    const messages: Array<Record<string, unknown>> = [];
    const pending = runCapabilityLoop(run, messages, {
      read: { description: 'Read', parameters: {}, parallelRead: true, execute: read },
      write: { description: 'Write', parameters: {}, execute: write },
    }, new AbortController().signal, () => {});
    await vi.waitFor(() => expect(finishReads).toHaveLength(3));
    expect(write).not.toHaveBeenCalled();
    finishReads[2](); finishReads[1](); finishReads[0]();
    await pending;
    expect(order).toEqual(['read first', 'read second', 'read third', 'write', 'read after']);
    expect(messages.filter(item => item.role === 'tool').map(item => item.tool_call_id)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('enforces the configured tool-round limit and preserves a final-response request', async () => {
    const execute = vi.fn(async () => 'source');
    const run = vi.fn(async () => ({ choices: [{ message: { tool_calls: [{ function: { name: 'read', arguments: '{}' } }] } }] }));
    const messages: Array<Record<string, unknown>> = [];
    expect(await runCapabilityLoop(run, messages, { read: { description: 'Read', parameters: {}, execute } }, new AbortController().signal, () => {}, () => {}, () => {}, { maxSteps: 2 })).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(messages[messages.length - 1]?.content).toContain('tools are unavailable');
  });

  it('stops during stalled reads before executing a queued write or another model call', async () => {
    const read = vi.fn(() => new Promise(() => {}));
    const write = vi.fn();
    const controller = new AbortController();
    const run = vi.fn(async () => ({ tool_calls: ['read', 'write'].map(name => ({ function: { name, arguments: '{}' } })) }));
    const pending = runCapabilityLoop(run, [], {
      read: { description: 'Read', parameters: {}, parallelRead: true, execute: read },
      write: { description: 'Write', parameters: {}, execute: write },
    }, controller.signal, () => {});
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    controller.abort(); await rejected;
    expect(write).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
  it('assembles split tool arguments and UTF-8 while emitting text before executing tools', async () => {
    const order: string[] = []; const usage = vi.fn();
    const execute = vi.fn(async args => { order.push('tool'); return { saved: args.title }; });
    const run = vi.fn().mockResolvedValueOnce(stream(
      frame({ choices: [{ delta: { content: 'Creating café' } }] }) +
      frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'save', arguments: '{"title":' } }] } }] }) +
      frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"café"}' } }] } }] }) +
      frame({ usage: { prompt_tokens: 12, completion_tokens: 4 } }) + frame({ usage: { prompt_tokens: 12, completion_tokens: 4 } }) + 'data: [DONE]\r\n\r\n',
    )).mockResolvedValueOnce(stream(frame({ choices: [{ delta: { content: 'Saved' } }] }) + 'data: [DONE]\n\n'));
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content: 'Save café' }];
    const chunks: string[] = [];
    const result = await runCapabilityLoop(run, messages, { save: { description: 'Save', parameters: {}, execute } }, new AbortController().signal, usage, () => {}, text => { chunks.push(text); order.push('text'); });
    expect(result).toBe('Creating café\nSaved'); expect(chunks.join('')).toBe(result);
    expect(order.indexOf('text')).toBeLessThan(order.indexOf('tool'));
    expect(execute).toHaveBeenCalledWith({ title: 'café' });
    expect(messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'call-1', content: '{"saved":"café"}' });
    expect(usage.mock.calls[0][0]).toEqual({ prompt_tokens: 12, completion_tokens: 4 });
    expect(run.mock.calls.every(([input]) => input.stream === true)).toBe(true);
  });
  it('finishes on DONE without waiting for closure or slow cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(frame({ response: 'done' }) + 'data: [DONE]\n\n')); }, cancel });
    expect((await readToolStream(response, new AbortController().signal, () => {})).choices?.[0].message?.content).toBe('done');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels a stalled stream without executing partial tool arguments', async () => {
    const cancel = vi.fn(); const controller = new AbortController(); const execute = vi.fn(); const onText = vi.fn();
    const response = new ReadableStream<Uint8Array>({ start(value) { value.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { content: 'Starting', tool_calls: [{ index: 0, function: { name: 'save', arguments: '{' } }] } }] }))); }, cancel });
    const pending = runCapabilityLoop(async () => response, [], { save: { description: 'Save', parameters: {}, execute } }, controller.signal, () => {}, () => {}, onText);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(onText).toHaveBeenCalled()); controller.abort(); await rejected;
    expect(cancel).toHaveBeenCalledOnce(); expect(execute).not.toHaveBeenCalled();
  });
  it('surfaces provider errors and refuses incomplete indexed tool calls', async () => {
    await expect(readToolStream(stream(frame({ error: { message: 'Quota exceeded' } })), new AbortController().signal, () => {})).rejects.toThrow('Quota exceeded');
    await expect(readToolStream(stream(frame({ choices: [{ delta: { tool_calls: [{ index: 1, function: { name: 'save', arguments: '{}' } }] } }] })), new AbortController().signal, () => {})).rejects.toThrow('incomplete');
  });
});
