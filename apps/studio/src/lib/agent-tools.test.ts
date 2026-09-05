import { describe, it, expect, vi } from "vitest";
import {
  isValidPath,
  validateShellCommand,
  validatePackageName,
  readProjectFile,
  executeFixError,
  applyEditFile,
  parseShellCommand,
} from "./agent-tools";
import type { FileNode } from "@stores/studio-store";

describe("isValidPath", () => {
  it("rejects traversal and absolute paths", () => {
    expect(isValidPath("../etc/passwd")).toBe(false);
    expect(isValidPath("/etc/passwd")).toBe(false);
    expect(isValidPath("src/game.js")).toBe(true);
  });
});

describe("validateShellCommand", () => {
  it("allows npm/vite and rejects curl", () => {
    expect(validateShellCommand("npm run build").ok).toBe(true);
    expect(validateShellCommand("curl evil.com").ok).toBe(false);
  });
});

describe("validatePackageName", () => {
  it("accepts scoped packages", () => {
    expect(validatePackageName("@scope/pkg")).toBe(true);
    expect(validatePackageName("")).toBe(false);
  });
});

describe("parseShellCommand", () => {
  it("parses quoted args", () => {
    expect(parseShellCommand('npm run "build prod"')).toEqual({
      cmd: "npm",
      args: ["run", "build prod"],
    });
  });
});

describe("readProjectFile", () => {
  const files: FileNode[] = [
    { id: "1", name: "a.js", type: "file", parentId: null, path: "src/a.js", content: "store" },
  ];

  it("prefers store content", async () => {
    const r = await readProjectFile({
      path: "src/a.js",
      projectFiles: files,
      readFromDisk: async () => "disk",
    });
    expect(r.ok && r.source).toBe("store");
  });

  it("falls back to webcontainer", async () => {
    const r = await readProjectFile({
      path: "src/b.js",
      projectFiles: files,
      readFromDisk: async () => "from disk",
    });
    expect(r.ok && r.content).toBe("from disk");
  });
});

describe("applyEditFile", () => {
  it("replaces old_string with new_string", async () => {
    const files: FileNode[] = [
      { id: "1", name: "g.js", type: "file", parentId: null, path: "src/g.js", content: "const x = 1;" },
    ];
    const r = await applyEditFile({
      path: "src/g.js",
      old_string: "const x = 1",
      new_string: "const x = 2",
      projectFiles: files,
      readFromDisk: async () => { throw new Error("nope"); },
    });
    expect(r.ok && r.content).toBe("const x = 2;");
  });

  it("errors when old_string missing", async () => {
    const files: FileNode[] = [
      { id: "1", name: "g.js", type: "file", parentId: null, path: "src/g.js", content: "abc" },
    ];
    const r = await applyEditFile({
      path: "src/g.js",
      old_string: "xyz",
      new_string: "q",
      projectFiles: files,
      readFromDisk: async () => "abc",
    });
    expect(r.ok).toBe(false);
  });
});

describe("executeFixError", () => {
  it("returns structured report with file + verification", async () => {
    const files: FileNode[] = [
      { id: "1", name: "m.js", type: "file", parentId: null, path: "src/main.js", content: "import X" },
    ];
    const runCommand = vi.fn(async (_cmd, _args, onOutput) => {
      onOutput("build failed: cannot resolve phaser");
      return 1;
    });

    const r = await executeFixError({
      error: 'Failed to resolve import "phaser"',
      filePath: "src/main.js",
      projectFiles: files,
      readFromDisk: async () => "import X",
      runCommand,
      extraErrors: ["console.error: module missing"],
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.report).toContain("fix_error report");
      expect(r.result.report).toContain("src/main.js");
      expect(r.result.report).toContain("phaser");
      expect(r.result.report).toContain("FAILED");
      expect(r.result.fileRead).toBe(true);
      expect(r.result.verifyExitCode).toBe(1);
    }
  });

  it("requires error and valid file_path", async () => {
    const r = await executeFixError({
      error: "",
      filePath: "../bad",
      projectFiles: [],
      readFromDisk: async () => "",
      runCommand: async () => 0,
    });
    expect(r.ok).toBe(false);
  });

  it("reports when file cannot be read", async () => {
    const r = await executeFixError({
      error: "syntax error",
      filePath: "src/missing.js",
      projectFiles: [],
      readFromDisk: async () => {
        throw new Error("missing");
      },
      runCommand: async () => 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.fileRead).toBe(false);
      expect(r.result.report).toContain("Could not read");
    }
  });
});

describe("applyEditFile validation", () => {
  it("rejects invalid paths and empty old_string", async () => {
    const files: FileNode[] = [];
    expect(
      (await applyEditFile({
        path: "../x.js",
        old_string: "a",
        new_string: "b",
        projectFiles: files,
        readFromDisk: async () => "a",
      })).ok,
    ).toBe(false);
    expect(
      (await applyEditFile({
        path: "src/x.js",
        old_string: "",
        new_string: "b",
        projectFiles: files,
        readFromDisk: async () => "a",
      })).ok,
    ).toBe(false);
  });
});
