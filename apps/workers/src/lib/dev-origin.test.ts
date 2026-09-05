import { describe, it, expect } from "vitest";
import { isLocalDevOrigin } from "./dev-origin";

describe("isLocalDevOrigin", () => {
  it("accepts localhost origins", () => {
    expect(isLocalDevOrigin("http://localhost:5173")).toBe(true);
    expect(isLocalDevOrigin("http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects production origins", () => {
    expect(isLocalDevOrigin("https://studio.brainhalf.com")).toBe(false);
    expect(isLocalDevOrigin("https://brainhalf.com")).toBe(false);
  });

  it("handles referer-style strings", () => {
    expect(isLocalDevOrigin("http://localhost:5173/studio")).toBe(true);
  });
});
