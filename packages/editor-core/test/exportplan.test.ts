import { createTierList, reduce, type Density, type TierList, type TileAspect } from "@tl/core";
import { describe, expect, it } from "vitest";
import {
  clampExportSettings,
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_LIMITS,
  exportPlan,
  type ExportSettings,
} from "../src/exportplan";
import { gapFor, layoutBoard } from "../src/layout";

const NOW = "2026-08-01T12:00:00.000Z";

/** Non-default display settings, so a transposed width and height cannot cancel out. */
function sample(options: { tileSize?: number; tileAspect?: TileAspect; labelWidth?: number; density?: Density; items?: number } = {}): TierList {
  let doc = createTierList({ id: "list-1", now: NOW });
  doc = reduce(
    doc,
    {
      type: "display/set",
      patch: {
        tileSize: options.tileSize ?? 100,
        tileAspect: options.tileAspect ?? "portrait",
        labelWidth: options.labelWidth ?? 140,
        density: options.density ?? "roomy",
      },
    },
    NOW,
  );
  const count = options.items ?? 14;
  for (let i = 0; i < count; i += 1) {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `i${i}` }, NOW);
  }
  // Half of them placed in the first tier, the rest left in the tray.
  for (let i = 0; i < Math.floor(count / 2); i += 1) {
    doc = reduce(doc, { type: "placement/place", itemId: `i${i}`, rowId: doc.rows[0]!.id, index: i }, NOW);
  }
  return doc;
}

const settings = (patch: Partial<ExportSettings> = {}): ExportSettings => ({ ...DEFAULT_EXPORT_SETTINGS, ...patch });

