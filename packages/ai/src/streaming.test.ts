import { describe, it, expect } from "vitest";
import { StreamingManager, StreamEvent } from "./streaming";

/** Builds a Response whose body streams the given SSE lines. */
function sseResponse(lines: string[]): Response {
  const body = lines.map((l) => `${l}\n`).join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("StreamingManager.adaptStream", () => {
  it("emits text deltas", async () => {
    const mgr = new StreamingManager();
    const res = sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hel" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "lo" } }] })}`,
      "data: [DONE]",
    ]);
    const events = await collect(mgr.adaptStream(res));
    const text = events.filter((e) => e.type === "text").map((e) => e.text).join("");
    expect(text).toBe("hello");
  });

  it("assembles streamed tool calls and completes them on finish_reason", async () => {
    const mgr = new StreamingManager();
    const res = sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "create_file", arguments: '{"path"' } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"a.js"}' } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: "tool_calls" }] })}`,
      "data: [DONE]",
    ]);
    const events = await collect(mgr.adaptStream(res));

    const start = events.find((e) => e.type === "tool_call_start");
    expect(start?.toolCall?.id).toBe("call_1");
    expect(start?.toolCall?.name).toBe("create_file");

    const complete = events.find((e) => e.type === "tool_call_complete");
    expect(complete?.toolCall?.id).toBe("call_1");
    expect(complete?.toolCall?.args).toBe('{"path":"a.js"}');
  });

  it("captures usage from the final include_usage chunk (empty choices)", async () => {
    const mgr = new StreamingManager();
    const res = sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}`,
      `data: ${JSON.stringify({ usage: { prompt_tokens: 12, completion_tokens: 7 }, choices: [] })}`,
      "data: [DONE]",
    ]);
    const events = await collect(mgr.adaptStream(res));
    const withUsage = events.find((e) => e.type === "done" && e.usage);
    expect(withUsage?.usage?.promptTokens).toBe(12);
    expect(withUsage?.usage?.completionTokens).toBe(7);
  });

  it("yields an error event when the response has no body", async () => {
    const mgr = new StreamingManager();
    const res = new Response(null, { status: 204 });
    const events = await collect(mgr.adaptStream(res));
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});
