import {
  createTierList,
  DOCUMENT_LIMITS,
  reduce,
  validateDocument,
  type TierList,
  type TierListAction,
} from "@tl/core";
import { describe, expect, it } from "vitest";
import { canRedo, canUndo } from "../src/history";
import {
  applyAction,
  applyActions,
  createSession,
  pendingWrite,
  redoSession,
  resumeSession,
  saveFailed,
  saveStarted,
  saveSucceeded,
  undoSession,
  unsyncedDraft,
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

/**
 * The tier corner grip is what this exists for: one diagonal drag changes a
 * row's tile size *and* the width of the label column, which are two settings
 * and so two actions, but one thing the user did.
 */
describe("applyActions", () => {
  const ROW = () => base().rows[2]!.id;

  /** Deliberately not the same value on both axes, and not the defaults. */
  function resize(rowId: string, labelWidth: number, tileSize: number): TierListAction[] {
    return [
      { type: "display/set", patch: { labelWidth } },
      { type: "row/setTileSize", rowId, tileSize },
    ];
  }

  it("applies every action in the batch", () => {
    const next = applyActions(saved(), resize(ROW(), 180, 140), T1);
    expect(next.doc.display.labelWidth).toBe(180);
    expect(next.doc.rows[2]!.tileSizeOverride).toBe(140);
  });

  it("is one undo step, and undoes both halves together", () => {
    const before = saved();
    const next = applyActions(before, resize(ROW(), 180, 140), T1);
    const undone = undoSession(next, T1);

    expect(undone.doc.display.labelWidth).toBe(before.doc.display.labelWidth);
    expect(undone.doc.rows[2]!.tileSizeOverride).toBe(before.doc.rows[2]!.tileSizeOverride);
    // Nothing left behind: one press of undo returns to where it started.
    expect(canUndo(undone.history)).toBe(false);
  });

  /**
   * A drag is a run of identical batches, one per frame. They have to coalesce
   * into a single step, exactly as a run of one continuous action does —
   * otherwise a two-second drag buries the user's earlier work under a hundred
   * undo steps and, past the history limit, throws it away.
   */
  it("coalesces a run of matching batches into one step", () => {
    let session = saved();
    for (let frame = 0; frame < 20; frame += 1) {
      session = applyActions(session, resize(ROW(), 130 + frame, 100 + frame), T1);
    }
    expect(session.doc.display.labelWidth).toBe(149);

    const undone = undoSession(session, T1);
    expect(undone.doc.display.labelWidth).toBe(base().display.labelWidth);
    expect(canUndo(undone.history)).toBe(false);
  });

  /**
   * The merge key names the actions, so a batch of *different* actions is a
   * different step. Merging them would lose one of the two edits on undo.
   */
  it("does not merge a batch into an unrelated one", () => {
    let session = applyActions(saved(), resize(ROW(), 180, 140), T1);
    session = applyActions(
      session,
      [
        { type: "row/rename", rowId: ROW(), label: "God" },
        { type: "row/recolor", rowId: ROW(), color: "#ff0000" },
      ],
      T1,
    );

    const undone = undoSession(session, T1);
    // The rename and recolour are gone; the resize is still there.
    expect(undone.doc.rows[2]!.label).toBe(base().rows[2]!.label);
    expect(undone.doc.display.labelWidth).toBe(180);
  });

  /**
   * The key names *every* action, not just the first.
   *
   * Resizing one tier and then another produces two batches that start with the
   * same `display/set` and differ only in which row the second action names. A
   * key taken from the first action alone would call those the same gesture and
   * merge them, so one undo would jump back past both — losing a resize the
   * user never asked to lose.
   */
  it("keeps two batches apart when only their later actions differ", () => {
    const rowA = base().rows[2]!.id;
    const rowB = base().rows[4]!.id;

    let session = applyActions(saved(), resize(rowA, 180, 140), T1);
    session = applyActions(session, resize(rowB, 190, 150), T1);

    const undone = undoSession(session, T1);
    expect(undone.doc.rows[4]!.tileSizeOverride).toBeUndefined();
    // Back to after the *first* resize, not back to the beginning.
    expect(undone.doc.rows[2]!.tileSizeOverride).toBe(140);
    expect(undone.doc.display.labelWidth).toBe(180);
  });

  /**
   * A discrete choice inside the batch makes the whole batch discrete, for the
   * reason `mergeKeyFor` gives: merging two discrete choices loses one of them.
   */
  it("refuses to merge a batch containing a discrete action", () => {
    let session = saved();
    session = applyActions(
      session,
      [{ type: "row/setBold", rowId: ROW(), bold: true }],
      T1,
    );
    session = applyActions(
      session,
      [{ type: "row/setBold", rowId: ROW(), bold: false }],
      T1,
    );

    // Two steps, not one: undoing once puts the switch back on rather than
    // jumping past both flips to where it started.
    expect(undoSession(session, T1).doc.rows[2]!.bold).toBe(true);
  });

  it("returns the same session when nothing in the batch changed", () => {
    const session = saved();
    const next = applyActions(
      session,
      [
        { type: "row/rename", rowId: "nope", label: "x" },
        { type: "row/recolor", rowId: "nope", color: "#fff" },
      ],
      T1,
    );
    expect(next).toBe(session);
  });

  /**
   * A batch is not all-or-nothing. One axis of a resize hitting its clamp — so
   * emitting the value it already has — must not stop the other axis moving.
   */
  it("applies the rest when one action is a no-op", () => {
    const next = applyActions(
      saved(),
      [
        { type: "row/rename", rowId: "nope", label: "x" },
        { type: "display/set", patch: { labelWidth: 180 } },
      ],
      T1,
    );
    expect(next.doc.display.labelWidth).toBe(180);
    // One revision for the batch, not one per action that landed.
    expect(next.doc.revision).toBe(base().revision + 1);
  });

  it("leaves an empty batch alone", () => {
    const session = saved();
    expect(applyActions(session, [], T1)).toBe(session);
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

describe("a refused write is sticky", () => {
  function refused(): EditorSession {
    return saveFailed(saveStarted(applyAction(saved(), RENAME, T1)), "rejected");
  }

  it("reports its own status, distinct from a conflict and from a transient failure", () => {
    expect(refused().status).toBe("rejected");
  });

  it("stops asking for a write, because the same document would be refused again", () => {
    expect(pendingWrite(refused())).toBeNull();
  });

  it("survives an edit, an undo and a redo", () => {
    const edited = applyAction(refused(), { type: "item/addText", id: "i9", label: "z" }, T1);
    expect(edited.status).toBe("rejected");
    const undone = undoSession(refused(), T1);
    expect(undone.status).toBe("rejected");
    expect(redoSession(undone, T1).status).toBe("rejected");
    expect(pendingWrite(edited)).toBeNull();
  });

  it("still keeps the unsaved edits as a draft", () => {
    expect(unsyncedDraft(refused())).toMatchObject({ baseRevision: base().revision });
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

/**
 * Revisions here are deliberately unequal — a stored list at 9, a draft made on
 * top of 5 and carrying 7 — so a resolver that compared the wrong pair of
 * numbers cannot land on the right answer by coincidence.
 */
describe("drafts", () => {
  const FORK = { id: "fork-1", now: "2026-09-28T09:00:00.000Z" };

  /** A list at `revision`, whose content differs for every revision. */
  function at(revision: number, title = `rev ${revision}`): TierList {
    let doc = base();
    doc = reduce(doc, { type: "meta/set", patch: { title } }, T1);
    for (let r = doc.revision; r < revision; r += 1) {
      doc = reduce(doc, { type: "item/addText", id: `i${r}`, label: `item ${r}` }, T1);
    }
    return doc;
  }

  describe("unsyncedDraft", () => {
    it("keeps nothing while the server holds the document", () => {
      expect(unsyncedDraft(createSession(at(5), 5))).toBeNull();
    });

    it("keeps nothing for a new list nobody has edited", () => {
      expect(unsyncedDraft(createSession(base(), null))).toBeNull();
    });

    it("keeps a new list once it has been edited", () => {
      const session = applyAction(createSession(base(), null), RENAME, T1);
      expect(unsyncedDraft(session)).toEqual({ doc: session.doc, baseRevision: null });
    });

    it("keeps edits made on top of what the server holds, naming that revision", () => {
      const session = createSession(at(7), 5);
      expect(unsyncedDraft(session)).toEqual({ doc: session.doc, baseRevision: 5 });
    });
  });

  describe("resumeSession", () => {
    it("opens the stored list when there is no draft", () => {
      const { session, recovered } = resumeSession(at(9), null, base(), FORK);
      expect(session.doc).toEqual(at(9));
      expect(session.status).toBe("saved");
      expect(recovered).toBeNull();
    });

    it("starts a new list when there is neither", () => {
      const { session } = resumeSession(null, null, base(), FORK);
      expect(pendingWrite(session)).toEqual({ kind: "create", doc: base() });
    });

    it("picks up edits made on top of exactly what the server holds", () => {
      const draft = { doc: at(7, "mine"), baseRevision: 5 };
      const { session, recovered } = resumeSession(at(5), draft, base(), FORK);

      expect(session.doc).toEqual(draft.doc);
      expect(pendingWrite(session)).toEqual({ kind: "update", doc: draft.doc, expectedRevision: 5 });
      expect(recovered).toBeNull();
    });

    it("recreates a list the server no longer has", () => {
      const draft = { doc: at(7, "mine"), baseRevision: 5 };
      const { session, recovered } = resumeSession(null, draft, base(), FORK);
      expect(pendingWrite(session)).toEqual({ kind: "create", doc: draft.doc });
      expect(recovered).toBeNull();
    });

    it("drops a draft that already reached the server, whatever order its keys are in", () => {
      const landed = at(7, "mine");
      const reordered = Object.fromEntries(Object.entries(landed).reverse()) as TierList;
      const { session, recovered } = resumeSession(reordered, { doc: landed, baseRevision: 5 }, base(), FORK);

      expect(session.status).toBe("saved");
      expect(pendingWrite(session)).toBeNull();
      expect(recovered).toBeNull();
    });

    it("keeps both versions when the list moved on without the draft", () => {
      const theirs = at(9, "theirs");
      const mine = at(7, "mine");
      const { session, recovered } = resumeSession(theirs, { doc: mine, baseRevision: 5 }, base(), FORK);

      expect(session.doc).toEqual(theirs);
      expect(session.status).toBe("saved");
      expect(recovered).toMatchObject({
        id: FORK.id,
        title: "mine (recovered)",
        revision: 0,
        createdAt: FORK.now,
        updatedAt: FORK.now,
        items: mine.items,
        placements: mine.placements,
      });
      expect(validateDocument(recovered)).toEqual([]);
    });

    it("keeps a recovered title within the document's limit", () => {
      const long = "x".repeat(DOCUMENT_LIMITS.titleLength);
      const { recovered } = resumeSession(at(9), { doc: at(7, long), baseRevision: 5 }, base(), FORK);

      expect(recovered!.title.length).toBe(DOCUMENT_LIMITS.titleLength);
      expect(recovered!.title.endsWith(" (recovered)")).toBe(true);
      expect(validateDocument(recovered)).toEqual([]);
    });

    it("ignores a draft for a different list", () => {
      const other = { ...at(7, "mine"), id: "someone-else" };
      const { session, recovered } = resumeSession(at(9), { doc: other, baseRevision: 5 }, base(), FORK);
      expect(session.doc).toEqual(at(9));
      expect(recovered).toBeNull();
    });
  });
});
