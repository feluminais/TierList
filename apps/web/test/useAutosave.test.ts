import { ApiError, type Client } from "@tl/api-client";
import { createTierList, type TierList, type TierListAction } from "@tl/core";
import {
  applyAction,
  createSession,
  saveFailed,
  saveStarted,
  saveSucceeded,
  type EditorSession,
} from "@tl/editor-core";
import { act, createElement, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  useAutosave,
  type AutosaveHandlers,
  type AutosaveTimings,
} from "../app/editor/useAutosave";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Generous relative to the waits below, because these are real timers on a
 * machine that may be busy. The ratio is what matters: a burst is entered well
 * inside DEBOUNCE, and RETRY is far enough past DEBOUNCE that "did it retry
 * early" is answerable.
 */
const DEBOUNCE = 150;
const RETRY = 500;
const TIMINGS: AutosaveTimings = { debounceMs: DEBOUNCE, retryMs: RETRY };

let tick = 0;
function clock(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 7, 1, 12, 0, tick)).toISOString();
}

function baseDoc(): TierList {
  return createTierList({ id: "list-1", now: "2026-08-01T12:00:00.000Z" });
}

const RENAME: TierListAction = { type: "meta/set", patch: { title: "Ramen" } };

/** A request the fake client has issued and is holding open. */
interface Pending {
  kind: "create" | "update";
  doc: TierList;
  expectedRevision?: number;
  resolve: (revision: number) => void;
  reject: (error: unknown) => void;
}

function fakeClient(): { client: Client; calls: Pending[] } {
  const calls: Pending[] = [];
  const hold = (
    kind: Pending["kind"],
    doc: TierList,
    expectedRevision?: number,
  ) =>
    new Promise<{ id: string; revision: number }>((resolve, reject) => {
      calls.push({
        kind,
        doc,
        expectedRevision,
        resolve: (revision) => resolve({ id: doc.id, revision }),
        reject,
      });
    });

  const client: Client = {
    mintToken: () => Promise.reject(new Error("not used here")),
    getList: () => Promise.resolve(null),
    listMine: () => Promise.resolve([]),
    createList: (doc) => hold("create", doc),
    updateList: (doc, expectedRevision) => hold("update", doc, expectedRevision),
    uploadAsset: () => Promise.reject(new Error("not used here")),
    shareList: () => Promise.reject(new Error("not used here")),
    getShare: () => Promise.resolve(null),
    assetUrl: () => {
      throw new Error("not used here");
    },
  };
  return { client, calls };
}

/** Everything the test can see or do from outside the component. */
interface Probe {
  session: EditorSession;
  renders: number;
  acknowledged: number[];
  failures: string[];
  edit: (action: TierListAction) => void;
  bump: () => void;
}

interface HarnessProps {
  probe: Probe;
  client: Client | null;
  initial: EditorSession;
}

function Harness({ probe, client, initial }: HarnessProps) {
  const [session, setSession] = useState(initial);
  // A state nothing in the save policy reads, so a test can force a re-render
  // that must not disturb the debounce.
  const [, setNoise] = useState(0);

  const handlers = useMemo<AutosaveHandlers>(
    () => ({
      onSaveStarted: () => setSession((s) => saveStarted(s)),
      onSaveSucceeded: (revision) => {
        probe.acknowledged.push(revision);
        setSession((s) => saveSucceeded(s, revision));
      },
      onSaveFailed: (failure) => {
        probe.failures.push(failure);
        setSession((s) => saveFailed(s, failure));
      },
    }),
    [probe],
  );

  useAutosave(session, client, handlers, TIMINGS);

  probe.session = session;
  probe.renders += 1;
  probe.edit = (action) => setSession((s) => applyAction(s, action, clock()));
  probe.bump = () => setNoise((n) => n + 1);
  return null;
}

