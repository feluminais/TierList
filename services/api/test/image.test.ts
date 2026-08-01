import { describe, expect, it } from "vitest";
import { sniffImage } from "../src/image";
import {
  jpegBytes,
  pngBytes,
  webpExtendedBytes,
  webpLosslessBytes,
  webpLossyBytes,
} from "./helpers/images";

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

  // MAX_DIMENSION (65535) is a sanity ceiling, not a product limit — a real
  // image can legitimately be exactly this large, so the boundary itself must
  // still be accepted; only the first value past it should be rejected.
  it("accepts the maximum allowed dimension and rejects one past it", () => {
    expect(sniffImage(pngBytes(65535, 1))).toEqual({
      contentType: "image/png",
      width: 65535,
      height: 1,
    });
    expect(sniffImage(pngBytes(65536, 1))).toBeNull();
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

  // Same shape as the case above but on the SOF segment itself rather than
  // APP0. This still only exercises the generic `length < 2` floor (a length
  // of 1 cannot even hold the length field), not anything frame-specific —
  // see the next test for that.
  it("rejects a SOF segment whose declared length is below the generic floor", () => {
    const bytes = jpegBytes(64, 32);
    bytes[10] = 0x00;
    bytes[11] = 0x01; // SOF length 1 — too short to hold even the length field
    expect(sniffImage(bytes)).toBeNull();
  });

  // A frame header needs precision(1) + height(2) + width(2) = 5 bytes past
  // the 2-byte length field, so a genuine SOF segment needs length >= 7. A
  // length in 2..6 passes the generic floor above but is still too short to
  // contain those fields — and because the buffer genuinely continues past
  // the (too-short) segment, a missing check here does not fail loudly: the
  // two dimension reads succeed anyway, against bytes that belong to
  // whatever follows, and return a confident wrong answer instead of null.
  it.each([2, 4, 6])(
    "rejects a SOF segment declaring length %i, too short for a frame header",
    (length) => {
      const bytes = jpegBytes(64, 32);
      bytes[10] = (length >> 8) & 0xff;
      bytes[11] = length & 0xff;
      expect(sniffImage(bytes)).toBeNull();
    },
  );

  it("rejects SOI with nothing after it", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("sniffImage — WebP", () => {
  it("reads a lossy VP8 frame", () => {
    expect(sniffImage(webpLossyBytes(320, 240))).toEqual({
      contentType: "image/webp",
      width: 320,
      height: 240,
    });
  });

  it("reads a lossless VP8L bitstream", () => {
    expect(sniffImage(webpLosslessBytes(320, 240))).toEqual({
      contentType: "image/webp",
      width: 320,
      height: 240,
    });
  });

  it("reads an extended VP8X canvas", () => {
    expect(sniffImage(webpExtendedBytes(4000, 3000))).toEqual({
      contentType: "image/webp",
      width: 4000,
      height: 3000,
    });
  });

  // 14 bits hold 16384, and the stored value is size-1, so this is the ceiling
  // the lossy and lossless formats can express at all.
  it("reads the largest size the 14-bit fields can hold", () => {
    expect(sniffImage(webpLossyBytes(16383, 16383))).toEqual({
      contentType: "image/webp",
      width: 16383,
      height: 16383,
    });
    expect(sniffImage(webpLosslessBytes(16384, 16384))).toEqual({
      contentType: "image/webp",
      width: 16384,
      height: 16384,
    });
  });

  it("rejects RIFF that is not WEBP", () => {
    const bytes = webpLossyBytes(10, 10);
    bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
    expect(sniffImage(bytes)).toBeNull();
  });

  it("rejects an unknown WebP chunk type", () => {
    const bytes = webpLossyBytes(10, 10);
    bytes.set([0x56, 0x50, 0x39, 0x20], 12); // "VP9 "
    expect(sniffImage(bytes)).toBeNull();
  });

  it("rejects a lossy frame with the wrong start code", () => {
    const bytes = webpLossyBytes(10, 10);
    bytes[24] = 0x00;
    expect(sniffImage(bytes)).toBeNull();
  });

  it("rejects a lossless frame with the wrong signature byte", () => {
    const bytes = webpLosslessBytes(10, 10);
    bytes[20] = 0x00;
    expect(sniffImage(bytes)).toBeNull();
  });

  it.each([
    ["lossy", webpLossyBytes(10, 10)],
    ["lossless", webpLosslessBytes(10, 10)],
    ["extended", webpExtendedBytes(10, 10)],
  ])("rejects a truncated %s file", (_name, bytes) => {
    expect(sniffImage(bytes.slice(0, bytes.length - 1))).toBeNull();
  });
});

describe("sniffImage — rejection", () => {
  it("rejects a format we do not accept", () => {
    // GIF87a. A real image, deliberately unsupported.
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 10, 0, 10, 0]))).toBeNull();
  });

  it("rejects arbitrary bytes", () => {
    expect(sniffImage(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
  });

  it("never throws on arbitrary all-0xff input of any length", () => {
    // Fails every signature check in sniffImage, so this only proves
    // startsWith() itself is safe — see the sweep below for the sniffers.
    for (let length = 0; length < 40; length++) {
      const bytes = new Uint8Array(length).fill(0xff);
      expect(() => sniffImage(bytes)).not.toThrow();
    }
  });

  // Every prefix of a real header, from empty up to the full thing. This is
  // the sweep that actually matters: a genuine signature gets each sniffer
  // past its startsWith() gate and into its bounds-checked reads, so walking
  // every truncation point exercises every one of those checks — the u32be/
  // u16be/u16le/u24le/u32le/u8 reads, the isFrameMarker length floor, the
  // WebP start-code and signature-byte checks, all of it. A version of this
  // that used arbitrary bytes instead of real headers (see the test above)
  // would never reach past the first signature check.
  it.each([
    ["PNG", "image/png", pngBytes(10, 10)],
    ["JPEG", "image/jpeg", jpegBytes(10, 10)],
    ["WebP lossy", "image/webp", webpLossyBytes(10, 10)],
    ["WebP lossless", "image/webp", webpLosslessBytes(10, 10)],
    ["WebP extended", "image/webp", webpExtendedBytes(10, 10)],
  ] as const)(
    "never throws on any truncation of a %s header, and never returns a wrong result",
    (_name, contentType, full) => {
      const correct = { contentType, width: 10, height: 10 };
      for (let n = 0; n <= full.length; n++) {
        const truncated = full.slice(0, n);
        let result: ReturnType<typeof sniffImage>;
        expect(() => {
          result = sniffImage(truncated);
        }).not.toThrow();
        // A truncated header must never be reported as this exact 10x10
        // image — that is only correct at full length. Anything short of
        // that must be rejected outright (null), never a confident wrong
        // answer built from bytes past the end of the real header.
        if (n < full.length) {
          expect(result!).not.toEqual(correct);
        } else {
          expect(result!).toEqual(correct);
        }
      }
    },
  );
});
