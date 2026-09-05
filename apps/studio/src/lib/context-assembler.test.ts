import { describe, it, expect } from "vitest";
import {
  summarizeFileContent,
  extractMentionedPaths,
  scoreFileRelevance,
  selectRelevantFiles,
  formatSystemContext,
  collectTouchedPaths,
  estimateTokens,
} from "./context-assembler";
import type { FileNode } from "@stores/studio-store";

const mockFiles: FileNode[] = [
  { id: "1", name: "package.json", type: "file", parentId: null, path: "package.json", content: '{"name":"x"}' },
  { id: "2", name: "index.html", type: "file", parentId: null, path: "index.html", content: "<html></html>" },
  { id: "3", name: "game.js", type: "file", parentId: null, path: "src/game.js", content: "console.log(1)" },
  { id: "4", name: "player.js", type: "file", parentId: null, path: "src/player.js", content: "export {}" },
  { id: "5", name: "unused.js", type: "file", parentId: null, path: "src/unused.js", content: "// old" },
];

describe("summarizeFileContent", () => {
  it("returns full content when under cap", () => {
    const r = summarizeFileContent("hello", 100);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("hello");
  });

  it("summarizes oversized files with head/tail", () => {
    const big = "a".repeat(5000);
    const r = summarizeFileContent(big, 1000);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain("omitted");
    expect(r.text.length).toBeLessThan(5000);
  });
});

describe("extractMentionedPaths", () => {
  it("finds paths in user prompt", () => {
    expect(extractMentionedPaths("fix src/main.js and index.html")).toEqual(
      expect.arrayContaining(["src/main.js", "index.html"]),
    );
  });
});

describe("selectRelevantFiles", () => {
  it("prioritizes entry files and mentioned paths", () => {
    const selected = selectRelevantFiles({
      files: mockFiles,
      userPrompt: "update src/player.js movement",
    });
    expect(selected[0]).toBe("package.json");
    expect(selected).toContain("src/player.js");
    expect(selected.indexOf("src/player.js")).toBeLessThan(selected.indexOf("src/unused.js"));
  });
});

describe("scoreFileRelevance", () => {
  it("scores error files highly", () => {
    const score = scoreFileRelevance("src/main.js", {
      userPrompt: "game",
      mentionedPaths: new Set(),
      recentlyTouched: new Set(),
      errorFiles: new Set(["src/main.js"]),
    });
    expect(score).toBeGreaterThan(80);
  });
});

describe("collectTouchedPaths", () => {
  it("extracts paths from tool result messages", () => {
    const paths = collectTouchedPaths([
      { role: "tool", content: "File written: src/game.js (120 bytes)." },
      { role: "tool", content: "Contents of index.html:\n<html>" },
    ]);
    expect(paths).toContain("src/game.js");
    expect(paths).toContain("index.html");
  });
});

describe("formatSystemContext / estimateTokens", () => {
  it("wraps file block with refresh hint", () => {
    expect(formatSystemContext("--- a.js ---\ncode")).toContain("refreshed this turn");
  });

  it("estimates tokens from chars", () => {
    expect(estimateTokens(400)).toBe(100);
  });
});

describe("buildFileContextBlock savings", () => {
  it("reports savings vs naive dump", async () => {
    const { buildFileContextBlock } = await import("./context-assembler");
    const bigContent = "x".repeat(8000);
    const files: FileNode[] = [
      ...mockFiles,
      { id: "6", name: "big.js", type: "file", parentId: null, path: "src/big.js", content: bigContent },
    ];
    const { stats } = await buildFileContextBlock({
      files,
      selectedPaths: ["src/big.js", "package.json"],
      readFile: async () => null,
    });
    expect(stats.filesIncluded).toBeGreaterThan(0);
    expect(stats.savingsPercent).toBeGreaterThan(0);
  });
});
