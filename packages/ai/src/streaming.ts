export type StreamEventType =
  | 'text'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_complete'
  | 'error'
  | 'done';

export interface StreamEvent {
  type: StreamEventType;
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    args?: string;
  };
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export class StreamingManager {
  // Track tool call IDs and names to handle delta events properly
  private toolCallStates: Map<string, { id: string; name: string; args: string }> = new Map();
  private doneEmitted = false;

  /**
   * Adapts a raw fetch Response stream into an AsyncGenerator of StreamEvents.
   * Supports OpenAI-compatible SSE streams.
   */
  public async *adaptStream(response: Response, provider: 'openai' = 'openai'): AsyncGenerator<StreamEvent> {
    if (!response.body) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneSent = false;

    // Reset state for each new stream
    this.resetState();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;

          const dataStr = line.replace(/^data: /, '').trim();
          if (dataStr === '[DONE]') {
            doneSent = true;
            // Emit done with usage if available
            yield { type: 'done' };
            return;
          }

          try {
            const data = JSON.parse(dataStr);
            const events = this.parseOpenAIEvent(data);
            for (const event of events) {
              yield event;
            }
          } catch (e) {
            console.warn('Failed to parse SSE JSON:', e);
          }
        }
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      yield { type: 'error', error: `Stream error: ${errorMessage}` };
    } finally {
      reader.releaseLock();

      // ─── Handle non-streaming fallback ───
      if (!doneSent && buffer.trim().startsWith('{')) {
        try {
          const data = JSON.parse(buffer);
          const events = this.parseNonStreamingResponse(data);
          for (const event of events) {
            yield event;
          }
        } catch (e) {
          console.warn('Buffer was not valid JSON:', e);
        }
      }

      // Clean up state
      this.resetState();

      // Only emit done if it wasn't already sent
      if (!doneSent) {
        yield { type: 'done' };
      }
    }
  }

  /**
   * Parses OpenAI-compatible SSE events (including tool calls).
   */
  private *parseOpenAIEvent(data: any): Generator<StreamEvent> {
    const choice = data.choices?.[0];

    // ─── Usage ───
    // With `stream_options: { include_usage: true }`, providers send a final
    // chunk carrying usage and an EMPTY choices array. Handle it before the
    // `!choice` guard below so token accounting isn't silently dropped.
    if (data.usage && !this.doneEmitted) {
      this.doneEmitted = true;
      yield {
        type: 'done',
        usage: {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        },
      };
    }

    if (!choice) return;

    // ─── Text delta ───
    if (choice.delta?.content) {
      yield { type: 'text', text: choice.delta.content };
    }

    // ─── Tool call start ───
    if (choice.delta?.tool_calls?.length > 0) {
      for (const toolCall of choice.delta.tool_calls) {
        const indexKey = toolCall.index?.toString() ?? '0';

        if (toolCall.id) {
          // New tool call start
          const state = {
            id: toolCall.id,
            name: toolCall.function?.name ?? '',
            args: toolCall.function?.arguments ?? '',
          };
          this.toolCallStates.set(indexKey, state);

          yield {
            type: 'tool_call_start',
            toolCall: {
              id: state.id,
              name: state.name,
              args: state.args
            }
          };
        } else if (toolCall.function?.arguments !== undefined) {
          // Delta update for an existing tool call
          const state = this.toolCallStates.get(indexKey);
          if (state) {
            state.args += toolCall.function.arguments;
            yield {
              type: 'tool_call_delta',
              toolCall: {
                id: state.id,
                name: state.name,
                args: toolCall.function.arguments // delta chunk, not full args
              }
            };
          } else {
            // Fallback if no start was seen
            const fallbackId = `tool-${indexKey}`;
            this.toolCallStates.set(indexKey, {
              id: fallbackId,
              name: toolCall.function?.name ?? '',
              args: toolCall.function?.arguments ?? '',
            });
            yield {
              type: 'tool_call_delta',
              toolCall: {
                id: fallbackId,
                name: toolCall.function?.name ?? '',
                args: toolCall.function.arguments
              }
            };
          }
        }
      }
    }

    // ─── Finish reasons ───
    if (choice.finish_reason === 'tool_calls') {
      // Complete the tool call
      for (const [key, state] of this.toolCallStates) {
        yield {
          type: 'tool_call_complete',
          toolCall: { id: state.id, name: state.name, args: state.args }
        };
      }
      this.toolCallStates.clear();
    }

    if (choice.finish_reason === 'stop') {
      // Normal stop - no tool calls to complete
    }
  }

  /**
   * Parses a non-streaming OpenAI response (for fallback).
   */
  private *parseNonStreamingResponse(data: any): Generator<StreamEvent> {
    const choice = data.choices?.[0];
    if (!choice) return;

    // ─── Text content ───
    if (choice.message?.content) {
      yield { type: 'text', text: choice.message.content };
    }

    // ─── Tool calls ───
    if (choice.message?.tool_calls?.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        yield {
          type: 'tool_call_start',
          toolCall: {
            id: toolCall.id,
            name: toolCall.function.name,
            args: toolCall.function.arguments ?? '',
          }
        };
        yield {
          type: 'tool_call_complete',
          toolCall: {
            id: toolCall.id,
            name: toolCall.function.name,
            args: toolCall.function.arguments ?? '',
          }
        };
      }
    }

    // ─── Usage ───
    if (data.usage) {
      yield {
        type: 'done',
        usage: {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      };
    } else {
      yield { type: 'done' };
    }
  }

  /**
   * Resets internal state for a new stream.
   */
  private resetState(): void {
    this.toolCallStates.clear();
    this.doneEmitted = false;
  }
}