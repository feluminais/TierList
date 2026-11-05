import { createTierList } from "@tl/core";
import { applyAction, createSession, type EditorSession } from "@tl/editor-core";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "../app/editor/Toolbar";

afterEach(cleanup);

const NOW = "2026-08-01T12:00:00.000Z";

/** A session that has something to undo, so "undo is disabled" can only be the loading state. */
function editedSession(): EditorSession {
  const session = createSession(createTierList({ id: "list-1", now: NOW }), 0);
  return applyAction(session, { type: "meta/set", patch: { title: "Ramen" } }, NOW);
}

function mount(loading: boolean) {
  render(
    createElement(Toolbar, {
      session: editedSession(),
      connection: { state: "connected", client: {} } as never,
      onTitleChange: vi.fn(),
      onUndo: vi.fn(),
      onRedo: vi.fn(),
      uploadError: null,
      onExportImage: vi.fn(),
      onExportOptions: vi.fn(),
      onExportJson: vi.fn(),
      onShare: vi.fn(),
      onAnnotate: vi.fn(),
      onCategory: vi.fn(),
      onTags: vi.fn(),
      loading,
    }),
  );
}

const disabled = (testId: string) =>
  (screen.getByTestId(testId) as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled;

describe("Toolbar while the list is loading", () => {
  const CONTROLS = [
    "title-input",
    "undo",
    "export-png",
    "export-jpg",
    "export-options",
    "export-json",
    "category",
    "tags-input",
    "annotate",
    "share",
  ];

  it("disables every control that edits, exports or shares", () => {
    mount(true);
    for (const id of CONTROLS) expect(disabled(id), id).toBe(true);
  });

  it("enables them once it has loaded", () => {
    mount(false);
    for (const id of CONTROLS) expect(disabled(id), id).toBe(false);
  });

  it("still lets the person leave for their lists", () => {
    mount(true);
    expect(screen.getByTestId("my-lists").getAttribute("href")).toBe("/lists");
  });

  it("says it is loading", () => {
    mount(true);
    expect(screen.getByTestId("save-status").textContent).toBe("Loading…");
  });
});
