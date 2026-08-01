import { createTierList, reduce, type TierList } from "@tl/core";
import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  createHistory,
  mergeKeyFor,
  record,
  redo,
  undo,
  type History,
} from "../src/history";

const T0 = "2026-08-01T12:00:00.000Z";
const T1 = "2026-08-01T12:00:01.000Z";
const T2 = "2026-08-01T12:00:02.000Z";

function base(): TierList {
  return createTierList({ id: "list-1", now: T0 });
}

/** Everything undo is supposed to restore, with nothing it is supposed to move. */
function content(doc: TierList): Omit<TierList, "revision" | "updatedAt"> {
  const { revision: _r, updatedAt: _u, ...rest } = doc;
  return rest;
}

describe("record, undo and redo", () => {
  it("starts with nothing to undo or redo", () => {
    const history = createHistory();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history, base(), T1)).toBeNull();
    expect(redo(history, base(), T1)).toBeNull();
  });

  it("restores the previous content on undo", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    const history = record(createHistory(), before);

    const undone = undo(history, after, T2);
    expect(undone?.doc.title).toBe("Untitled tier list");
  });

  it("moves revision forwards on undo, never backwards", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    const history = record(createHistory(), before);

    const undone = undo(history, after, T2)!;
    expect(undone.doc.revision).toBe(after.revision + 1);
    expect(undone.doc.revision).toBeGreaterThan(before.revision);
    expect(undone.doc.updatedAt).toBe(T2);
  });

  it("moves revision forwards on redo too", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    const undone = undo(record(createHistory(), before), after, T2)!;
    const redone = redo(undone.history, undone.doc, T2)!;

    expect(redone.doc.title).toBe("Ramen");
    expect(redone.doc.revision).toBe(undone.doc.revision + 1);
  });

  it("never reuses a revision number across an undo and redo cycle", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);

    const undone = undo(record(createHistory(), before), after, T2)!;
    const redone = redo(undone.history, undone.doc, T2)!;

    const seen = [before.revision, after.revision, undone.doc.revision, redone.doc.revision];
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("restores every field but revision and updatedAt", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);

    const undone = undo(record(createHistory(), before), after, T2)!;
    expect(content(undone.doc)).toEqual(content(before));

    const redone = redo(undone.history, undone.doc, T2)!;
    expect(content(redone.doc)).toEqual(content(after));
  });

  it("keeps identity fields the reducer cannot change", () => {
    // No action can touch these -- `meta/set`'s patch type admits only title,
    // description, categoryId and tags -- so taking them from the snapshot is
    // the same as taking them from the current document. This test is what
    // notices if that ever stops being true.
    const before: TierList = { ...base(), templateId: "tpl-1", templateRevision: 3 };
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    const undone = undo(record(createHistory(), before), after, T2)!;

    expect(undone.doc.id).toBe("list-1");
    expect(undone.doc.createdAt).toBe(T0);
    expect(undone.doc.schemaVersion).toBe(before.schemaVersion);
    expect(undone.doc.templateId).toBe("tpl-1");
    expect(undone.doc.templateRevision).toBe(3);
  });

  it("walks back through several edits in order", () => {
    let doc = base();
    let history = createHistory();

    history = record(history, doc);
    doc = reduce(doc, { type: "meta/set", patch: { title: "one" } }, T1);
    history = record(history, doc);
    doc = reduce(doc, { type: "meta/set", patch: { title: "two" } }, T1);

    const first = undo(history, doc, T2)!;
    expect(first.doc.title).toBe("one");
    const second = undo(first.history, first.doc, T2)!;
    expect(second.doc.title).toBe("Untitled tier list");
    expect(undo(second.history, second.doc, T2)).toBeNull();
  });

  it("still offers redo once undo has run out", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    const undone = undo(record(createHistory(), before), after, T2)!;

    expect(canUndo(undone.history)).toBe(false);
    expect(undo(undone.history, undone.doc, T2)).toBeNull();
    expect(canRedo(undone.history)).toBe(true);
    expect(redo(undone.history, undone.doc, T2)).not.toBeNull();
  });

  it("redoes several edits back in the order they were made", () => {
    let doc = base();
    let history = createHistory();

    history = record(history, doc);
    doc = reduce(doc, { type: "meta/set", patch: { title: "one" } }, T1);
    history = record(history, doc);
    doc = reduce(doc, { type: "meta/set", patch: { title: "two" } }, T1);

    const back1 = undo(history, doc, T2)!;
    const back2 = undo(back1.history, back1.doc, T2)!;
    const fwd1 = redo(back2.history, back2.doc, T2)!;
    expect(fwd1.doc.title).toBe("one");
    const fwd2 = redo(fwd1.history, fwd1.doc, T2)!;
    expect(fwd2.doc.title).toBe("two");
    expect(redo(fwd2.history, fwd2.doc, T2)).toBeNull();
  });

  it("makes a redone step undoable again", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);

    const back = undo(record(createHistory(), before), after, T2)!;
    const forward = redo(back.history, back.doc, T2)!;

    expect(canUndo(forward.history)).toBe(true);
    const again = undo(forward.history, forward.doc, T2)!;
    expect(again.doc.title).toBe("Untitled tier list");
    expect(again.doc.revision).toBe(forward.doc.revision + 1);
    expect(canRedo(again.history)).toBe(true);
  });

  it("discards the redo stack when a new edit is recorded", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    const undone = undo(record(createHistory(), before), after, T2)!;
    expect(canRedo(undone.history)).toBe(true);

    const branched = record(undone.history, undone.doc);
    expect(canRedo(branched)).toBe(false);
  });

  it("undoes onto the new branch after a redo stack is abandoned", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    const undone = undo(record(createHistory(), before), after, T2)!;

    // A different edit from the one that was undone: the abandoned branch must
    // not come back on the next undo.
    const branched = record(undone.history, undone.doc);
    const other = reduce(undone.doc, { type: "meta/set", patch: { title: "Udon" } }, T2);

    const back = undo(branched, other, T2)!;
    expect(back.doc.title).toBe("Untitled tier list");
    expect(back.doc.revision).toBe(other.revision + 1);
  });

  it("treats the history values as immutable", () => {
    const before = base();
    const after = reduce(before, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    const history = record(createHistory(), before);
    const snapshot = JSON.stringify(history);

    const undone = undo(history, after, T2)!;
    redo(undone.history, undone.doc, T2);

    expect(JSON.stringify(history)).toBe(snapshot);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);
  });

  it("drops the oldest entry once the limit is reached", () => {
    let history = createHistory(2);
    let doc = base();

    for (const title of ["one", "two", "three"]) {
      history = record(history, doc);
      doc = reduce(doc, { type: "meta/set", patch: { title } }, T1);
    }

    const a = undo(history, doc, T2)!;
    const b = undo(a.history, a.doc, T2)!;
    expect(b.doc.title).toBe("one");
    expect(undo(b.history, b.doc, T2)).toBeNull();
  });

  it("records nothing at all when the limit is zero", () => {
    let history = createHistory(0);
    let doc = base();

    history = record(history, doc);
    doc = reduce(doc, { type: "meta/set", patch: { title: "Ramen" } }, T1);

    expect(canUndo(history)).toBe(false);
    expect(undo(history, doc, T2)).toBeNull();
  });

  it("keeps the redo stack bounded by the same limit", () => {
    // `future` has no limit of its own and needs none: undo and redo only move
    // entries between the two stacks, and every record clears `future` and
    // trims `past`, so the pair can never together exceed the limit.
    let history = createHistory(2);
    let doc = base();

    for (const title of ["one", "two", "three", "four"]) {
      history = record(history, doc);
      doc = reduce(doc, { type: "meta/set", patch: { title } }, T1);
    }

    let steps = 0;
    for (;;) {
      const step = undo(history, doc, T2);
      if (!step) break;
      history = step.history;
      doc = step.doc;
      steps += 1;
      expect(steps).toBeLessThanOrEqual(2);
    }
    expect(steps).toBe(2);
    expect(history.future).toHaveLength(2);
  });
});

