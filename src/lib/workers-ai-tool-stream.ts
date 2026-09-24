import { withAbortSignal } from './models';

interface ToolCall { id?: string; type?: string; function: { name: string; arguments: string } }
export interface ToolResponse {
  error?: unknown; response?: string; tool_calls?: Array<Record<string, any>>;
  choices?: Array<{ message?: { content?: string; tool_calls?: Array<Record<string, any>> } }>;
  usage?: Record<string, number>;
}

/** Read text immediately, but execute tool arguments only after the turn ends. */
export async function readToolStream(stream: ReadableStream<Uint8Array>, signal: AbortSignal, onText: (text: string) => void): Promise<ToolResponse> {
  const reader = stream.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let content = ''; let done = false; let argumentBytes = 0;
  const calls: ToolCall[] = []; const usage: Record<string, number> = {};
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const frame = (data: string) => {
    if (!data || done) return;
    if (data.trim() === '[DONE]') { done = true; return; }
    const value = JSON.parse(data);
    if (value.error || value.success === false) throw new Error(String(value.error?.message || value.error || value.errors?.[0]?.message || 'Workers AI request failed.'));
    for (const [key, count] of Object.entries(value.usage || {})) if (typeof count === 'number' && Number.isFinite(count)) usage[key] = Math.max(usage[key] || 0, count);
    const delta = value.choices?.[0]?.delta;
    const message = value.choices?.[0]?.message;
    const text = delta?.content ?? message?.content ?? value.response ?? value.choices?.[0]?.text;
    if (typeof text === 'string' && text) { content += text; onText(text); }
    const updates = delta?.tool_calls || message?.tool_calls || value.tool_calls || [];
    for (const [position, update] of updates.entries()) {
      const index = update.index ?? position;
      if (!Number.isInteger(index) || index < 0 || index >= 8) throw new Error('The model requested too many tools in one step.');
      const call = calls[index] ||= { type: 'function', function: { name: '', arguments: '' } };
      if (update.id) call.id = update.id;
      const fn = update.function || { name: update.name, arguments: update.arguments };
      if (typeof fn.name === 'string') call.function.name += fn.name;
      if (fn.arguments !== undefined) {
        const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments);
        argumentBytes += args.length;
        if (argumentBytes > 1_000_000) throw new Error('Tool arguments exceed the supported size.');
        call.function.arguments += args;
      }
    }
  };
  const drain = (final = false) => {
    // SSE events end at a blank line; preserve UTF-8 and JSON across chunks.
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const event = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
      frame(event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'));
      if (done) break;
    }
    if (final && buffer.trim() && !done) frame(buffer.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'));
    if (buffer.length > 2_000_000) throw new Error('Workers AI stream event is too large.');
  };
  try {
    signal.throwIfAborted();
    while (!done) {
      const chunk = await withAbortSignal(reader.read(), signal);
      signal.throwIfAborted();
      if (chunk.done) { buffer += decoder.decode(); drain(true); break; }
      buffer += typeof chunk.value === 'string' ? chunk.value : decoder.decode(chunk.value, { stream: true });
      drain();
    }
    if (Array.from(calls).some(call => !call?.function.name)) throw new Error('The model returned an incomplete tool call.');
    return { choices: [{ message: { content, tool_calls: calls } }], usage };
  } finally {
    signal.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