describe("exportPlan", () => {
  it("lays the document out at the requested width, whatever the editing viewport was", () => {
    const doc = sample();
    const plan = exportPlan(doc, settings({ width: 900, columns: null }));
    expect(plan.width).toBe(900);
    expect(plan.layout).toEqual(layoutBoard(doc, { width: 900 }));
  });

  it("derives the width from tiles per line, so that many fit on a line at the list's tile size", () => {
    const doc = sample({ tileSize: 100, labelWidth: 140, density: "roomy" });
    const gap = gapFor("roomy");
    const plan = exportPlan(doc, settings({ columns: 5, width: null }));

    expect(plan.width).toBe(140 + 5 * (100 + gap) + gap);
    const firstRow = plan.layout.rows[0]!;
    const firstLine = firstRow.tiles.filter((t) => t.rect.y === firstRow.tiles[0]!.rect.y);
    expect(firstLine).toHaveLength(5);
    expect(plan.columns).toBe(5);
  });

  it("makes two different column counts two different widths, and more columns a wider picture", () => {
    const doc = sample();
    const three = exportPlan(doc, settings({ columns: 3, width: null }));
    const six = exportPlan(doc, settings({ columns: 6, width: null }));
    expect(six.width).toBeGreaterThan(three.width);
    // Fewer columns means more lines, so a taller picture for the same items.
    expect(three.layout.contentHeight).toBeGreaterThan(six.layout.contentHeight);
  });

  it("leaves the tray out when asked, and the picture ends where the last tier does", () => {
    const doc = sample();
    const withTray = exportPlan(doc, settings({ width: 900, columns: null, includeTray: true }));
    const without = exportPlan(doc, settings({ width: 900, columns: null, includeTray: false }));

    expect(without.layout.tray.tiles).toEqual([]);
    expect(without.layout.tray.rect.height).toBe(0);
    const last = without.layout.rows[without.layout.rows.length - 1]!;
    expect(without.layout.contentHeight).toBe(last.rect.y + last.rect.height);
    expect(without.layout.contentHeight).toBeLessThan(withTray.layout.contentHeight);
    // The tiers are identical with or without it.
    expect(without.layout.rows).toEqual(withTray.layout.rows);
  });

  it("multiplies the pixel size by the scale and rounds up, so nothing is cut off", () => {
    const doc = sample();
    const plan = exportPlan(doc, settings({ width: 801, columns: null, scale: 2 }));
    expect(plan.pixelWidth).toBe(1602);
    expect(plan.pixelHeight).toBe(Math.ceil(plan.layout.contentHeight * 2));

    const fractional = exportPlan(doc, settings({ width: 801, columns: null, scale: 1.5 }));
    expect(fractional.pixelWidth).toBe(Math.ceil(801 * 1.5));
  });

  it("does not depend on the document's own export-relevant settings being square", () => {
    for (const tileAspect of ["square", "portrait", "landscape"] as const) {
      const doc = sample({ tileAspect });
      const plan = exportPlan(doc, settings({ width: 1000, columns: null }));
      const tile = plan.layout.rows[0]!.tile;
      expect(tile.width).toBe(100);
      expect(tile.height).toBe(Math.round(100 * { square: 1, portrait: 4 / 3, landscape: 3 / 4 }[tileAspect]));
    }
  });

  it("never mutates the document", () => {
    const doc = sample();
    const before = JSON.stringify(doc);
    exportPlan(doc, settings({ width: 700, columns: 4, scale: 3, includeTray: false }));
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("is the same for the same input", () => {
    const doc = sample();
    expect(exportPlan(doc, settings({ columns: 4, width: null }))).toEqual(
      exportPlan(doc, settings({ columns: 4, width: null })),
    );
  });
});

describe("clamping", () => {
  it("keeps width, columns and scale inside their ranges", () => {
    const tooSmall = clampExportSettings(settings({ width: 10, columns: 0, scale: 0 }));
    expect(tooSmall.width).toBe(EXPORT_LIMITS.minWidth);
    expect(tooSmall.columns).toBe(EXPORT_LIMITS.minColumns);
    expect(tooSmall.scale).toBe(EXPORT_LIMITS.minScale);

    const tooBig = clampExportSettings(settings({ width: 1e9, columns: 1e9, scale: 99 }));
    expect(tooBig.width).toBe(EXPORT_LIMITS.maxWidth);
    expect(tooBig.columns).toBe(EXPORT_LIMITS.maxColumns);
    expect(tooBig.scale).toBe(EXPORT_LIMITS.maxScale);
  });

  it("turns a number that is not one into the default, and rounds width and columns to whole numbers", () => {
    expect(clampExportSettings(settings({ width: NaN })).width).toBe(DEFAULT_EXPORT_SETTINGS.width);
    expect(clampExportSettings(settings({ scale: Infinity })).scale).toBe(DEFAULT_EXPORT_SETTINGS.scale);
    expect(clampExportSettings(settings({ width: 800.6, columns: null })).width).toBe(801);
    expect(clampExportSettings(settings({ columns: 4.4 })).columns).toBe(4);
  });

  it("lets a null width or columns stand, since each means 'work it out from the other'", () => {
    expect(clampExportSettings(settings({ columns: null })).columns).toBeNull();
    expect(clampExportSettings(settings({ width: null })).width).toBeNull();
  });

  it("falls back to the default width when both are null", () => {
    const plan = exportPlan(sample(), settings({ width: null, columns: null }));
    expect(plan.width).toBe(DEFAULT_EXPORT_SETTINGS.width ?? 0);
  });

  it("lowers the scale, never the layout, so a huge picture stays within the pixel budget", () => {
    // Tall: many tiers' worth of tiles at a wide width and the largest scale.
    const doc = sample({ items: 400, tileSize: 240 });
    const plan = exportPlan(doc, settings({ width: EXPORT_LIMITS.maxWidth, columns: null, scale: EXPORT_LIMITS.maxScale }));

    expect(plan.pixelWidth * plan.pixelHeight).toBeLessThanOrEqual(EXPORT_LIMITS.maxPixels);
    expect(plan.scale).toBeLessThan(EXPORT_LIMITS.maxScale);
    expect(plan.scaleReduced).toBe(true);
    // The layout is the one asked for.
    expect(plan.layout).toEqual(layoutBoard(doc, { width: EXPORT_LIMITS.maxWidth }));
  });

  it("does not report a reduction when the scale fits", () => {
    const plan = exportPlan(sample(), settings({ width: 800, columns: null, scale: 2 }));
    expect(plan.scaleReduced).toBe(false);
    expect(plan.scale).toBe(2);
  });

  it("holds the pixel budget at every combination", () => {
    const doc = sample({ items: 200 });
    for (const width of [240, 800, 2400, 4096]) {
      for (const scale of [0.5, 1, 2, 4]) {
        for (const includeTray of [true, false]) {
          const plan = exportPlan(doc, settings({ width, columns: null, scale, includeTray }));
          expect(plan.pixelWidth * plan.pixelHeight, `${width}x${scale}`).toBeLessThanOrEqual(EXPORT_LIMITS.maxPixels);
          expect(plan.pixelWidth).toBeGreaterThan(0);
          expect(plan.pixelHeight).toBeGreaterThan(0);
        }
      }
    }
  });
});