describe("coalescing", () => {
  it("collapses consecutive edits that share a merge key into one step", () => {
    let doc = base();
    let history = createHistory();

    for (const title of ["R", "Ra", "Ram"]) {
      history = record(history, doc, "meta/title");
      doc = reduce(doc, { type: "meta/set", patch: { title } }, T1);
    }

    const undone = undo(history, doc, T2)!;
    expect(undone.doc.title).toBe("Untitled tier list");
    expect(canUndo(undone.history)).toBe(false);
  });

  it("keeps edits with different merge keys as separate steps", () => {
    let doc = base();
    let history = createHistory();

    history = record(history, doc, "meta/title");
    doc = reduce(doc, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    history = record(history, doc, "row/rename:list-1-row-0");
    doc = reduce(doc, { type: "row/rename", rowId: "list-1-row-0", label: "Top" }, T1);

    const first = undo(history, doc, T2)!;
    expect(first.doc.rows[0]!.label).toBe("S");
    expect(first.doc.title).toBe("Ramen");
  });

  it("never coalesces an unkeyed edit", () => {
    let doc = base();
    let history = createHistory();

    history = record(history, doc);
    doc = reduce(doc, { type: "item/addText", id: "i0", label: "a" }, T1);
    history = record(history, doc);
    doc = reduce(doc, { type: "item/addText", id: "i1", label: "b" }, T1);

    const first = undo(history, doc, T2)!;
    expect(first.doc.items).toHaveLength(1);
  });

  it("does not merge across an unkeyed edit that shares neither key", () => {
    let doc = base();
    let history = createHistory();

    history = record(history, doc, "meta/title");
    doc = reduce(doc, { type: "meta/set", patch: { title: "Ramen" } }, T1);
    history = record(history, doc);
    doc = reduce(doc, { type: "item/addText", id: "i0", label: "a" }, T1);
    history = record(history, doc, "meta/title");
    doc = reduce(doc, { type: "meta/set", patch: { title: "Udon" } }, T1);

    const first = undo(history, doc, T2)!;
    expect(first.doc.title).toBe("Ramen");
    expect(first.doc.items).toHaveLength(1);
  });

  it("does not merge a new edit into a step reached by undoing", () => {
    // The mirror of the rule redo already follows. After an undo the entry now
    // on top of `past` belongs to a step the user navigated *past*; merging a
    // fresh edit into it would silently swallow the state they just came back
    // to, so undo would jump two steps instead of one.
    let doc = base();
    let history = createHistory();

    history = record(history, doc, "meta/title");
    doc = reduce(doc, { type: "meta/set", patch: { title: "Ram" } }, T1);
    history = record(history, doc);
    doc = reduce(doc, { type: "item/addText", id: "i0", label: "a" }, T1);

    const back = undo(history, doc, T2)!;
    expect(back.doc.title).toBe("Ram");
    expect(back.doc.items).toHaveLength(0);

    const typed = record(back.history, back.doc, "meta/title");
    const after = reduce(back.doc, { type: "meta/set", patch: { title: "Ramen" } }, T2);

    const first = undo(typed, after, T2)!;
    expect(first.doc.title).toBe("Ram");
  });

  it("does not merge a new edit into a step reached by redoing", () => {
    let doc = base();
    let history = createHistory();

    history = record(history, doc, "meta/title");
    doc = reduce(doc, { type: "meta/set", patch: { title: "Ram" } }, T1);

    const back = undo(history, doc, T2)!;
    const forward = redo(back.history, back.doc, T2)!;
    expect(forward.doc.title).toBe("Ram");

    const typed = record(forward.history, forward.doc, "meta/title");
    const after = reduce(forward.doc, { type: "meta/set", patch: { title: "Ramen" } }, T2);

    const first = undo(typed, after, T2)!;
    expect(first.doc.title).toBe("Ram");
  });

  it("does not let a long coalesced run grow the undo stack", () => {
    let history = createHistory(2);
    let doc = base();

    for (let i = 0; i < 50; i += 1) {
      history = record(history, doc, "meta/title");
      doc = reduce(doc, { type: "meta/set", patch: { title: `t${i}` } }, T1);
    }

    expect(history.past).toHaveLength(1);
    const undone = undo(history, doc, T2)!;
    expect(undone.doc.title).toBe("Untitled tier list");
    expect(canUndo(undone.history)).toBe(false);
  });

  it("still discards the redo stack when a coalescing edit is recorded", () => {
    let doc = base();
    let history = createHistory();

    history = record(history, doc, "meta/title");
    doc = reduce(doc, { type: "meta/set", patch: { title: "Ram" } }, T1);

    const back = undo(history, doc, T2)!;
    expect(canRedo(back.history)).toBe(true);

    const typed = record(back.history, back.doc, "meta/title");
    expect(canRedo(typed)).toBe(false);
  });
});

describe("mergeKeyFor", () => {
  it("keys text edits so typing collapses to one undo step", () => {
    expect(mergeKeyFor({ type: "meta/set", patch: { title: "R" } })).toBe("meta/title");
    expect(mergeKeyFor({ type: "row/rename", rowId: "r1", label: "S" })).toBe("row/rename:r1");
  });

  it("keys separate rows separately", () => {
    expect(mergeKeyFor({ type: "row/rename", rowId: "r1", label: "S" })).not.toBe(
      mergeKeyFor({ type: "row/rename", rowId: "r2", label: "S" }),
    );
  });

  it("does not key structural edits, so each is its own undo step", () => {
    expect(mergeKeyFor({ type: "item/addText", id: "i1", label: "a" })).toBeNull();
    expect(
      mergeKeyFor({ type: "placement/place", itemId: "i1", rowId: null, index: 0 }),
    ).toBeNull();
    expect(mergeKeyFor({ type: "row/remove", rowId: "r1" })).toBeNull();
  });

  it("keys a multi-field patch of continuous fields as one shape", () => {
    // A form that writes title and description together still coalesces with
    // itself, and the key does not depend on the order the UI built the patch.
    const a = mergeKeyFor({ type: "meta/set", patch: { title: "R", description: "d" } });
    const b = mergeKeyFor({ type: "meta/set", patch: { description: "dd", title: "Ra" } });
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).not.toBe(mergeKeyFor({ type: "meta/set", patch: { title: "R" } }));
  });

  it("does not key discrete metadata choices", () => {
    // Picking a category or adding a tag is one deliberate act each. Merging
    // two of them would lose one, and merging a choice with its own reversal
    // would leave an undo step that restores the state it is already in.
    expect(mergeKeyFor({ type: "meta/set", patch: { categoryId: "c1" } })).toBeNull();
    expect(mergeKeyFor({ type: "meta/set", patch: { tags: ["a"] } })).toBeNull();
    expect(
      mergeKeyFor({ type: "meta/set", patch: { title: "R", tags: ["a"] } }),
    ).toBeNull();
  });

  it("keys dragged display values but not display switches", () => {
    expect(mergeKeyFor({ type: "display/set", patch: { tileSize: 96 } })).toBe(
      "display/tileSize",
    );
    expect(mergeKeyFor({ type: "display/set", patch: { labelWidth: 80 } })).toBe(
      "display/labelWidth",
    );
    expect(mergeKeyFor({ type: "display/set", patch: { showLabels: false } })).toBeNull();
    expect(mergeKeyFor({ type: "display/set", patch: { density: "compact" } })).toBeNull();
    expect(mergeKeyFor({ type: "display/set", patch: { tileAspect: "portrait" } })).toBeNull();
  });

  it("does not key an empty patch", () => {
    expect(mergeKeyFor({ type: "meta/set", patch: {} })).toBeNull();
    expect(mergeKeyFor({ type: "display/set", patch: {} })).toBeNull();
  });
});

