import { describe, expect, it } from "vitest";
import { sniffImage } from "../src/image";
import { jpegBytes, pngBytes } from "./helpers/images";

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

describe("sniffImage — JPEG", () => {
  it("finds the frame header past segments it does not care about", () => {
    expect(sniffImage(jpegBytes(640, 480))).toEqual({
      contentType: "image/jpeg",
      width: 640,
      height: 480,
    });
  });

  it.each([0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])(
    "reads a frame from SOF marker 0x%s",
    (marker) => {
      expect(sniffImage(jpegBytes(64, 32, marker))).toEqual({
        contentType: "image/jpeg",
        width: 64,
        height: 32,
      });
    },
  );

  // These share the SOF numeric range but are not frame headers. Reading a
  // size out of a Huffman table would produce a confident wrong answer.
  it.each([0xc4, 0xc8, 0xcc])("does not mistake marker 0x%s for a frame", (marker) => {
    expect(sniffImage(jpegBytes(64, 32, marker))).toBeNull();
  });

  it("tolerates fill bytes between segments", () => {
    const base = jpegBytes(8, 8);
    const padded = new Uint8Array([
      ...base.slice(0, 8),
      0xff, 0xff, 0xff, // fill bytes, legal before a marker
      ...base.slice(8),
    ]);
    expect(sniffImage(padded)).toEqual({
      contentType: "image/jpeg",
      width: 8,
      height: 8,
    });
  });

  it("rejects a stream that ends before any frame header", () => {
    expect(sniffImage(jpegBytes(8, 8).slice(0, 8))).toBeNull();
  });

  it("rejects a frame header truncated mid-dimension", () => {
    expect(sniffImage(jpegBytes(8, 8).slice(0, 15))).toBeNull();
  });

  it("rejects a segment whose declared length would run past the end", () => {
    const bytes = jpegBytes(8, 8);
    bytes[5] = 0xff; // APP0 length becomes enormous
    expect(sniffImage(bytes)).toBeNull();
  });

  it("rejects a segment declaring a length shorter than its own length field", () => {
    const bytes = jpegBytes(8, 8);
    bytes[4] = 0x00;
    bytes[5] = 0x01; // length 1 — cannot even hold the length field
    expect(sniffImage(bytes)).toBeNull();
  });

  it("rejects SOI with nothing after it", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});
