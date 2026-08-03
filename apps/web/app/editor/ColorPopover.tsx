"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * The palette, as a grid of hues by shade.
 *
 * Vibrant rather than pastel: a tier's colour is doing real work — it is how
 * the eye separates one band from the next at a glance — and washed-out fills
 * make a board read as one grey mass. Each column is a hue and each row a
 * lightness, so a tier ramp can be picked straight down a column or across a
 * row without hunting.
 *
 * Every swatch here is dark enough at its mid rows to carry the near-black
 * label text `TierBoard` draws, which is why the lightest row stops where it
 * does rather than running to white.
 */
const HUES: readonly (readonly string[])[] = [
  ["#ff8a8a", "#ff4d4d", "#e01b1b", "#a30f0f"],
  ["#ffb877", "#ff9f2e", "#e07a00", "#a35800"],
  ["#ffe680", "#ffd633", "#e0b400", "#a38200"],
  ["#b8f08d", "#7ed957", "#4bb024", "#2f7a14"],
  ["#8ce0c0", "#33cc99", "#12a377", "#0a7555"],
  ["#8ed8ff", "#39b7ff", "#0d8ed6", "#0568a3"],
  ["#b0aaff", "#7c6fff", "#5340e0", "#3628a3"],
  ["#e8a8ff", "#cc63f0", "#a331cc", "#761f96"],
  ["#ffa8d4", "#ff5fa8", "#d62b7a", "#9c1b56"],
  ["#d8dee6", "#9aa6b4", "#68737f", "#3a424b"],
];

export interface ColorPopoverProps {
  value: string;
  onPick: (color: string) => void;
  onClose: () => void;
  /** Where the pointer was when this was opened, in viewport coordinates. */
  origin: { x: number; y: number };
}

/** Half the popover's own size, so it can be centred on the pointer. */
const WIDTH = 268;
const MARGIN = 8;

/**
 * A colour picker that opens where the pointer is.
 *
 * Anchored on the click rather than on the control, and scaled out of that
 * point, so the palette arrives under the hand that asked for it instead of
 * somewhere the eye then has to find. Clamped to the viewport on both axes —
 * a picker that opens half off-screen is worse than one that opens beside the
 * pointer instead of on it.
 *
 * Picking applies immediately and closes. There is no OK button because there
 * is nothing to confirm: the board repaints as the colour lands, and undo is
 * one press away.
 */
export function ColorPopover({ value, onPick, onClose, origin }: ColorPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Measured after mount rather than guessed: the height depends on the grid,
  // and clamping against the viewport needs the real number. Until it is
  // known the popover is rendered hidden, so it never flashes in the wrong
  // place and jumps.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({
      left: clamp(origin.x - width / 2, MARGIN, window.innerWidth - width - MARGIN),
      top: clamp(origin.y - height / 2, MARGIN, window.innerHeight - height - MARGIN),
    });
  }, [origin.x, origin.y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={backdrop} onClick={onClose} data-testid="color-popover-backdrop">
      <div
        ref={ref}
        data-testid="color-popover"
        role="dialog"
        aria-label="Pick a colour"
        onClick={(event) => event.stopPropagation()}
        style={{
          ...panel,
          left: position?.left ?? origin.x,
          top: position?.top ?? origin.y,
          visibility: position ? "visible" : "hidden",
          // Grows out of the point it was opened from. `transform-origin` is
          // the pointer's position within the panel, so the animation reads as
          // the palette unfolding from under the cursor rather than sliding in.
          transformOrigin: position
            ? `${origin.x - position.left}px ${origin.y - position.top}px`
            : "center",
          animation: "tl-color-popover-in 160ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div style={grid}>
          {HUES.map((column, columnIndex) =>
            column.map((color, shadeIndex) => {
              const selected = color.toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  data-testid="color-swatch"
                  onClick={() => {
                    onPick(color);
                    onClose();
                  }}
                  style={{
                    ...swatch,
                    background: color,
                    // Staggered along the diagonal, so the grid reads as one
                    // motion spreading outward instead of ten columns arriving
                    // at once.
                    animation: `tl-color-swatch-in 220ms ease-out ${(columnIndex + shadeIndex) * 12}ms both`,
                    outline: selected ? "2px solid #e6edf3" : "none",
                    outlineOffset: 1,
                  }}
                />
              );
            }),
          )}
        </div>

        <label style={custom}>
          Custom
          <input
            type="color"
            aria-label="Custom colour"
            data-testid="color-custom"
            value={value}
            onChange={(event) => onPick(event.target.value)}
            style={{
              width: 34,
              height: 26,
              padding: 2,
              background: "#0b0d10",
              border: "1px solid #2c3540",
              borderRadius: 6,
            }}
          />
          <span data-testid="color-value" style={{ color: "#8b98a6", fontFamily: "monospace" }}>
            {value.toUpperCase()}
          </span>
        </label>
      </div>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  // `max` can fall below `min` on a viewport narrower than the popover; the
  // lower bound wins there, so it stays on screen from the left edge.
  return Math.max(min, Math.min(n, Math.max(min, max)));
}

const backdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 70,
};

const panel: CSSProperties = {
  position: "fixed",
  width: WIDTH,
  background: "#12161b",
  border: "1px solid #2c3540",
  borderRadius: 12,
  boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  fontFamily: "system-ui, sans-serif",
  fontSize: 12,
  color: "#e6edf3",
};

const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(10, 1fr)",
  gridAutoFlow: "column",
  gridTemplateRows: "repeat(4, 1fr)",
  gap: 4,
};

const swatch: CSSProperties = {
  width: "100%",
  aspectRatio: "1",
  border: "none",
  borderRadius: 5,
  cursor: "pointer",
  padding: 0,
};

const custom: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#8b98a6",
};
