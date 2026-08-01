import { createTierList, type TierList, type TierListAction } from "@tl/core";
import { describe, expect, it } from "vitest";
import { canRedo, canUndo } from "../src/history";
import {
  applyAction,
  createSession,
  pendingWrite,
  redoSession,
  saveFailed,
  saveStarted,
  saveSucceeded,
  undoSession,
  type EditorSession,
} from "../src/session";

const T0 = "2026-08-01T12:00:00.000Z";
const T1 = "2026-08-01T12:00:01.000Z";

function base(): TierList {
  return createTierList({ id: "list-1", now: T0 });
}

/** A session whose document the server already holds. */
function saved(): EditorSession {
  return createSession(base(), base().revision);
}

const RENAME = { type: "meta/set", patch: { title: "Ramen" } } as const;

describe("applyAction", () => {
  it("applies the action and advances the revision", () => {
    const next = applyAction(saved(), RENAME, T1);
    expect(next.doc.title).toBe("Ramen");
    expect(next.doc.revision).toBe(base().revision + 1);
  });

  it("records history so the edit can be undone", () => {
    const next = applyAction(saved(), RENAME, T1);
    expect(next.canUndo).toBe(true);
    expect(next.canRedo).toBe(false);
  });

  it("returns the same session for a no-op, recording nothing", () => {
    const session = saved();
    const next = applyAction(session, { type: "row/rename", rowId: "nope", label: "x" }, T1);
    expect(next).toBe(session);
    expect(next.canUndo).toBe(false);
  });

  it("coalesces continuous edits into one undo step", () => {
    let session = saved();
    for (const title of ["R", "Ra", "Ram"]) {
      session = applyAction(session, { type: "meta/set", patch: { title } }, T1);
    }
    const undone = undoSession(session, T1);
    expect(undone.doc.title).toBe("Untitled tier list");
    expect(undone.canUndo).toBe(false);
  });

  it("keeps structural edits as separate undo steps", () => {
    let session = saved();
    session = applyAction(session, { type: "item/addText", id: "i0", label: "a" }, T1);
    session = applyAction(session, { type: "item/addText", id: "i1", label: "b" }, T1);
    expect(undoSession(session, T1).doc.items).toHaveLength(1);
  });
});

describe("undo and redo", () => {
  it("does nothing when there is nothing to undo", () => {
    const session = saved();
    expect(undoSession(session, T1)).toBe(session);
    expect(redoSession(session, T1)).toBe(session);
  });

  it("moves the revision forwards on undo, never backwards", () => {
    const edited = applyAction(saved(), RENAME, T1);
    const undone = undoSession(edited, T1);
    expect(undone.doc.revision).toBe(edited.doc.revision + 1);
    expect(undone.doc.title).toBe("Untitled tier list");
  });

  it("makes an undone edit redoable, and a redone one undoable again", () => {
    const undone = undoSession(applyAction(saved(), RENAME, T1), T1);
    expect(undone.canRedo).toBe(true);
    const redone = redoSession(undone, T1);
    expect(redone.doc.title).toBe("Ramen");
    expect(redone.canUndo).toBe(true);
  });

  it("leaves the document dirty after an undo, because undo is an edit", () => {
    const undone = undoSession(applyAction(saved(), RENAME, T1), T1);
    expect(pendingWrite(undone)).not.toBeNull();
  });

  /**
   * Beyond the plan, and not a refinement of the test above — a different
   * defect. Losing `syncedRevision` across undo leaves the write above
   * non-null, so that test passes, but it is now a *create*: the transport
   * would PUT a document the server already holds, the API's create is
   * deliberately not an upsert, and the 409 wedges the session for good. Undo
   * must not change who the server thinks it is talking to.
   */
  it("still knows which revision the server holds after an undo", () => {
    const undone = undoSession(applyAction(saved(), RENAME, T1), T1);
    expect(pendingWrite(undone)).toEqual({
      kind: "update",
      doc: undone.doc,
      expectedRevision: base().revision,
    });
  });

  it("still knows which revision the server holds after a redo", () => {
    const redone = redoSession(undoSession(applyAction(saved(), RENAME, T1), T1), T1);
    expect(pendingWrite(redone)).toEqual({
      kind: "update",
      doc: redone.doc,
      expectedRevision: base().revision,
    });
  });
});

