import { describe, expect, it } from "vitest";
import { compare, type Participant } from "../src/compare";
import { createTierList } from "../src/factory";
import { reduce } from "../src/reduce";
import { startFill, toTemplate } from "../src/template";
import type { TierList } from "../src/types";

const NOW = "2026-08-01T12:00:00.000Z";

/** Five tiers, so the midpoint is a whole rank (2) and can be landed on. */
function template(itemCount = 4): TierList {
  let doc = createTierList({ id: "src", now: NOW, title: "Noodles" });
  for (let i = 0; i < itemCount; i++) {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label: `Item ${i}` }, NOW);
  }
  return toTemplate(doc, { id: "tpl", now: NOW });
}

function rowsOf(doc: TierList): string[] {
  return [...doc.rows].sort((a, b) => a.order - b.order).map((r) => r.id);
}

/**
 * A fill placing item `i<n>` at the rank `ranks[n]`. `null` leaves it in the
 * tray.
 */
function fill(tpl: TierList, id: string, ranks: (number | null)[]): TierList {
  let doc = startFill(tpl, { id, now: NOW });
  const rows = rowsOf(doc);
  ranks.forEach((rank, n) => {
    if (rank === null) return;
    doc = reduce(doc, { type: "placement/place", itemId: `i${n}`, rowId: rows[rank]!, index: 0 }, NOW);
  });
  return doc;
}

function people(...docs: TierList[]): Participant[] {
  return docs.map((doc, n) => ({ id: `p${n}`, label: `Person ${n}`, doc }));
}

describe("compare — the scale", () => {
  it("reads the scale off participants that agree on it", () => {
    const tpl = template();
    const result = compare(people(fill(tpl, "a", [0, 1]), fill(tpl, "b", [0, 1])));

    expect(result.scale?.rowIds).toEqual(rowsOf(tpl));
    expect(result.scale?.labels).toEqual(["S", "A", "B", "C", "D"]);
    expect(result.scale?.maxDistance).toBe(4);
    expect(result.warnings).toEqual([]);
  });

  /**
   * A fill is an ordinary document: its rows can be reordered after the fact.
   * Picking one participant's scale would make the answer depend on argument
   * order, which is exactly the symmetry the comparison rests on.
   */
  it("refuses a scale when participants disagree about it, and says so", () => {
    const tpl = template();
    const a = fill(tpl, "a", [0, 1]);
    const b = reduce(fill(tpl, "b", [0, 1]), { type: "row/reorder", rowId: rowsOf(tpl)[4]!, toIndex: 0 }, NOW);

    const result = compare(people(a, b));
    expect(result.scale).toBeNull();
    expect(result.agreement).toBeNull();
    expect(result.warnings.map((w) => w.kind)).toContain("scale-mismatch");
  });

  it("surfaces a template mismatch rather than comparing across templates", () => {
    const a = fill(template(), "a", [0, 1]);
    const other = toTemplate(createTierList({ id: "src2", now: NOW }), { id: "tpl2", now: NOW });
    const b = startFill(other, { id: "b", now: NOW });

    expect(compare(people(a, b)).warnings.map((w) => w.kind)).toContain("template-mismatch");
  });

  /**
   * The one thing `templateRevision` exists to make detectable. It cannot be
   * reconstructed later, so a mismatch has to be surfaced rather than averaged
   * over.
   */
  it("surfaces a revision mismatch between fills of the same template", () => {
    const tpl = template();
    const a = fill(tpl, "a", [0, 1]);
    const b = { ...fill(tpl, "b", [0, 1]), templateRevision: (tpl.revision ?? 0) + 3 };

    const kinds = compare(people(a, b)).warnings.map((w) => w.kind);
    expect(kinds).toContain("revision-mismatch");
    expect(kinds).not.toContain("template-mismatch");
  });

  it("warns when there is nobody to compare against", () => {
    const tpl = template();
    expect(compare(people(fill(tpl, "a", [0]))).warnings.map((w) => w.kind)).toContain(
      "too-few-participants",
    );
    expect(compare([]).warnings.map((w) => w.kind)).toContain("too-few-participants");
  });

  it("returns an empty, warning-carrying result for no participants at all", () => {
    const result = compare([]);
    expect(result.items).toEqual([]);
    expect(result.agreement).toBeNull();
    expect(result.scale).toBeNull();
  });
});

