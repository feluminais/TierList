import { createTierList, reduce, type TierList } from "@tl/core";
import { layoutBoard } from "@tl/editor-core";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TileEditOverlay } from "../app/editor/TileEditButton";

const NOW = "2026-08-01T12:00:00.000Z";
const WIDTH = 800;

function doc(): TierList {
  let d = createTierList({ id: "list-1", now: NOW });
  d = reduce(d, { type: "item/addText", id: "i0", label: "Ramen" }, NOW);
  d = reduce(
    d,
    { type: "placement/place", itemId: "i0", rowId: d.rows[0]!.id, index: 0 },
    NOW,
  );
  return d;
}

/**
 * jsdom never lays anything out, so a real `getBoundingClientRect` always
 * reports zeros. `TileEditOverlay` only reads `left`/`top` off it to convert
 * a client point into board space, and 0/0 is exactly where the board's own
 * coordinate system starts — so zero is a faithful stand-in here, not a fudge
 * that happens to make the test pass.
 */
Element.prototype.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  right: WIDTH,
  bottom: 0,
  width: WIDTH,
  height: 0,
  x: 0,
  y: 0,
  toJSON() {},
});

afterEach(cleanup);

/** Mounts the overlay over a plain stand-in for the canvas, and returns the
 *  one placed tile's rect so a test can aim a mouse event at its centre. */
function mount(dragging: boolean, onEdit: (itemId: string) => void) {
  const d = doc();
  const layout = layoutBoard(d, { width: WIDTH });
  render(
    createElement(
      TileEditOverlay,
      { layout, dragging, onEdit },
      createElement("div", {
        "data-testid": "canvas-stub",
        style: { width: WIDTH, height: layout.contentHeight },
      }),
    ),
  );
  return { tile: layout.rows[0]!.tiles[0]!.rect };
}

function hoverTile(tile: { x: number; y: number }) {
  fireEvent.mouseMove(screen.getByTestId("tile-hover-wrapper"), {
    clientX: tile.x + 5,
    clientY: tile.y + 5,
  });
}

describe("TileEditOverlay", () => {
  it("is absent before the pointer has hovered anything", () => {
    mount(false, vi.fn());
    expect(screen.queryByTestId("tile-edit-button")).toBeNull();
  });

  it("appears for the tile under the pointer", () => {
    const { tile } = mount(false, vi.fn());
    hoverTile(tile);
    expect(screen.getByTestId("tile-edit-button")).not.toBeNull();
  });

  it("disappears on mouse leave", () => {
    const { tile } = mount(false, vi.fn());
    hoverTile(tile);
    expect(screen.getByTestId("tile-edit-button")).not.toBeNull();

    fireEvent.mouseLeave(screen.getByTestId("tile-hover-wrapper"));
    expect(screen.queryByTestId("tile-edit-button")).toBeNull();
  });

  it("calls onEdit with the hovered tile's itemId when clicked", () => {
    const onEdit = vi.fn();
    const { tile } = mount(false, onEdit);
    hoverTile(tile);

    fireEvent.click(screen.getByTestId("tile-edit-button"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("i0");
  });

  it("stays absent over a tile while a drag is in flight", () => {
    const { tile } = mount(true, vi.fn());
    hoverTile(tile);
    expect(screen.queryByTestId("tile-edit-button")).toBeNull();
  });

  it("does not show a button for a point off every tile", () => {
    mount(false, vi.fn());
    fireEvent.mouseMove(screen.getByTestId("tile-hover-wrapper"), {
      clientX: 4,
      clientY: 4,
    });
    expect(screen.queryByTestId("tile-edit-button")).toBeNull();
  });
});
