/**
 * What an upload actually is, as opposed to what it claimed to be.
 *
 * This module is the sole authority on whether a byte string is an image this
 * product accepts — the same role `migrate()` plays for documents. It takes
 * attacker-controlled input, so it never throws, never reads out of bounds, and
 * returns null for anything it does not fully understand.
 */
export type ImageContentType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageInfo {
  contentType: ImageContentType;
  width: number;
  height: number;
}

/**
 * A ceiling on declared dimensions. A header can claim 4 billion pixels a side
 * for free; anything downstream that allocates per pixel would then be handed a
 * number no real image carries. This is a sanity bound, not a product limit.
 */
const MAX_DIMENSION = 65535;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, i) => bytes[i] === byte);
}

/** ASCII compare at an offset, bounds-checked. Used for FourCC tags. */
function tagAt(bytes: Uint8Array, offset: number, tag: string): boolean {
  if (offset + tag.length > bytes.length) return false;
  for (let i = 0; i < tag.length; i++) {
    if (bytes[offset + i] !== tag.charCodeAt(i)) return false;
  }
  return true;
}

function u32be(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return (
    ((bytes[offset]! << 24) >>> 0) +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

/** Checks both dimensions are present, positive, and not absurd, then packages the result. */
function toImageInfo(
  contentType: ImageContentType,
  width: number | null,
  height: number | null,
): ImageInfo | null {
  if (width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  return { contentType, width, height };
}

function sniffPng(bytes: Uint8Array): ImageInfo | null {
  // The IHDR chunk is required by the spec to come first, so its position is
  // fixed: 8 bytes of signature, then length(4) and type(4).
  if (!tagAt(bytes, 12, "IHDR")) return null;
  return toImageInfo("image/png", u32be(bytes, 16), u32be(bytes, 20));
}

function u16be(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  return (bytes[offset]! << 8) + bytes[offset + 1]!;
}

/**
 * Markers in 0xC0..0xCF are frame headers *except* three: DHT (0xC4), JPG
 * (0xC8) and DAC (0xCC). Those carry entirely different payloads, so reading a
 * size out of one yields a confident wrong answer rather than a failure — which
 * is why they are excluded by name rather than by range.
 */
function isFrameMarker(marker: number): boolean {
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function sniffJpeg(bytes: Uint8Array): ImageInfo | null {
  let offset = 2; // past SOI

  while (offset < bytes.length) {
    // A marker is 0xFF followed by a byte that is not itself 0xFF. Any number
    // of 0xFF fill bytes may precede it, which is legal and does occur.
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;

    const marker = bytes[offset];
    if (marker === undefined) return null;
    offset++;

    // Standalone markers carry no payload, so there is no length to skip.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;

    const length = u16be(bytes, offset);
    // A length counts its own two bytes, so anything under 2 is malformed, and
    // a length running past the buffer means the stream is truncated or lying.
    if (length === null || length < 2 || offset + length > bytes.length) {
      return null;
    }

    if (isFrameMarker(marker)) {
      // The length field counts itself (2 bytes), then precision(1),
      // height(2), width(2) follow — 5 more bytes, so a genuine frame header
      // needs a declared length of at least 7. Without this check a short
      // length here still lets the two u16be reads below succeed against
      // whatever bytes happen to follow this segment, returning a confident
      // wrong answer instead of failing.
      if (length < 7) return null;
      return toImageInfo(
        "image/jpeg",
        u16be(bytes, offset + 5),
        u16be(bytes, offset + 3),
      );
    }

    offset += length;
  }

  return null;
}

function u8(bytes: Uint8Array, offset: number): number | null {
  if (offset >= bytes.length) return null;
  return bytes[offset]!;
}

function u16le(bytes: Uint8Array, offset: number): number | null {
  if (offset + 2 > bytes.length) return null;
  return bytes[offset]! + (bytes[offset + 1]! << 8);
}

function u24le(bytes: Uint8Array, offset: number): number | null {
  if (offset + 3 > bytes.length) return null;
  return bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16);
}

function u32le(bytes: Uint8Array, offset: number): number | null {
  if (offset + 4 > bytes.length) return null;
  return (
    (bytes[offset]! +
      (bytes[offset + 1]! << 8) +
      (bytes[offset + 2]! << 16) +
      bytes[offset + 3]! * 0x1000000) >>>
    0
  );
}

/**
 * WebP is a RIFF container whose first chunk names the codec, and the three
 * codecs store the canvas size three different ways. All three are live: an
 * encoder picks lossy for photographs, lossless for flat graphics, and extended
 * whenever alpha or animation is present.
 */
function sniffWebp(bytes: Uint8Array): ImageInfo | null {
  if (!tagAt(bytes, 8, "WEBP")) return null;

  if (tagAt(bytes, 12, "VP8 ")) {
    // A 3-byte frame tag, then a fixed start code, then two 14-bit fields. The
    // start code is checked because without it any 10 bytes would parse.
    const startCode0 = u8(bytes, 23);
    const startCode1 = u8(bytes, 24);
    const startCode2 = u8(bytes, 25);
    if (startCode0 !== 0x9d || startCode1 !== 0x01 || startCode2 !== 0x2a) {
      return null;
    }
    const width = u16le(bytes, 26);
    const height = u16le(bytes, 28);
    return toImageInfo(
      "image/webp",
      width === null ? null : width & 0x3fff,
      height === null ? null : height & 0x3fff,
    );
  }

  if (tagAt(bytes, 12, "VP8L")) {
    if (u8(bytes, 20) !== 0x2f) return null;
    const packed = u32le(bytes, 21);
    if (packed === null) return null;
    // Both sizes are stored minus one, so the field range 0..16383 expresses
    // 1..16384 and a zero dimension is unrepresentable by construction.
    return toImageInfo(
      "image/webp",
      (packed & 0x3fff) + 1,
      ((packed >>> 14) & 0x3fff) + 1,
    );
  }

  if (tagAt(bytes, 12, "VP8X")) {
    const width = u24le(bytes, 24);
    const height = u24le(bytes, 27);
    return toImageInfo(
      "image/webp",
      width === null ? null : width + 1,
      height === null ? null : height + 1,
    );
  }

  return null;
}

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return sniffPng(bytes);
  if (startsWith(bytes, [0xff, 0xd8])) return sniffJpeg(bytes);
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) return sniffWebp(bytes);
  return null;
}
