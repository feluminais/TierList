import type { ExportPlan, ExportSettings } from "@tl/editor-core";
import { ImageFormat, type CanvasRef } from "@shopify/react-native-skia";

export type ExportFormat = "png" | "jpg";

export interface ExportedImage {
  bytes: Uint8Array;
  /** What the bytes actually are, for a download or an upload. */
  contentType: string;
}

/**
 * JPEG quality. High enough that tile art does not visibly band, low enough
 * that a link preview is a few hundred kilobytes rather than a few thousand.
 * PNG ignores it — it is lossless.
 */
const JPEG_QUALITY = 92;

/**
 * Encode whatever a board canvas is currently showing.
 *
 * This is the design doc's "PNG and JPG rendered client-side through the same
 * Skia canvas" taken literally: it snapshots the canvas the user is looking
 * at, rather than building a second one. That is the whole dividend of the
 * stack choice — no headless server render — and it also means an export
 * cannot disagree with the board, because it *is* the board.
 *
 * The snapshot is taken at the canvas's backing-store resolution, which
 * react-native-skia sizes by device pixel ratio, so an export from a 2x screen
 * is 2x. That is a feature here (a sharper picture) and not something to
 * normalise away.
 *
 * Returns null rather than throwing when there is nothing to snapshot: the
 * canvas may not have mounted, and on web a lost WebGL context makes
 * `makeImageSnapshot` return nothing at all. A caller can say "not yet" far
 * more usefully than it can handle an exception from a button press.
 */
export function encodeBoardImage(
  canvas: CanvasRef | null | undefined,
  format: ExportFormat,
): ExportedImage | null {
  if (!canvas) return null;

  // Typed as non-null by `CanvasRef`, but the web implementation
  // (`SkiaPictureView.web.d.ts`) declares `SkImage | null` and returns null
  // when the surface is gone. Trusting the narrower declaration here would
  // turn a lost context into a `TypeError` inside a click handler.
  const image = canvas.makeImageSnapshot() as ReturnType<CanvasRef["makeImageSnapshot"]> | null;
  if (!image) return null;

  const bytes = image.encodeToBytes(
    format === "png" ? ImageFormat.PNG : ImageFormat.JPEG,
    JPEG_QUALITY,
  ) as Uint8Array | null;
  if (!bytes || bytes.byteLength === 0) return null;

  return {
    bytes,
    contentType: format === "png" ? "image/png" : "image/jpeg",
  };
}

/**
 * What a board hands its host so the host can export without ever importing
 * Skia itself.
 *
 * `apps/web`'s `SkiaHost` must not evaluate `@tl/editor` at module scope — the
 * package builds its Skia API object at load time and CanvasKit has to be on
 * the global first — so it cannot hold a `CanvasRef` or call
 * `encodeBoardImage` directly. It receives one of these instead, the same way
 * it receives the `Board` and `EditCanvas` components.
 */
export interface BoardExporter {
  /** The live canvas as it is, at the editing geometry. */
  toImage: (format: ExportFormat) => ExportedImage | null;
  /**
   * The document drawn off screen at the geometry of `settings`, whatever the
   * editing viewport is. Null when it could not be produced.
   */
  render: (settings: ExportSettings, format: ExportFormat) => Promise<ExportedImage | null>;
  /** What `render` would produce for these settings, without drawing it. */
  plan: (settings: ExportSettings) => ExportPlan;
}