describe("pendingWrite", () => {
  it("is null when the server already holds this revision", () => {
    expect(pendingWrite(saved())).toBeNull();
  });

  it("asks for a create when the server has never seen the document", () => {
    const fresh = createSession(base(), null);
    expect(pendingWrite(fresh)).toMatchObject({ kind: "create" });
  });

  it("asks for an update carrying the revision the server holds", () => {
    const edited = applyAction(saved(), RENAME, T1);
    expect(pendingWrite(edited)).toEqual({
      kind: "update",
      doc: edited.doc,
      expectedRevision: base().revision,
    });
  });

  it("is null while a save is already in flight, so two do not race", () => {
    const edited = applyAction(saved(), RENAME, T1);
    expect(pendingWrite(saveStarted(edited))).toBeNull();
  });

  it("is null after a conflict, because retrying would clobber the other writer", () => {
    const edited = applyAction(saved(), RENAME, T1);
    expect(pendingWrite(saveFailed(saveStarted(edited), "conflict"))).toBeNull();
  });

  it("asks again after a transient failure", () => {
    const edited = applyAction(saved(), RENAME, T1);
    const failed = saveFailed(saveStarted(edited), "offline");
    expect(pendingWrite(failed)).not.toBeNull();
  });

  /**
   * Beyond the plan, and the same defect as the one guarded after undo: asking
   * *again* is not enough, it has to ask for the same thing. A round trip
   * through `saveStarted` and `saveFailed` that lost `syncedRevision` would
   * still be non-null above, but would retry a dropped request as a create —
   * PUT against a document the server already holds, which the API refuses.
   */
  it("retries a transient failure as the same update, not as a create", () => {
    const edited = applyAction(saved(), RENAME, T1);
    const failed = saveFailed(saveStarted(edited), "offline");
    expect(pendingWrite(failed)).toEqual({
      kind: "update",
      doc: edited.doc,
      expectedRevision: base().revision,
    });
  });
});

describe("save outcomes", () => {
  it("goes clean when the acknowledged revision is the current one", () => {
    const edited = applyAction(saved(), RENAME, T1);
    const done = saveSucceeded(saveStarted(edited), edited.doc.revision);
    expect(done.status).toBe("saved");
    expect(pendingWrite(done)).toBeNull();
  });

  it("stays dirty when the user edited while the save was in flight", () => {
    const edited = applyAction(saved(), RENAME, T1);
    const inFlight = saveStarted(edited);
    const editedAgain = applyAction(inFlight, { type: "item/addText", id: "i9", label: "z" }, T1);

    // The server acknowledged the *older* revision.
    const done = saveSucceeded(editedAgain, edited.doc.revision);

    const next = pendingWrite(done);
    expect(next).not.toBeNull();
    expect(next).toMatchObject({ kind: "update", expectedRevision: edited.doc.revision });
  });

  it("reports a conflict distinctly from any other failure", () => {
    const edited = applyAction(saved(), RENAME, T1);
    expect(saveFailed(saveStarted(edited), "conflict").status).toBe("conflict");
    expect(saveFailed(saveStarted(edited), "offline").status).toBe("error");
  });

  it("stops asking for a write once a conflict is reported", () => {
    const edited = applyAction(saved(), RENAME, T1);
    const conflicted = saveFailed(saveStarted(edited), "conflict");
    const editedAgain = applyAction(conflicted, { type: "item/addText", id: "i9", label: "z" }, T1);
    expect(pendingWrite(editedAgain)).toBeNull();
  });

  it("switches from create to update once the server has acknowledged one write", () => {
    const fresh = createSession(base(), null);
    const done = saveSucceeded(saveStarted(fresh), base().revision);
    const edited = applyAction(done, RENAME, T1);
    expect(pendingWrite(edited)).toMatchObject({ kind: "update" });
  });
});

// ---------------------------------------------------------------------------
// Beyond the plan. Each of these covers a transition the plan's own tests leave
// unobserved, and every one of them was reachable by mutating session.ts
// without a single test above going red.
// ---------------------------------------------------------------------------

