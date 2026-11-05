import { createTierList, type TierListAction } from "@tl/core";
import { createSession, type EditorSession } from "@tl/editor-core";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useSessionEdits } from "../app/editor/useSessionEdits";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-08-01T12:00:00.000Z";
const RENAME: TierListAction = { type: "meta/set", patch: { title: "Ramen" } };
const ADD: TierListAction = { type: "item/addText", id: "i1", label: "Udon" };
const clock = () => NOW;

function mount(loaded: boolean) {
  return renderHook(
    ({ loaded }) => {
      const [session, setSession] = useState(() =>
        createSession(createTierList({ id: "list-1", now: NOW }), null),
      );
      return { session, edits: useSessionEdits(setSession, loaded, clock) };
    },
    { initialProps: { loaded } },
  );
}

describe("useSessionEdits", () => {
  it("applies an action once the list has loaded", () => {
    const { result } = mount(true);
    act(() => result.current.edits.dispatch(RENAME));
    expect(result.current.session.doc.title).toBe("Ramen");
    expect(result.current.session.canUndo).toBe(true);
  });

  it("ignores every kind of edit while the list is loading", () => {
    const { result } = mount(false);
    const before: EditorSession = result.current.session;

    act(() => result.current.edits.dispatch(RENAME));
    act(() => result.current.edits.dispatchAll([RENAME, ADD]));
    act(() => result.current.edits.undo());
    act(() => result.current.edits.redo());

    expect(result.current.session).toBe(before);
  });

  it("starts accepting edits the moment loading ends", () => {
    const { result, rerender } = mount(false);
    act(() => result.current.edits.dispatch(RENAME));
    expect(result.current.session.doc.title).not.toBe("Ramen");

    rerender({ loaded: true });
    act(() => result.current.edits.dispatch(RENAME));
    expect(result.current.session.doc.title).toBe("Ramen");
  });

  it("keeps a batch as one undo step", () => {
    const { result } = mount(true);
    act(() => result.current.edits.dispatchAll([RENAME, ADD]));
    expect(result.current.session.doc.items).toHaveLength(1);

    act(() => result.current.edits.undo());
    expect(result.current.session.doc.items).toHaveLength(0);
    expect(result.current.session.doc.title).not.toBe("Ramen");
  });
});
