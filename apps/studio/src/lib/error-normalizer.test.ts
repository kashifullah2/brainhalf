import { describe, it, expect } from "vitest";
import {
  classifyError,
  normalizeError,
  normalizeErrors,
  formatErrorsForPrompt,
  summarizeErrors,
  stripAnsi,
  toProjectRelative,
} from "./error-normalizer";

describe("stripAnsi", () => {
  it("removes color codes", () => {
    expect(stripAnsi("\u001b[31mError\u001b[0m: boom")).toBe("Error: boom");
  });
});

describe("toProjectRelative", () => {
  it("strips webcontainer roots", () => {
    expect(toProjectRelative("/home/projects/abc/src/main.js")).toBe("src/main.js");
    expect(toProjectRelative("./src/game.js")).toBe("src/game.js");
  });
});

describe("classifyError", () => {
  it("detects vite import errors", () => {
    expect(
      classifyError('Failed to resolve import "phaser" from "src/main.js"'),
    ).toBe("vite");
  });

  it("detects typescript errors", () => {
    expect(classifyError("src/a.ts:3:5 - error TS2304: Cannot find name 'foo'")).toBe(
      "typescript",
    );
  });

  it("detects dependency errors", () => {
    expect(classifyError("npm ERR! could not resolve dependency")).toBe("dependency");
    expect(classifyError("Cannot find module 'three'")).toBe("dependency");
  });

  it("detects runtime errors", () => {
    expect(classifyError("Uncaught exception: TypeError: x is not a function")).toBe(
      "runtime",
    );
  });

  it("detects build errors", () => {
    expect(classifyError("Transform failed with 1 error")).toBe("build");
  });
});

describe("normalizeError", () => {
  it("extracts file/line/column from a vite error", () => {
    const raw =
      '12:34:56 PM [vite] Internal server error: Failed to resolve import "phaser" from "src/main.js".\n  File: /home/projects/x/src/main.js:1:21';
    const n = normalizeError(raw);
    expect(n.category).toBe("vite");
    expect(n.file).toBe("src/main.js");
    expect(n.line).toBe(1);
    expect(n.column).toBe(21);
    expect(n.message).toContain("Failed to resolve import");
    expect(n.message).not.toMatch(/^\d/); // timestamp stripped
  });

  it("respects a category hint", () => {
    expect(normalizeError("exit code 1", "command").category).toBe("command");
  });
});

describe("normalizeErrors", () => {
  it("dedupes identical errors", () => {
    const errs = normalizeErrors([
      'Failed to resolve import "phaser" from "src/main.js"',
      'Failed to resolve import "phaser" from "src/main.js"',
    ]);
    expect(errs).toHaveLength(1);
  });

  it("keeps distinct errors and preserves order", () => {
    const errs = normalizeErrors([
      { text: "Uncaught exception: ReferenceError: a is not defined", hint: "runtime" },
      { text: "npm ERR! missing dep", hint: "dependency" },
    ]);
    expect(errs.map((e) => e.category)).toEqual(["runtime", "dependency"]);
  });
});

describe("formatErrorsForPrompt / summarizeErrors", () => {
  it("renders a numbered block with locations", () => {
    const errs = normalizeErrors([
      '[vite] Failed to resolve import "phaser" from "src/main.js".\n File: src/main.js:1:21',
    ]);
    const block = formatErrorsForPrompt(errs);
    expect(block).toMatch(/^1\. \[vite\] \(src\/main\.js:1:21\)/);
  });

  it("summarizes counts by category", () => {
    const errs = normalizeErrors([
      { text: "Uncaught exception: TypeError x", hint: "runtime" },
      { text: 'Failed to resolve import "p" from "src/a.js"', hint: "vite" },
    ]);
    expect(summarizeErrors(errs)).toBe("1 runtime, 1 vite");
  });

  it("handles empty input", () => {
    expect(formatErrorsForPrompt([])).toBe("");
    expect(summarizeErrors([])).toBe("no errors");
  });
});