describe("an edit while a write is in flight", () => {
  /**
   * `saving` must survive every edit path, not just `applyAction`. Dropping it
   * would let the next render fire a second write for the same
   * `expectedRevision` — the exact race `pendingWrite` returns null to prevent.
   */
  it("keeps saving through an undo", () => {
    const inFlight = saveStarted(applyAction(saved(), RENAME, T1));
    const undone = undoSession(inFlight, T1);
    expect(undone.status).toBe("saving");
    expect(pendingWrite(undone)).toBeNull();
  });

  it("keeps saving through a redo", () => {
    const undone = undoSession(applyAction(saved(), RENAME, T1), T1);
    const inFlight = saveStarted(undone);
    const redone = redoSession(inFlight, T1);
    expect(redone.status).toBe("saving");
    expect(pendingWrite(redone)).toBeNull();
  });

  it("still asks for the newer revision once the older write lands", () => {
    const edited = applyAction(saved(), RENAME, T1);
    const undone = undoSession(saveStarted(edited), T1);
    const done = saveSucceeded(undone, edited.doc.revision);
    expect(done.status).toBe("dirty");
    expect(pendingWrite(done)).toMatchObject({
      kind: "update",
      expectedRevision: edited.doc.revision,
    });
  });
});

describe("a conflict is sticky", () => {
  function conflicted(): EditorSession {
    return saveFailed(saveStarted(applyAction(saved(), RENAME, T1)), "conflict");
  }

  it("survives an edit", () => {
    const next = applyAction(conflicted(), { type: "item/addText", id: "i9", label: "z" }, T1);
    expect(next.status).toBe("conflict");
  });

  it("survives an undo, which is also an edit", () => {
    const undone = undoSession(conflicted(), T1);
    expect(undone.status).toBe("conflict");
    expect(pendingWrite(undone)).toBeNull();
  });

  it("survives a redo", () => {
    const redone = redoSession(undoSession(conflicted(), T1), T1);
    expect(redone.status).toBe("conflict");
    expect(pendingWrite(redone)).toBeNull();
  });
});

describe("createSession", () => {
  /**
   * `pendingWrite` alone cannot see this: it answers null for a matching
   * revision whatever the status says, so a session that opened a saved
   * document but called itself dirty would behave correctly and only *read*
   * wrong — a toolbar stuck on "unsaved changes" with nothing to save.
   */
  it("starts saved when the server already holds this revision", () => {
    expect(saved().status).toBe("saved");
  });

  it("starts dirty when the server holds an older revision", () => {
    const edited = applyAction(saved(), RENAME, T1);
    const reopened = createSession(edited.doc, base().revision);
    expect(reopened.status).toBe("dirty");
    expect(reopened.canUndo).toBe(false);
    expect(reopened.canRedo).toBe(false);
  });

  /**
   * Not reachable through this module — `saveSucceeded` is only ever handed a
   * revision the document already passed through — but pinned so the behaviour
   * is a decision rather than an accident. "dirty" is the honest answer: the
   * two numbers disagree, so the document is not known to be saved.
   */
  it("calls a synced revision ahead of the document dirty, not saved", () => {
    const impossible = createSession(base(), base().revision + 5);
    expect(impossible.status).toBe("dirty");
  });
});

describe("canUndo and canRedo cannot drift from the history", () => {
  it("agrees with the history after every transition of a long random session", () => {
    // A tiny deterministic PRNG: reproducible, and no dependency.
    let seed = 0x2f6e2b1;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const pick = (n: number) => next() % n;

    const actions: TierListAction[] = [
      { type: "meta/set", patch: { title: "a" } },
      { type: "meta/set", patch: { title: "b" } },
      { type: "item/addText", id: "x", label: "x" },
      { type: "row/rename", rowId: "list-1-row-0", label: "S+" },
      { type: "row/rename", rowId: "ghost", label: "no-op" },
    ];

    let session = createSession(base(), 0);
    let itemId = 0;

    for (let step = 0; step < 400; step += 1) {
      const roll = pick(10);
      if (roll < 6) {
        const action = actions[pick(actions.length)]!;
        session = applyAction(
          session,
          action.type === "item/addText" ? { ...action, id: `i${itemId++}` } : action,
          T1,
        );
      } else if (roll < 8) {
        session = undoSession(session, T1);
      } else {
        session = redoSession(session, T1);
      }

      expect(session.canUndo).toBe(canUndo(session.history));
      expect(session.canRedo).toBe(canRedo(session.history));
    }

    // The walk must actually have exercised both stacks, or it proves nothing.
    expect(session.history.past.length + session.history.future.length).toBeGreaterThan(0);
  });
});
