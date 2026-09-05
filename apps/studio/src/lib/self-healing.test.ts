import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildRepairPrompt, getRepairConfig, collectErrors } from "./self-healing";
import { normalizeErrors } from "./error-normalizer";

vi.mock("./webcontainer", () => ({
  webContainerManager: {
    consumePreviewErrors: vi.fn(() => []),
    consumeBuildErrors: vi.fn(() => []),
    verifyBuild: vi.fn(async () => ({ code: 0, output: "" })),
  },
}));

import { webContainerManager } from "./webcontainer";

describe("getRepairConfig", () => {
  it("returns defaults", () => {
    const cfg = getRepairConfig();
    expect(cfg.maxAttempts).toBeGreaterThan(0);
    expect(cfg.runBuildCheck).toBe(true);
    expect(cfg.settleMs).toBeGreaterThan(0);
  });
});

describe("buildRepairPrompt", () => {
  it("includes normalized errors and raw output", () => {
    const errors = normalizeErrors([
      'Failed to resolve import "phaser" from "src/main.js". File: src/main.js:1:21',
    ]);
    const prompt = buildRepairPrompt(errors);
    expect(prompt).toContain("phaser");
    expect(prompt).toContain("src/main.js");
    expect(prompt).toContain("create_file");
  });
});

describe("collectErrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(webContainerManager.consumePreviewErrors).mockReturnValue([]);
    vi.mocked(webContainerManager.consumeBuildErrors).mockReturnValue([]);
    vi.mocked(webContainerManager.verifyBuild).mockResolvedValue({ code: 0, output: "" });
  });

  it("returns passive preview errors without build check", async () => {
    vi.mocked(webContainerManager.consumePreviewErrors).mockReturnValue([
      "Uncaught TypeError: x is not a function",
    ]);
    const errors = await collectErrors({ maxAttempts: 3, runBuildCheck: true, settleMs: 0 });
    expect(errors).toHaveLength(1);
    expect(errors[0].category).toBe("runtime");
  });

  it("runs verifyBuild when no passive errors", async () => {
    vi.mocked(webContainerManager.verifyBuild).mockResolvedValue({
      code: 1,
      output: "Transform failed with 1 error",
    });
    const errors = await collectErrors({ maxAttempts: 3, runBuildCheck: true, settleMs: 0 });
    expect(webContainerManager.verifyBuild).toHaveBeenCalled();
    expect(errors[0].category).toBe("build");
  });

  it("skips build check when disabled", async () => {
    const errors = await collectErrors({ maxAttempts: 3, runBuildCheck: false, settleMs: 0 });
    expect(webContainerManager.verifyBuild).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });
});

describe("error recovery flow (unit)", () => {
  it("dedupes identical errors before repair prompt", () => {
    const errors = normalizeErrors([
      { text: "Uncaught TypeError: x is not a function", hint: "runtime" },
      { text: "Uncaught TypeError: x is not a function", hint: "runtime" },
    ]);
    expect(errors).toHaveLength(1);
    const prompt = buildRepairPrompt(errors);
    expect(prompt).toContain("runtime");
  });
});
