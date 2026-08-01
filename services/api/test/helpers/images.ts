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