describe("revision discipline over long random sessions", () => {
  /** Deterministic LCG: a property test that reproduces exactly on failure. */
  function prng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  const OPS = ["title", "rename", "add", "undo", "redo"] as const;

  it("never reuses a revision, and keeps both stacks inside the limit", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const next = prng(seed);
      const limit = 1 + Math.floor(next() * 5);

      let history: History = createHistory(limit);
      let doc = base();
      const seen = new Set<number>([doc.revision]);
      let tick = 0;

      for (let step = 0; step < 200; step += 1) {
        tick += 1;
        const now = new Date(Date.UTC(2026, 7, 1, 0, 0, tick)).toISOString();
        const op = OPS[Math.floor(next() * OPS.length)]!;
        const previous = doc;

        if (op === "undo" || op === "redo") {
          const move = op === "undo" ? undo : redo;
          const can = op === "undo" ? canUndo : canRedo;
          const result = move(history, doc, now);
          expect(result === null).toBe(!can(history));
          if (!result) continue;
          history = result.history;
          doc = result.doc;
        } else {
          const action =
            op === "title"
              ? ({ type: "meta/set", patch: { title: `t${step}` } } as const)
              : op === "rename"
                ? ({
                    type: "row/rename",
                    rowId: "list-1-row-0",
                    label: `r${step}`,
                  } as const)
                : ({ type: "item/addText", id: `i${step}`, label: "x" } as const);

          const after = reduce(doc, action, now);
          // The caller's contract: only a real change is recorded.
          if (after === doc) continue;
          history = record(history, doc, mergeKeyFor(action));
          doc = after;
        }

        expect(doc.revision).toBe(previous.revision + 1);
        expect(seen.has(doc.revision)).toBe(false);
        seen.add(doc.revision);
        expect(doc.updatedAt).toBe(now);

        expect(doc.id).toBe("list-1");
        expect(doc.createdAt).toBe(T0);
        expect(doc.schemaVersion).toBe(2);

        expect(history.past.length).toBeLessThanOrEqual(limit);
        expect(history.future.length).toBeLessThanOrEqual(limit);
        expect(history.past.length + history.future.length).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("returns to the same content when an undo is redone immediately", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const next = prng(seed);
      let history: History = createHistory(4);
      let doc = base();
      let tick = 0;

      for (let step = 0; step < 60; step += 1) {
        tick += 1;
        const now = new Date(Date.UTC(2026, 7, 1, 0, 0, tick)).toISOString();

        if (next() < 0.35 && canUndo(history)) {
          const before = doc;
          const back = undo(history, doc, now)!;
          const forward = redo(back.history, back.doc, now)!;
          expect(content(forward.doc)).toEqual(content(before));
          expect(forward.doc.revision).toBe(back.doc.revision + 1);
          history = forward.history;
          doc = forward.doc;
          continue;
        }

        const action = { type: "meta/set", patch: { title: `t${step}` } } as const;
        const after = reduce(doc, action, now);
        if (after === doc) continue;
        history = record(history, doc, mergeKeyFor(action));
        doc = after;
      }
    }
  });
});
