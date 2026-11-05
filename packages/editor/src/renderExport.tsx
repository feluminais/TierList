import type { TierList } from "@tl/core";
import type { ExportPlan } from "@tl/editor-core";
import {
  drawAsImage,
  Group,
  ImageFormat,
  Skia,
  type SkFont,
  type SkTypeface,
} from "@shopify/react-native-skia";
import React from "react";
import type { ExportedImage, ExportFormat } from "./export";
import { BoardScene, boardFontSizes } from "./TierBoard";
import type { ImageCache } from "./useImageCache";

/** JPEG quality; see `encodeBoardImage`, which uses the same. */
const JPEG_QUALITY = 92;

export interface RenderExportOptions {
  doc: TierList;
  /** What to draw and at what size, from `exportPlan`. */
  plan: ExportPlan;
  /** The images the live board has already decoded. */
  images: ImageCache;
  /** The faces the live board loaded, for fonts at this layout's sizes. */
  typefaces: { regular: SkTypeface | null; bold: SkTypeface | null };
  format: ExportFormat;
}

/**
 * Draws the document at an export geometry, off screen, and encodes it.
 *
 * It draws the same scene the board does (`BoardScene`) from the layout the
 * plan carries, scaled by the plan's scale, so the picture is the board at
 * another shape rather than a second renderer. Nothing on the live canvas is
 * touched: the editor can keep being used while it runs.
 *
 * Fonts are made here at this layout's sizes from the typefaces the live board
 * loaded. A face that has not loaded yet leaves the labels out rather than
 * failing the export.
 *
 * Returns null when there is nothing to hand back: a surface that could not be
 * created, or an encoder that produced no bytes.
 */
export async function renderBoardImage(options: RenderExportOptions): Promise<ExportedImage | null> {
  const { doc, plan, images, typefaces, format } = options;
  const { rowSize, tileSize } = boardFontSizes(plan.layout);

  const font = (face: SkTypeface | null, size: number): SkFont | null =>
    face ? Skia.Font(face, size) : null;
  const fonts = {
    row: font(typefaces.regular, rowSize),
    rowBold: font(typefaces.bold ?? typefaces.regular, rowSize),
    tile: font(typefaces.regular, tileSize),
    rowSize,
    tileSize,
  };

  const image = await drawAsImage(
    <Group transform={[{ scale: plan.scale }]}>
      <BoardScene doc={doc} width={plan.width} board={plan.layout} images={images} fonts={fonts} />
    </Group>,
    { width: plan.pixelWidth, height: plan.pixelHeight },
  );
  if (!image) return null;

  const bytes = image.encodeToBytes(
    format === "png" ? ImageFormat.PNG : ImageFormat.JPEG,
    JPEG_QUALITY,
  ) as Uint8Array | null;
  if (!bytes || bytes.byteLength === 0) return null;

  return { bytes, contentType: format === "png" ? "image/png" : "image/jpeg" };
}