describe("compare — buckets and distance", () => {
  it("sorts items by how far apart the placements are", () => {
    const tpl = template(4);
    //            i0 same    i1 one apart   i2 three apart  i3 skipped by b
    const a = fill(tpl, "a", [1, 1, 0, 2]);
    const b = fill(tpl, "b", [1, 2, 3, null]);

    const result = compare(people(a, b));
    const byId = new Map(result.items.map((i) => [i.itemId, i]));

    expect(byId.get("i0")!.bucket).toBe("agreed");
    expect(byId.get("i0")!.spread).toBe(0);
    expect(byId.get("i1")!.bucket).toBe("close");
    expect(byId.get("i1")!.spread).toBe(1);
    expect(byId.get("i2")!.bucket).toBe("contested");
    expect(byId.get("i2")!.spread).toBe(3);
    expect(byId.get("i3")!.bucket).toBe("incomplete");
  });

  it("reports each participant's rank, and omits one who did not place it", () => {
    const tpl = template(2);
    const result = compare(people(fill(tpl, "a", [0, 3]), fill(tpl, "b", [2, null])));
    const byId = new Map(result.items.map((i) => [i.itemId, i]));

    expect(byId.get("i0")!.ranks).toEqual({ p0: 0, p1: 2 });
    expect(byId.get("i1")!.ranks).toEqual({ p0: 3 });
    expect(byId.get("i1")!.placed).toBe(1);
  });

  /**
   * An item somebody skipped has no disagreement to measure. Calling it
   * "agreed" because the people who did rank it happened to agree would
   * overstate what is known.
   */
  it("calls an item incomplete even when everyone who ranked it agreed", () => {
    const tpl = template(1);
    const result = compare(people(fill(tpl, "a", [2]), fill(tpl, "b", [null])));
    expect(result.items[0]!.bucket).toBe("incomplete");
  });

  it("groups the buckets by item id", () => {
    const tpl = template(3);
    const result = compare(people(fill(tpl, "a", [0, 0, 4]), fill(tpl, "b", [0, 1, null])));
    expect(result.buckets.agreed).toEqual(["i0"]);
    expect(result.buckets.close).toEqual(["i1"]);
    expect(result.buckets.incomplete).toEqual(["i2"]);
    expect(result.buckets.contested).toEqual([]);
  });

  it("counts an item nobody ranked as incomplete rather than crashing", () => {
    const tpl = template(1);
    const result = compare(people(fill(tpl, "a", [null]), fill(tpl, "b", [null])));
    expect(result.items[0]!.bucket).toBe("incomplete");
    expect(result.items[0]!.spread).toBeNull();
    expect(result.items[0]!.meanRank).toBeNull();
    expect(result.agreement).toBeNull();
  });
});

describe("compare — polarisation", () => {
  /**
   * Five tiers put the midpoint at rank 2. Anything landing exactly there is
   * on neither side, so S-vs-D polarises and A-vs-C does not.
   */
  it("flags opposite halves, and does not flag a straddle of the midpoint", () => {
    const tpl = template(3);
    //                        i0: S vs D      i1: A vs C     i2: S vs B(mid)
    const a = fill(tpl, "a", [0, 1, 0]);
    const b = fill(tpl, "b", [4, 3, 2]);

    const byId = new Map(compare(people(a, b)).items.map((i) => [i.itemId, i]));
    expect(byId.get("i0")!.polarising).toBe(true);
    expect(byId.get("i1")!.polarising).toBe(true);
    expect(byId.get("i2")!.polarising).toBe(false);
  });

  it("never flags an item only one person ranked", () => {
    const tpl = template(1);
    const byId = compare(people(fill(tpl, "a", [0]), fill(tpl, "b", [null])));
    expect(byId.items[0]!.polarising).toBe(false);
  });

  it("reports polarising separately from the bucket, so an item can be both", () => {
    const tpl = template(1);
    const result = compare(people(fill(tpl, "a", [0]), fill(tpl, "b", [4])));
    expect(result.items[0]!.bucket).toBe("contested");
    expect(result.items[0]!.polarising).toBe(true);
    expect(result.polarising).toEqual(["i0"]);
  });
});

describe("compare — the agreement score", () => {
  it("scores two identical lists at 1", () => {
    const tpl = template(4);
    const ranks = [0, 2, 3, 1];
    expect(compare(people(fill(tpl, "a", ranks), fill(tpl, "b", ranks))).agreement).toBe(1);
  });

  it("scores two exactly inverted lists at 0", () => {
    const tpl = template(3);
    const a = fill(tpl, "a", [0, 0, 0]);
    const b = fill(tpl, "b", [4, 4, 4]);
    expect(compare(people(a, b)).agreement).toBe(0);
  });

  it("is the mean spread over the scale's width", () => {
    const tpl = template(2);
    // Spreads of 0 and 2 over a maxDistance of 4 -> 1 - (1/4).
    const a = fill(tpl, "a", [1, 1]);
    const b = fill(tpl, "b", [1, 3]);
    expect(compare(people(a, b)).agreement).toBeCloseTo(0.75, 10);
  });

  it("scores only items everyone ranked", () => {
    const tpl = template(2);
    const bothAgree = compare(people(fill(tpl, "a", [1, 0]), fill(tpl, "b", [1, null])));
    expect(bothAgree.agreement).toBe(1);
  });

  /**
   * Null rather than zero. "They disagree completely" and "there is nothing to
   * compare" are different answers, and a percentage cannot tell them apart.
   */
  it("returns null when nothing is shared, rather than a misleading zero", () => {
    const tpl = template(2);
    expect(compare(people(fill(tpl, "a", [null, null]), fill(tpl, "b", [0, 1]))).agreement).toBeNull();
  });

  it("returns null on a single-tier scale, where no two placements can differ", () => {
    let doc = createTierList({ id: "src", now: NOW });
    for (const row of [...doc.rows].slice(1)) {
      doc = reduce(doc, { type: "row/remove", rowId: row.id }, NOW);
    }
    doc = reduce(doc, { type: "item/addText", id: "i0", label: "Only" }, NOW);
    const tpl = toTemplate(doc, { id: "tpl", now: NOW });

    const result = compare(people(fill(tpl, "a", [0]), fill(tpl, "b", [0])));
    expect(result.scale?.maxDistance).toBe(0);
    expect(result.agreement).toBeNull();
  });
});