async function mount(options: {
  client?: Client | null;
  initial?: EditorSession;
}) {
  const probe: Probe = {
    session: null as unknown as EditorSession,
    renders: 0,
    acknowledged: [],
    failures: [],
    edit: () => {},
    bump: () => {},
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const initial = options.initial ?? synced();
  await act(async () => {
    root.render(
      createElement(Harness, {
        probe,
        client: options.client ?? null,
        initial,
      }),
    );
  });

  return {
    probe,
    unmount: async () => {
      await act(async () => root.unmount());
    },
  };
}

/** A session the server already holds, so nothing is pending at mount. */
function synced(): EditorSession {
  const doc = baseDoc();
  return createSession(doc, doc.revision);
}

/** Let real time pass with React's work loop flushing throughout. */
async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Drain microtasks (a settled request) plus one macrotask. */
const flush = () => wait(0);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useAutosave", () => {
  it("issues nothing for a session the server already holds", async () => {
    const { client, calls } = fakeClient();
    await mount({ client });
    await wait(DEBOUNCE * 2);
    expect(calls).toHaveLength(0);
  });

  it("issues nothing at all without a client", async () => {
    const { probe } = await mount({ client: null });
    await act(async () => probe.edit(RENAME));
    await wait(DEBOUNCE * 2);
    expect(probe.session.status).toBe("dirty");
  });

  it("collapses a burst of edits into one request carrying the newest document", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({ client });

    for (const title of ["R", "Ra", "Ram", "Ramen"]) {
      await act(async () => probe.edit({ type: "meta/set", patch: { title } }));
      await flush();
    }
    expect(calls).toHaveLength(0);

    await wait(DEBOUNCE * 2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.doc.title).toBe("Ramen");
    expect(calls[0]?.expectedRevision).toBe(baseDoc().revision);
  });

  /**
   * The regression test for the defect this hook was rewritten around.
   *
   * Starting a save is itself what makes `pendingWrite` return null, so the
   * effect that issued the request is torn down immediately afterwards. A
   * per-run `cancelled` flag set in that cleanup silences the request's own
   * handlers: `saveSucceeded` never runs, `status` stays `saving` forever, and
   * autosave dies on the first write without a single visible symptom.
   */
  it("reports an outcome even though starting the save tore its own effect down", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({ client });

    await act(async () => probe.edit(RENAME));
    await wait(DEBOUNCE * 2);
    expect(calls).toHaveLength(1);
    expect(probe.session.status).toBe("saving");

    const sent = calls[0]!.doc.revision;
    await act(async () => calls[0]!.resolve(sent));
    await flush();

    expect(probe.acknowledged).toEqual([sent]);
    expect(probe.session.status).toBe("saved");
    expect(probe.session.syncedRevision).toBe(sent);
  });

  it("keeps saving after the first save, rather than wedging", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({ client });

    await act(async () => probe.edit(RENAME));
    await wait(DEBOUNCE * 2);
    await act(async () => calls[0]!.resolve(calls[0]!.doc.revision));
    await flush();

    await act(async () =>
      probe.edit({ type: "item/addText", id: "i1", label: "Udon" }),
    );
    await wait(DEBOUNCE * 2);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.expectedRevision).toBe(calls[0]!.doc.revision);
  });

  it("completes a request an edit landed during, then saves again", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({ client });

    await act(async () => probe.edit(RENAME));
    await wait(DEBOUNCE * 2);
    const sent = calls[0]!.doc.revision;

    await act(async () =>
      probe.edit({ type: "item/addText", id: "i1", label: "Udon" }),
    );
    // The write already sent is still outstanding; nothing new may be issued.
    expect(probe.session.status).toBe("saving");
    expect(calls).toHaveLength(1);

    await act(async () => calls[0]!.resolve(sent));
    await flush();
    // The server acknowledged the older revision, so the document is dirty again.
    expect(probe.session.status).toBe("dirty");

    await wait(DEBOUNCE * 2);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.expectedRevision).toBe(sent);
    expect(calls[1]?.doc.revision).toBe(sent + 1);
  });

  it("says nothing once unmounted", async () => {
    const { client, calls } = fakeClient();
    const { probe, unmount } = await mount({ client });

    await act(async () => probe.edit(RENAME));
    await wait(DEBOUNCE * 2);
    expect(calls).toHaveLength(1);

    await unmount();
    await act(async () => calls[0]!.resolve(calls[0]!.doc.revision));
    await flush();

    expect(probe.acknowledged).toEqual([]);
    expect(probe.failures).toEqual([]);
  });

  it("stops for good on a conflict", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({ client });

    await act(async () => probe.edit(RENAME));
    await wait(DEBOUNCE * 2);
    await act(async () => calls[0]!.reject(new ApiError(409, "conflict")));
    await flush();

    expect(probe.failures).toEqual(["conflict"]);
    expect(probe.session.status).toBe("conflict");

    await act(async () =>
      probe.edit({ type: "item/addText", id: "i1", label: "Udon" }),
    );
    await wait(RETRY * 1.5);
    expect(calls).toHaveLength(1);
  });

  it("retries a transient failure, but not at the debounce interval", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({ client });

    await act(async () => probe.edit(RENAME));
    await wait(DEBOUNCE * 2);
    await act(async () => calls[0]!.reject(new ApiError(500, "boom")));
    await flush();

    expect(probe.failures).toEqual(["offline"]);
    expect(probe.session.status).toBe("error");

    await wait(DEBOUNCE * 1.5);
    expect(calls).toHaveLength(1);

    await wait(RETRY);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.expectedRevision).toBe(calls[0]!.expectedRevision);
  });

  it("is not restarted by re-renders that cannot affect the write", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({ client });

    await act(async () => probe.edit(RENAME));
    // Re-render steadily for longer than the debounce. Keying the effect on the
    // object `pendingWrite` returns — a fresh object every render — would push
    // the deadline back every time and the document would never save.
    for (let i = 0; i < 8; i += 1) {
      await wait(DEBOUNCE / 4);
      await act(async () => probe.bump());
    }
    expect(probe.renders).toBeGreaterThan(8);
    expect(calls).toHaveLength(1);
  });

  it("is not restarted by an edit that changed nothing", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({ client });

    await act(async () => probe.edit(RENAME));
    const edited = probe.session;

    await wait(DEBOUNCE * 0.6);
    await act(async () =>
      // No such row, so `reduce` returns the same document and `applyAction`
      // the same session.
      probe.edit({ type: "row/rename", rowId: "nope", label: "x" }),
    );
    expect(probe.session).toBe(edited);

    await wait(DEBOUNCE * 0.6);
    expect(calls).toHaveLength(1);
  });

  it("creates before it updates, for a document the server has never seen", async () => {
    const { client, calls } = fakeClient();
    const { probe } = await mount({
      client,
      initial: createSession(baseDoc(), null),
    });

    await wait(DEBOUNCE * 2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("create");

    await act(async () => calls[0]!.resolve(calls[0]!.doc.revision));
    await flush();
    await act(async () => probe.edit(RENAME));
    await wait(DEBOUNCE * 2);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.kind).toBe("update");
  });
});
