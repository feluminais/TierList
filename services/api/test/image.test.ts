import { describe, expect, it } from "vitest";
import { sniffImage } from "../src/image";
import { pngBytes } from "./helpers/images";

describe("sniffImage — PNG", () => {
  it("reads dimensions from the IHDR chunk", () => {
    expect(sniffImage(pngBytes(1920, 1080))).toEqual({
      contentType: "image/png",
      width: 1920,
      height: 1080,
    });
  });

  it("accepts a single-pixel image", () => {
    expect(sniffImage(pngBytes(1, 1))).toEqual({
      contentType: "image/png",
      width: 1,
      height: 1,
    });
  });

  it("rejects a PNG signature with no IHDR chunk behind it", () => {
    expect(sniffImage(pngBytes(10, 10).slice(0, 12))).toBeNull();
  });

  it("rejects a truncated signature", () => {
    expect(sniffImage(pngBytes(10, 10).slice(0, 4))).toBeNull();
  });

  it("rejects a chunk that is not IHDR", () => {
    const bytes = pngBytes(10, 10);
    bytes.set([0x49, 0x44, 0x41, 0x54], 12); // "IDAT"
    expect(sniffImage(bytes)).toBeNull();
  });

  it("rejects zero dimensions", () => {
    expect(sniffImage(pngBytes(0, 10))).toBeNull();
    expect(sniffImage(pngBytes(10, 0))).toBeNull();
  });

  it("rejects empty input", () => {
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });
});
