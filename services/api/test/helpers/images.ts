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
