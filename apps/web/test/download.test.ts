import { describe, expect, it } from "vitest";
import { filenameFor } from "../app/editor/download";

describe("filenameFor", () => {
  it("keeps ordinary titles, joined by dashes", () => {
    expect(filenameFor("Best noodles", "png")).toBe("Best-noodles.png");
  });

  /**
   * The one that matters. A tier list is very often called something like
   * "S/A/B tiers", and a browser saving `S/A/B tiers.png` on a POSIX
   * filesystem truncates the name silently rather than reporting anything.
   */
  it("strips path separators and other filesystem punctuation", () => {
    expect(filenameFor("S/A/B tiers", "png")).toBe("SAB-tiers.png");
    expect(filenameFor("a\\b:c*d?e\"f<g>h|i", "jpg")).toBe("abcdefghi.jpg");
    expect(filenameFor("../../etc/passwd", "json")).toBe("etcpasswd.json");
  });

  it("keeps letters outside ASCII, which are perfectly valid in a filename", () => {
    expect(filenameFor("ラーメン tier", "png")).toBe("ラーメン-tier.png");
  });

  it("falls back rather than producing a name that is only an extension", () => {
    expect(filenameFor("", "png")).toBe("tier-list.png");
    expect(filenameFor("///", "png")).toBe("tier-list.png");
    expect(filenameFor("   ", "png")).toBe("tier-list.png");
  });

  it("bounds the length, because a title has none", () => {
    const name = filenameFor("x".repeat(500), "png");
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.endsWith(".png")).toBe(true);
  });

  it("collapses runs of whitespace instead of emitting a run of dashes", () => {
    expect(filenameFor("a   b", "png")).toBe("a-b.png");
  });
});
