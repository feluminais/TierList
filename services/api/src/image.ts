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

/** Both dimensions present, positive, and not absurd. */
function validate(
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
  return validate("image/png", u32be(bytes, 16), u32be(bytes, 20));
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
    // A marker is 0xFF followed by a non-0xFF, non-zero byte. Any number of
    // 0xFF fill bytes may precede it, which is legal and does occur.
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
      // precision(1) then height(2) then width(2), immediately after length.
      return validate(
        "image/jpeg",
        u16be(bytes, offset + 5),
        u16be(bytes, offset + 3),
      );
    }

    offset += length;
  }

  return null;
}

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return sniffPng(bytes);
  if (startsWith(bytes, [0xff, 0xd8])) return sniffJpeg(bytes);
  return null;
}
