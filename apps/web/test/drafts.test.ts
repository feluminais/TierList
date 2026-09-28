import { createTierList, reduce, type TierList } from "@tl/core";
import { applyAction, createSession, saveStarted, saveSucceeded, type EditorSession } from "@tl/editor-core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import { draftKey, readDraft, useDraft, type DraftStore } from "@tl/app-core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-08-01T12:00:00.000Z";
const LIST = "list-1";

function doc(): TierList {
  return createTierList({ id: LIST, now: NOW });
}

/** A store backed by a Map, synchronous or asynchronous on request. */
function memoryStore(asynchronous = false): DraftStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const settle = <T,>(value: T) => (asynchronous ? Promise.resolve(value) : value);
  return {
    data,
    getItem: (key) => settle(data.get(key) ?? null),
    setItem: (key, value) => settle(void data.set(key, value)),
    removeItem: (key) => settle(void data.delete(key)),
  };
}

function Harness(props: { session: EditorSession; loaded: boolean; store: DraftStore }) {
  useDraft(LIST, props.session, props.loaded, props.store);
  return null;
}

async function render(root: ReturnType<typeof createRoot>, props: Parameters<typeof Harness>[0]) {
  await act(async () => {
    root.render(createElement(Harness, props));
  });
  // Writes go through a promise so a synchronous and an asynchronous store
  // behave alike; let them settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useDraft", () => {
  /**
   * Before the load finishes the session is a placeholder, and the stored draft
   * is exactly what the load is about to read. Writing here would destroy it.
   */
  it("touches nothing until the list has loaded", async () => {
    const store = memoryStore();
    store.data.set(draftKey(LIST), "kept from last time");
    const root = createRoot(document.createElement("div"));
    const edited = applyAction(createSession(doc(), null), { type: "meta/set", patch: { title: "x" } }, NOW);

    await render(root, { session: edited, loaded: false, store });
    expect(store.data.get(draftKey(LIST))).toBe("kept from last time");
  });

  it.each([false, true])("keeps unsaved edits once loaded (asynchronous store: %s)", async (asynchronous) => {
    const store = memoryStore(asynchronous);
    const root = createRoot(document.createElement("div"));
    const server = reduce(doc(), { type: "meta/set", patch: { title: "on server" } }, NOW);
    const edited = applyAction(createSession(server, server.revision), { type: "meta/set", patch: { title: "mine" } }, NOW);

    await render(root, { session: edited, loaded: true, store });

    const kept = JSON.parse(store.data.get(draftKey(LIST))!) as { doc: TierList; baseRevision: number };
    expect(kept.doc.title).toBe("mine");
    expect(kept.baseRevision).toBe(server.revision);
  });

  it("drops the draft once the server acknowledges the edits", async () => {
    const store = memoryStore();
    const root = createRoot(document.createElement("div"));
    const edited = applyAction(createSession(doc(), doc().revision), { type: "meta/set", patch: { title: "mine" } }, NOW);

    await render(root, { session: edited, loaded: true, store });
    expect(store.data.has(draftKey(LIST))).toBe(true);

    const acknowledged = saveSucceeded(saveStarted(edited), edited.doc.revision);
    await render(root, { session: acknowledged, loaded: true, store });
    expect(store.data.has(draftKey(LIST))).toBe(false);
  });

  it("keeps editing when the store refuses to write", async () => {
    const store: DraftStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => Promise.reject(new Error("blocked")),
    };
    const root = createRoot(document.createElement("div"));
    const edited = applyAction(createSession(doc(), 0), { type: "meta/set", patch: { title: "x" } }, NOW);

    await expect(render(root, { session: edited, loaded: true, store })).resolves.toBeUndefined();
  });
});

describe("readDraft", () => {
  const good = () => ({ doc: reduce(doc(), { type: "meta/set", patch: { title: "mine" } }, NOW), baseRevision: 0 });

  it("returns what was kept", async () => {
    const store = memoryStore(true);
    store.data.set(draftKey(LIST), JSON.stringify(good()));
    await expect(readDraft(store, LIST)).resolves.toEqual(good());
  });

  it("returns null when there is nothing kept or no store", async () => {
    await expect(readDraft(memoryStore(), LIST)).resolves.toBeNull();
    await expect(readDraft(null, LIST)).resolves.toBeNull();
  });

  /** A kept draft is untrusted input: anything that fails the document's own checks is no draft. */
  it.each([
    ["text that is not JSON", "{not json"],
    ["a document that fails validation", JSON.stringify({ ...good(), doc: { ...good().doc, rows: "nope" } })],
    ["a negative base revision", JSON.stringify({ ...good(), baseRevision: -1 })],
    ["a fractional base revision", JSON.stringify({ ...good(), baseRevision: 1.5 })],
    ["a missing base revision", JSON.stringify({ doc: good().doc })],
  ])("returns null for %s", async (_name, text) => {
    const store = memoryStore();
    store.data.set(draftKey(LIST), text);
    await expect(readDraft(store, LIST)).resolves.toBeNull();
  });

  it("keeps a draft for a list the server never held", async () => {
    const store = memoryStore();
    store.data.set(draftKey(LIST), JSON.stringify({ ...good(), baseRevision: null }));
    await expect(readDraft(store, LIST)).resolves.toMatchObject({ baseRevision: null });
  });

  it("returns null when the store itself fails", async () => {
    const store: DraftStore = {
      getItem: () => Promise.reject(new Error("unavailable")),
      setItem: () => {},
      removeItem: () => {},
    };
    await expect(readDraft(store, LIST)).resolves.toBeNull();
  });
});
