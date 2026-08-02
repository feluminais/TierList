"use client";

import type { Row } from "@tl/core";
import { MAX_TILE_SIZE, MIN_TILE_SIZE, type Rect } from "@tl/editor-core";
import { useEffect, useRef, type CSSProperties } from "react";

/**
 * Colours offered as swatches, in the order `createTierList` uses them.
 *
 * A ramp rather than a palette of unrelated hues: tiers are ordinal, and the
 * default set reads as a scale from best to worst. A tier recoloured by hand
 * still looks like it belongs beside the others.
 */
const SWATCHES = ["#ff7f7f", "#ffbf7f", "#ffff7f", "#bfff7f", "#7fbfff", "#bf9fff"];

/** The panel's own width, in px. Fixed so the slide-out distance is known. */
const PANEL_WIDTH = 236;

export interface TierPanelProps {
  row: Row;
  /** The tier's label cell, in board coordinates — what the panel anchors to. */
  labelRect: Rect;
  /** The size the tier renders at now, override or list-wide. */
  effectiveSize: number;
  /**
   * Whether the size control drives every tier at once.
   *
   * Held by the overlay rather than here, because the corner grip obeys it too
   * and a mode that lived in the panel would not exist while the panel is shut.
   */
  resizeAll: boolean;
  onResizeAllChange: (resizeAll: boolean) => void;
  onRename: (label: string) => void;
  onRecolor: (color: string) => void;
  onSize: (size: number) => void;
  onRemove: () => void;
  onClose: () => void;
  /** True when there is nowhere to the left to open into. */
  openRight: boolean;
}

/**
 * The controls for one tier, opening out of the tier's own colour cell.
 *
 * Everything that acts on a single tier lives here — the board is the only
 * place tiers are edited, so there is no second control elsewhere to drift out
 * of step with this one. Reordering is absent by design: a tier is moved by
 * dragging it, which is the same gesture its tiles already use.
 *
 * A DOM panel rather than something drawn on the canvas: it holds a colour
 * input, a slider and a text field, none of which Skia can render or take
 * input for.
 */
export function TierPanel({
  row,
  labelRect,
  effectiveSize,
  resizeAll,
  onResizeAllChange,
  onRename,
  onRecolor,
  onSize,
  onRemove,
  onClose,
  openRight,
}: TierPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape closes, from anywhere. The panel sits over a canvas that takes its
  // own pointer events, so a click-catching backdrop would cost the board
  // every drag while the panel is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Moves focus into the panel when it opens, so Escape and tabbing work
  // without a click first, and a keyboard user is not left behind on the board.
  useEffect(() => {
    panelRef.current?.querySelector("input")?.focus();
  }, [row.id]);

  const style: CSSProperties = {
    position: "absolute",
    // Vertically centred on the tier it belongs to, then clamped to the board's
    // top so a tall panel on the first tier is not cut off above the canvas.
    top: Math.max(0, labelRect.y + labelRect.height / 2 - 90),
    ...(openRight
      ? { left: labelRect.x + labelRect.width + 8 }
      : { left: labelRect.x - PANEL_WIDTH - 8 }),
    width: PANEL_WIDTH,
    pointerEvents: "auto",
    background: "#12161b",
    border: "1px solid #2c3540",
    borderRadius: 10,
    boxShadow: "0 6px 24px rgba(0,0,0,0.55)",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    color: "#e6edf3",
    fontFamily: "system-ui, sans-serif",
    fontSize: 13,
    zIndex: 2,
    // Emerges from behind the tier: starts tucked under the colour cell and
    // slides out. Mirrored when it opens to the right, so it always appears to
    // come out from under the tier rather than flying in from off-screen.
    animation: `${openRight ? "tl-tier-panel-in-right" : "tl-tier-panel-in-left"} 140ms ease-out`,
  };

  return (
    <div ref={panelRef} data-testid="tier-panel" style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          aria-label="Tier name"
          data-testid="tier-panel-name"
          value={row.label}
          placeholder="Tier name"
          onChange={(event) => onRename(event.target.value)}
          style={{ ...field, flex: 1 }}
        />
        <button
          type="button"
          aria-label="Close"
          data-testid="tier-panel-close"
          onClick={onClose}
          style={{ ...button, padding: "4px 8px" }}
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Colour ${color}`}
            data-testid="tier-panel-swatch"
            onClick={() => onRecolor(color)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: color,
              cursor: "pointer",
              // The current colour is marked rather than merely looking
              // selected, so it is legible against its own swatch.
              border:
                row.color.toLowerCase() === color.toLowerCase()
                  ? "2px solid #e6edf3"
                  : "1px solid #2c3540",
            }}
          />
        ))}
        <input
          aria-label="Tier colour"
          data-testid="tier-panel-color"
          type="color"
          value={row.color}
          onChange={(event) => onRecolor(event.target.value)}
          style={{ ...field, padding: 2, width: 32, height: 26 }}
        />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#8b98a6" }}>
        Size
        <input
          aria-label="Tier tile size"
          data-testid="tier-panel-size"
          type="range"
          min={MIN_TILE_SIZE}
          max={MAX_TILE_SIZE}
          step={4}
          value={effectiveSize}
          onChange={(event) => onSize(Number(event.target.value))}
          style={{ flex: 1 }}
        />
        <span data-testid="tier-panel-size-value" style={{ width: 30, textAlign: "right" }}>
          {effectiveSize}
        </span>
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#8b98a6" }}>
        <input
          type="checkbox"
          aria-label="Resize all tiers"
          data-testid="tier-panel-resize-all"
          checked={resizeAll}
          onChange={(event) => onResizeAllChange(event.target.checked)}
        />
        Resize all tiers
      </label>

      <button
        type="button"
        data-testid="tier-panel-remove"
        // Its items return to the tray rather than being deleted with it, so
        // this needs no confirmation and undo restores it whole.
        title="Remove this tier — its items go back to the tray"
        onClick={onRemove}
        style={{ ...button, color: "#f87171" }}
      >
        Remove tier
      </button>
    </div>
  );
}

export { PANEL_WIDTH };

const field: CSSProperties = {
  background: "#0b0d10",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "6px 8px",
  fontFamily: "inherit",
  fontSize: 13,
};

const button: CSSProperties = {
  background: "#222b35",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "6px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
};
