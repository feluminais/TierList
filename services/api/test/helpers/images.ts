/**
 * Minimal but structurally valid image headers, built byte by byte.
 *
 * Synthetic rather than fixture files on purpose: a test that says
 * `pngBytes(1920, 1080)` states exactly which bytes it is asserting about,
 * where a binary fixture hides them. Real encoder output is checked separately,
 * end to end — see the last task in the plan.
 */
export function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR payload length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/**
 * A minimal JPEG: SOI, one irrelevant APP0 segment to prove the scanner skips
 * segments it does not care about, then a frame header carrying the size.
 */
export function jpegBytes(
  width: number,
  height: number,
  sofMarker = 0xc0,
): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, length 4 (includes the 2 length bytes)
    0xff, sofMarker, 0x00, 0x11, // SOF, length 17
    0x08, // sample precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, // component count; the 9 bytes below are its component specs
    ...new Array(9).fill(0),
  ]);
}

function riffContainer(fourcc: string, payloadLength: number): Uint8Array {
  const bytes = new Uint8Array(12 + 8 + payloadLength);
  const view = new DataView(bytes.buffer);
  const ascii = (text: string, at: number) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
  };
  ascii("RIFF", 0);
  view.setUint32(4, bytes.length - 8, true);
  ascii("WEBP", 8);
  ascii(fourcc, 12);
  view.setUint32(16, payloadLength, true);
  return bytes;
}

/** Lossy: a 3-byte frame tag, the start code, then two 14-bit LE fields. */
export function webpLossyBytes(width: number, height: number): Uint8Array {
  const bytes = riffContainer("VP8 ", 10);
  bytes.set([0x9d, 0x01, 0x2a], 23);
  const view = new DataView(bytes.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return bytes;
}

/** Lossless: a signature byte, then 28 bits packing both sizes minus one. */
export function webpLosslessBytes(width: number, height: number): Uint8Array {
  const bytes = riffContainer("VP8L", 5);
  bytes[20] = 0x2f;
  const packed = ((width - 1) | ((height - 1) << 14)) >>> 0;
  new DataView(bytes.buffer).setUint32(21, packed, true);
  return bytes;
}

/** Extended: 4 flag bytes, then two 24-bit LE canvas sizes minus one. */
export function webpExtendedBytes(width: number, height: number): Uint8Array {
  const bytes = riffContainer("VP8X", 10);
  const u24 = (value: number, at: number) => {
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >> 8) & 0xff;
    bytes[at + 2] = (value >> 16) & 0xff;
  };
  u24(width - 1, 24);
  u24(height - 1, 27);
  return bytes;
}
