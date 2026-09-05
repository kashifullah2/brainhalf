import { describe, it, expect } from "vitest";
import {
  summarizeToolCalls,
  buildHistoryFromStore,
  pruneHistory,
  compactMessage,
  measureHistory,
} from "./conversation-history";

describe("summarizeToolCalls", () => {
  it("summarizes completed tools", () => {
    expect(
      summarizeToolCalls([
        { type: "create_file", message: "write", status: "done" },
        { type: "read_file", message: "read", status: "loading" },
      ]),
    ).toBe("create_file ✓, read_file");
  });
});

describe("buildHistoryFromStore", () => {
  it("preserves tool summaries on assistant turns", () => {
    const history = buildHistoryFromStore(
      [
        { id: "1", role: "user", content: "make tetris" },
        {
          id: "2",
          role: "assistant",
          content: "on it",
          toolCalls: [{ type: "create_file", message: "write", status: "done" }],
        },
      ],
      new Set(),
    );
    expect(history[1].content).toContain("create_file");
    expect(history[1].toolSummary).toBe("create_file ✓");
  });

  it("excludes specified message ids", () => {
    const history = buildHistoryFromStore(
      [
        { id: "a", role: "user", content: "hi" },
        { id: "b", role: "assistant", content: "hello" },
      ],
      new Set(["b"]),
    );
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("hi");
  });
});

describe("pruneHistory", () => {
  it("drops oldest messages when over char budget", () => {
    const long = "word ".repeat(500);
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `${i}: ${long}`,
    }));
    const { messages, dropped } = pruneHistory(history, {
      maxFileContextChars: 14000,
      maxCharsPerFile: 2500,
      maxHistoryMessages: 12,
      maxHistoryChars: 2000,
    });
    expect(dropped).toBeGreaterThan(0);
    expect(messages.length).toBeLessThan(history.length);
  });
});

describe("compactMessage", () => {
  it("truncates long messages", () => {
    const out = compactMessage("a".repeat(1000), 100);
    expect(out.length).toBeLessThan(1000);
    expect(out).toContain("truncated");
  });
});

describe("measureHistory", () => {
  it("counts chars and estimates tokens", () => {
    const m = measureHistory([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
    expect(m.messages).toBe(2);
    expect(m.chars).toBe(10);
    expect(m.estTokens).toBeGreaterThan(0);
  });
});