describe("compare — N participants", () => {
  it("degenerates to the two-person answer, and generalises past it", () => {
    const tpl = template(1);
    const two = compare(people(fill(tpl, "a", [0]), fill(tpl, "b", [2])));
    expect(two.items[0]!.spread).toBe(2);

    const three = compare(
      people(fill(tpl, "a", [0]), fill(tpl, "b", [2]), fill(tpl, "c", [4])),
    );
    // The width of disagreement, not the mean of it.
    expect(three.items[0]!.spread).toBe(4);
    expect(three.items[0]!.meanRank).toBe(2);
    expect(three.items[0]!.placed).toBe(3);
  });

  it("marks an item incomplete when any one of three skipped it", () => {
    const tpl = template(1);
    const result = compare(
      people(fill(tpl, "a", [1]), fill(tpl, "b", [1]), fill(tpl, "c", [null])),
    );
    expect(result.items[0]!.bucket).toBe("incomplete");
    expect(result.agreement).toBeNull();
  });
});

describe("compare — properties the design doc names", () => {
  /** Deterministic LCG, so a failure reproduces exactly. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function randomFill(tpl: TierList, id: string, random: () => number, items: number) {
    const ranks = Array.from({ length: items }, () => {
      const r = random();
      return r < 0.2 ? null : Math.floor(random() * 5);
    });
    return fill(tpl, id, ranks);
  }

  it("always scores identical lists at exactly 1", () => {
    const random = lcg(7);
    for (let round = 0; round < 200; round++) {
      const tpl = template(5);
      const ranks = Array.from({ length: 5 }, () =>
        random() < 0.2 ? null : Math.floor(random() * 5),
      );
      const result = compare(people(fill(tpl, "a", ranks), fill(tpl, "b", ranks)));
      // Null when they happened to rank nothing in common — which for two
      // identical lists means neither ranked anything.
      if (result.agreement !== null) expect(result.agreement).toBe(1);
      for (const item of result.items) {
        if (item.bucket !== "incomplete") expect(item.spread).toBe(0);
      }
    }
  });

  it("is symmetric: argument order changes nothing but the labels", () => {
    const random = lcg(11);
    for (let round = 0; round < 200; round++) {
      const tpl = template(5);
      const a = randomFill(tpl, "a", random, 5);
      const b = randomFill(tpl, "b", random, 5);

      const forwards = compare([
        { id: "p0", label: "A", doc: a },
        { id: "p1", label: "B", doc: b },
      ]);
      const backwards = compare([
        { id: "p0", label: "B", doc: b },
        { id: "p1", label: "A", doc: a },
      ]);

      expect(backwards.agreement).toBe(forwards.agreement);
      expect(backwards.items.map((i) => i.itemId)).toEqual(forwards.items.map((i) => i.itemId));
      expect(backwards.items.map((i) => i.bucket)).toEqual(forwards.items.map((i) => i.bucket));
      expect(backwards.items.map((i) => i.spread)).toEqual(forwards.items.map((i) => i.spread));
      expect(backwards.items.map((i) => i.polarising)).toEqual(
        forwards.items.map((i) => i.polarising),
      );
    }
  });

  it("never lets an item nobody ranked change the agreement score", () => {
    const random = lcg(13);
    for (let round = 0; round < 200; round++) {
      const tpl = template(4);
      const a = randomFill(tpl, "a", random, 4);
      const b = randomFill(tpl, "b", random, 4);
      const before = compare(people(a, b)).agreement;

      // A fifth item that exists for both and is ranked by neither.
      const withExtra = (doc: TierList) =>
        reduce(doc, { type: "item/addText", id: "extra", label: "Extra" }, NOW);
      const after = compare(people(withExtra(a), withExtra(b))).agreement;

      expect(after).toBe(before);
    }
  });

  it("keeps the score inside 0..1 for any pair of fills", () => {
    const random = lcg(17);
    for (let round = 0; round < 300; round++) {
      const tpl = template(5);
      const result = compare(
        people(randomFill(tpl, "a", random, 5), randomFill(tpl, "b", random, 5)),
      );
      if (result.agreement === null) continue;
      expect(result.agreement).toBeGreaterThanOrEqual(0);
      expect(result.agreement).toBeLessThanOrEqual(1);
    }
  });
});
