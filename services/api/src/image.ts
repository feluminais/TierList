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

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return sniffPng(bytes);
  return null;
}
