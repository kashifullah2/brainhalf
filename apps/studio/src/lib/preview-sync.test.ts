import { describe, expect, it } from "vitest";
import { buildPreviewSrc, vitePreviewUrlForFile } from "./preview-urls";

describe("preview-sync", () => {
  it("maps root index.html to /", () => {
    expect(vitePreviewUrlForFile("index.html")).toBe("/");
  });

  it("maps public/*.html to root-relative URLs", () => {
    expect(vitePreviewUrlForFile("public/tetris.html")).toBe("/tetris.html");
    expect(vitePreviewUrlForFile("public/index.html")).toBe("/");
  });

  it("builds preview iframe src with path", () => {
    expect(buildPreviewSrc("http://localhost:5173/", "/tetris.html")).toBe(
      "http://localhost:5173/tetris.html",
    );
    expect(buildPreviewSrc("http://localhost:5173", "/")).toBe("http://localhost:5173");
  });
});
