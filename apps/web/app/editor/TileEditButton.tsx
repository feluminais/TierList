"use client";

import { findTile, hitTest, layoutBoard, type Rect } from "@tl/editor-core";
import type { TierList } from "@tl/core";
import {
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

export interface TileEditButtonProps {
  /** The hovered tile's rect, in board coordinates — the same space the
   *  canvas is drawn in and `TileEditOverlay` hit-tests against. */
  rect: Rect;
  onEdit: () => void;
}

/** Distance from the tile's top-right corner, in px. */
const INSET = 4;

/** Tiles range 48–200px; the button scales between these two bounds. */
const MIN_SIZE = 16;
const MAX_SIZE = 26;

/**
 * A small round pencil button pinned to a tile's top-right corner.
 *
 * Only ever one of these is mounted — see `TileEditOverlay`, which renders it
 * for whichever tile the pointer currently sits over instead of stamping one
 * per tile and hiding the rest behind CSS.
 */
export function TileEditButton({ rect, onEdit }: TileEditButtonProps) {
  const size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, rect.width * 0.26));

  const style: CSSProperties = {
    position: "absolute",
    left: rect.x + rect.width - size - INSET,
    top: rect.y + INSET,
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    borderRadius: "50%",
    background: "rgba(11, 13, 16, 0.75)",
    border: "1px solid rgba(230, 237, 243, 0.4)",
    boxShadow: "0 1px 4px rgba(0, 0, 0, 0.5)",
    color: "#e6edf3",
    cursor: "pointer",
    // The one interactive pixel in an otherwise click-through overlay — see
    // `TileEditOverlay`, whose own layer is `pointerEvents: "none"` precisely
    // so this is the only thing in it a click can land on.
    pointerEvents: "auto",
    // The entrance is a CSS keyframe (`globals.css`), not a state flip
    // scheduled on `requestAnimationFrame`. The rAF version worked but failed
    // *closed*: where rAF is throttled or deferred the callback never runs and
    // the button stays invisible while still taking clicks. An animation runs
    // from the element's own style with nothing to schedule, and where
    // animations do not run at all the element simply renders settled — the
    // failure is open in both directions.
    animation: "tl-tile-edit-button-in 120ms ease-out",
  };

  return (
    <button
      type="button"
      title="Edit tile"
      aria-label="Edit tile"
      data-testid="tile-edit-button"
      style={style}
      onClick={(event) => {
        // The overlay sits above the board; nothing beneath should also react
        // to this click.
        event.stopPropagation();
        onEdit();
      }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}

export interface TileEditOverlayProps {
  /** The document the canvas beneath is drawing. */
  doc: TierList;
  /** Width the canvas was laid out against — must match exactly, or the
   *  layout this hit-tests against drifts from what is on screen. */
  width: number;
  /** True while a drag is in flight. The button hides for its duration: see
   *  `InteractiveBoard`'s `onDraggingChange`. */
  dragging: boolean;
  onEdit: (itemId: string) => void;
  /**
   * The canvas (or its loading placeholder) this overlay is drawn on top of.
   *
   * Optional only so `createElement`'s typing — which passes children as
   * trailing arguments rather than folding them into this props object —
   * does not reject a call that supplies one perfectly well at runtime; every
   * real caller renders this with a canvas inside it.
   */
  children?: ReactNode;
}

/**
 * Wraps the board canvas and shows an edit button on whichever tile the
 * pointer is over.
 *
 * Hit-testing reuses `layoutBoard(doc, { width })` — the exact call the
 * canvas itself is drawn from — memoized here rather than recomputed per
 * mouse move, and never a second, independently-built layout that could
 * disagree with it.
 *
 * `children` is rendered untouched, and this component adds nothing to its
 * hit-testing surface: only the button itself takes pointer events (see its
 * own `pointerEvents: "auto"`). The absolutely-positioned layer the button
 * sits in is `pointerEvents: "none"` for exactly that reason — it is stacked
 * directly on top of the canvas, and without that it would swallow every
 * mousedown the drag gesture needs. The wrapping element below, by contrast,
 * is left at its default (`auto`): it *contains* the canvas rather than
 * covering it, and `pointer-events` is inherited, so setting it to `none`
 * here would cascade onto the canvas's own element and disable the drag
 * entirely — react-native-web's `View` only gets an explicit `pointer-events`
 * style when a `pointerEvents` prop is passed, and `InteractiveBoard` never
 * passes one.
 */
export function TileEditOverlay({ doc, width, dragging, onEdit, children }: TileEditOverlayProps) {
  const layout = useMemo(() => layoutBoard(doc, { width }), [doc, width]);
  const [hovered, setHovered] = useState<{ itemId: string; rect: Rect } | null>(null);

  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const hit = hitTest(layout, point);

    if (hit.kind !== "tile") {
      setHovered((current) => (current ? null : current));
      return;
    }

    setHovered((current) => {
      if (current?.itemId === hit.itemId) return current;
      const found = findTile(layout, hit.itemId);
      return found ? { itemId: hit.itemId, rect: found.rect } : null;
    });
  };

  const onMouseLeave = () => setHovered(null);

  return (
    <div
      data-testid="tile-hover-wrapper"
      style={wrapperStyle}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {children}
      <div style={overlayStyle}>
        {hovered && !dragging ? (
          <TileEditButton rect={hovered.rect} onEdit={() => onEdit(hovered.itemId)} />
        ) : null}
      </div>
    </div>
  );
}

const wrapperStyle: CSSProperties = {
  position: "relative",
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};
