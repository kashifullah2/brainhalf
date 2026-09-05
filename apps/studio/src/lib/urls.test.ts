import { describe, it, expect, vi, afterEach } from "vitest";
import { getApiBaseUrl, getWebUrl, isDeployedBrainhalfHost } from "./urls";

describe("studio urls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects deployed brainhalf hosts", () => {
    expect(isDeployedBrainhalfHost("studio.brainhalf.com")).toBe(true);
    expect(isDeployedBrainhalfHost("brainhalf.com")).toBe(true);
    expect(isDeployedBrainhalfHost("localhost")).toBe(false);
  });

  it("uses production API on studio.brainhalf.com even if env has localhost", () => {
    vi.stubGlobal("window", {
      location: { hostname: "studio.brainhalf.com" },
    } as Window);
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("VITE_WEB_URL", "http://localhost:5174");

    expect(getApiBaseUrl()).toBe("https://brainhalf-api.kashifullah919.workers.dev");
    expect(getWebUrl()).toBe("https://brainhalf.com");
  });

  it("uses empty API base on localhost for vite proxy", () => {
    vi.stubGlobal("window", {
      location: { hostname: "localhost" },
    } as Window);
    vi.stubEnv("VITE_API_URL", "");
    vi.stubEnv("VITE_WEB_URL", "http://localhost:5174");

    expect(getApiBaseUrl()).toBe("");
    expect(getWebUrl()).toBe("http://localhost:5174");
  });
});
