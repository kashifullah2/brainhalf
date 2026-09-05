import { describe, it, expect } from "vitest";
import { ProviderManager } from "./providers";

describe("ProviderManager.selectBestModel", () => {
  it("picks the cheaper model for simple 2D on Cerebras", () => {
    const mgr = new ProviderManager({ provider: "Cerebras", apiKey: "k" });
    expect(mgr.selectBestModel("simple_2d")).toBe("zai-glm-4.7");
  });

  it("picks the stronger model for 3D on Cerebras", () => {
    const mgr = new ProviderManager({ provider: "Cerebras", apiKey: "k" });
    expect(mgr.selectBestModel("standard_3d")).toBe("gpt-oss-120b");
    expect(mgr.selectBestModel("complex_physics")).toBe("gpt-oss-120b");
  });

  it("honours an explicit model override regardless of complexity", () => {
    const mgr = new ProviderManager({ provider: "Cerebras", apiKey: "k", modelOverride: "custom-model" });
    expect(mgr.selectBestModel("simple_2d")).toBe("custom-model");
    expect(mgr.selectBestModel("complex_physics")).toBe("custom-model");
  });

  it("maps AgentRouter complexities", () => {
    const mgr = new ProviderManager({ provider: "AgentRouter", apiKey: "k" });
    expect(mgr.selectBestModel("simple_2d")).toBe("glm-5.1");
    expect(mgr.selectBestModel("standard_3d")).toBe("deepseek-v4-pro");
  });

  it("falls back to the auto-free model for OpenProvider", () => {
    const mgr = new ProviderManager({ provider: "OpenProvider", apiKey: "k" });
    expect(mgr.selectBestModel("standard_3d")).toBe("openprovider/auto-free");
  });

  it("uses claude-sonnet-4-6 for FreeModel 3D", () => {
    const mgr = new ProviderManager({ provider: "FreeModel", apiKey: "k" });
    expect(mgr.selectBestModel("standard_3d")).toBe("claude-sonnet-4-6");
  });

  it("uses claude-haiku for FreeModel 2D", () => {
    const mgr = new ProviderManager({ provider: "FreeModel", apiKey: "k" });
    expect(mgr.selectBestModel("simple_2d")).toBe("claude-haiku-4-5-20251001");
  });

  it("uses openai/gpt-oss-120b for Groq", () => {
    const mgr = new ProviderManager({ provider: "Groq", apiKey: "k" });
    expect(mgr.selectBestModel("standard_3d")).toBe("openai/gpt-oss-120b");
  });

  it("uses gemini-2.0-flash for Gemini", () => {
    const mgr = new ProviderManager({ provider: "Gemini", apiKey: "k" });
    expect(mgr.selectBestModel("standard_3d")).toBe("gemini-2.0-flash");
  });
});

describe("ProviderManager.calculateCost", () => {
  it("computes cost from per-1k token rates", () => {
    const mgr = new ProviderManager({ provider: "Cerebras", apiKey: "k" });
    // gpt-oss-120b: prompt 0.00014, completion 0.00028 per 1k tokens
    const cost = mgr.calculateCost("gpt-oss-120b", 1000, 1000);
    expect(cost).toBeCloseTo(0.00014 + 0.00028, 10);
  });

  it("returns zero for unknown models", () => {
    const mgr = new ProviderManager({ provider: "Cerebras", apiKey: "k" });
    expect(mgr.calculateCost("does-not-exist", 1000, 1000)).toBe(0);
  });

  it("scales linearly with token counts", () => {
    const mgr = new ProviderManager({ provider: "Cerebras", apiKey: "k" });
    const single = mgr.calculateCost("zai-glm-4.7", 1000, 0);
    const double = mgr.calculateCost("zai-glm-4.7", 2000, 0);
    expect(double).toBeCloseTo(single * 2, 10);
  });
});
