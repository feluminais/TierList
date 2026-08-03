import type { TierList } from "./types";

/**
 * One filled-in list, and who filled it.
 *
 * `id` names the participant, not the document — two people can compare the
 * same list twice under different names, and the result keys everything by
 * this rather than by the list's own id.
 */
export interface Participant {
  id: string;
  label: string;
  doc: TierList;
}

/**
 * Which bucket an item falls into, in the order the design doc presents them.
 *
 * `incomplete` wins over everything: an item somebody skipped has no
 * disagreement to measure, and reporting it as "agreed" because the two people
 * who *did* rank it happened to agree would overstate what is known.
 */
export type Bucket = "agreed" | "close" | "contested" | "incomplete";

export interface ItemComparison {
  itemId: string;
  label: string | undefined;
  /**
   * Rank index per participant id — 0 is the top tier. A participant who left
   * the item in the tray is absent, not zero.
   */
  ranks: Record<string, number>;
  /** How many participants ranked it. */
  placed: number;
  /** Mean of the ranks that exist, or null when nobody ranked it. */
  meanRank: number | null;
  /**
   * The width of disagreement: highest rank minus lowest, over participants
   * who ranked it. Null when nobody did.
   *
   * This is the "item distance" the agreement score averages, and for two
   * people it is exactly `|rankIndex(a) − rankIndex(b)|` — the definition the
   * design doc gives. Spread rather than mean pairwise distance because it
   * degenerates to the same thing for two, generalises without a second
   * definition, and is the number a reader can check by eye: it is the gap
   * between the two extreme opinions.
   */
  spread: number | null;
  bucket: Bucket;
  /**
   * Somebody put it in the top half and somebody put it in the bottom half.
   *
   * Reported alongside the bucket rather than as one, because it is a
   * different question: an item can be both contested and polarising, and
   * collapsing them would hide whichever was listed second.
   */
  polarising: boolean;
}

export type CompareWarningKind =
  | "template-mismatch"
  | "revision-mismatch"
  | "scale-mismatch"
  | "too-few-participants";

export interface CompareWarning {
  kind: CompareWarningKind;
  message: string;
}

export interface CompareScale {
  /** Row ids, top tier first. */
  rowIds: string[];
  labels: string[];
  /** `rowCount − 1`: the furthest two ranks can be. Zero for a single tier. */
  maxDistance: number;
}

export interface ComparisonResult {
  participants: { id: string; label: string }[];
  /** Null when the participants do not agree on a scale to measure against. */
  scale: CompareScale | null;
  items: ItemComparison[];
  /**
   * `1 − (mean spread ÷ maxDistance)`, over items *every* participant ranked.
   *
   * Null when there is nothing to score — no shared items, no usable scale, or
   * a single-tier scale where no two placements can differ. Null is not zero:
   * "they disagree completely" and "there is nothing to compare" are different
   * answers and a percentage cannot tell them apart.
   */
  agreement: number | null;
  /** Item ids per bucket, in the same order as `items`. */
  buckets: Record<Bucket, string[]>;
  /** Item ids somebody put in the top half and somebody in the bottom. */
  polarising: string[];
  warnings: CompareWarning[];
}

/** Where each item sits for one participant, by row id. `null` is the tray. */
function locations(doc: TierList): Map<string, string | null> {
  return new Map(doc.placements.map((p) => [p.itemId, p.rowId]));
}

/** Row ids in display order, which is the ordinal scale. */
function orderedRowIds(doc: TierList): string[] {
  return [...doc.rows].sort((a, b) => a.order - b.order).map((r) => r.id);
}

function sameSequence(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, at) => value === b[at]);
}

/**
 * The scale every participant is measured against.
 *
 * Taken from the participants only when they *all* agree on it. A fill is an
 * ordinary document whose rows can be renamed, reordered, added to or removed
 * after it was started, so two fills of one template can genuinely disagree
 * about what the scale is — and both `maxDistance` and the polarising midpoint
 * are defined in terms of it. Picking one participant's scale would make the
 * result depend on argument order, which breaks the symmetry the whole
 * comparison rests on. Refusing is the honest answer.
 */
function scaleOf(participants: Participant[]): CompareScale | null {
  const first = participants[0];
  if (!first) return null;

  const rowIds = orderedRowIds(first.doc);
  for (const participant of participants) {
    if (!sameSequence(orderedRowIds(participant.doc), rowIds)) return null;
  }

  const labelsById = new Map(first.doc.rows.map((r) => [r.id, r.label]));
  return {
    rowIds,
    labels: rowIds.map((id) => labelsById.get(id) ?? ""),
    maxDistance: Math.max(0, rowIds.length - 1),
  };
}

/**
 * Every item any participant holds, in a stable order.
 *
 * Union rather than intersection: an item one person ranked and another does
 * not have at all is a real difference, and dropping it would hide that the
 * two lists are not the same list. Ordered by the first participant that
 * carries it, then by that document's own `order`, so the result does not
 * depend on the order participants were passed in beyond which one introduced
 * an item — and for the ordinary case, where every fill descends from one
 * template, they all carry the same items in the same order anyway.
 */
function itemsInOrder(participants: Participant[]): { id: string; label: string | undefined }[] {
  const seen = new Map<string, string | undefined>();
  for (const participant of participants) {
    for (const item of [...participant.doc.items].sort((a, b) => a.order - b.order)) {
      if (!seen.has(item.id)) seen.set(item.id, item.label);
    }
  }
  return [...seen].map(([id, label]) => ({ id, label }));
}

function warnAbout(participants: Participant[], scale: CompareScale | null): CompareWarning[] {
  const warnings: CompareWarning[] = [];

  if (participants.length < 2) {
    warnings.push({
      kind: "too-few-participants",
      message: "Comparison needs at least two filled lists.",
    });
  }

  const templates = new Set(participants.map((p) => p.doc.templateId ?? null));
  if (templates.size > 1) {
    warnings.push({
      kind: "template-mismatch",
      message:
        "These lists were not all filled from the same template, so their items may not correspond.",
    });
  }

  // Only meaningful once the template matches: two fills of *different*
  // templates having different revisions says nothing extra.
  if (templates.size === 1) {
    const revisions = new Set(participants.map((p) => p.doc.templateRevision ?? null));
    if (revisions.size > 1) {
      warnings.push({
        kind: "revision-mismatch",
        message:
          "These lists were filled from different revisions of the template, so the tiers or items may have changed between them.",
      });
    }
  }

  if (!scale && participants.length > 0) {
    warnings.push({
      kind: "scale-mismatch",
      message: "These lists do not have the same tiers, so there is no common scale to measure against.",
    });
  }

  return warnings;
}

/**
 * Compare filled lists.
 *
 * Pure, total, and order-independent: passing the same participants in a
 * different order permutes `participants` and the keys inside `ranks`, and
 * changes nothing else. That property is what makes a comparison a fact about
 * the lists rather than about how they were requested, and it is the reason
 * the scale is refused rather than guessed when the participants disagree
 * about it.
 *
 * Built for N from the start. Two people are a *presentation* of an N-way
 * distribution, not a separate calculation — a two-only diff would not
 * generalise, and retrofitting N later would mean redefining every number
 * here.
 */
export function compare(participants: Participant[]): ComparisonResult {
  const scale = scaleOf(participants);
  const warnings = warnAbout(participants, scale);

  const rankOf = new Map<string, Map<string, number>>();
  if (scale) {
    const rankByRow = new Map(scale.rowIds.map((id, index) => [id, index]));
    for (const participant of participants) {
      const placed = new Map<string, number>();
      for (const [itemId, rowId] of locations(participant.doc)) {
        // The tray is not a rank. An item left there means "haven't decided"
        // far more often than "bottom tier", and scoring it as the last row
        // would manufacture disagreement out of an unanswered question.
        if (rowId === null) continue;
        const rank = rankByRow.get(rowId);
        if (rank !== undefined) placed.set(itemId, rank);
      }
      rankOf.set(participant.id, placed);
    }
  }

  // Strictly outside the middle. A placement exactly on the midpoint is on
  // neither side, so with five tiers S-vs-D polarises and A-vs-C does not.
  const midpoint = scale ? scale.maxDistance / 2 : 0;

  const items: ItemComparison[] = itemsInOrder(participants).map(({ id, label }) => {
    const ranks: Record<string, number> = {};
    for (const participant of participants) {
      const rank = rankOf.get(participant.id)?.get(id);
      if (rank !== undefined) ranks[participant.id] = rank;
    }

    const values = Object.values(ranks);
    const placed = values.length;
    const everyone = placed === participants.length && participants.length > 0;

    const spread = placed > 0 ? Math.max(...values) - Math.min(...values) : null;
    const meanRank = placed > 0 ? values.reduce((a, b) => a + b, 0) / placed : null;

    const bucket: Bucket = !everyone
      ? "incomplete"
      : spread === 0
        ? "agreed"
        : spread === 1
          ? "close"
          : "contested";

    return {
      itemId: id,
      label,
      ranks,
      placed,
      meanRank,
      spread,
      bucket,
      // Needs two opinions to be polar, and both strictly off the midpoint.
      polarising:
        placed > 1 &&
        values.some((v) => v < midpoint) &&
        values.some((v) => v > midpoint),
    };
  });

  const scored = items.filter((item) => item.bucket !== "incomplete");
  const agreement =
    scale && scale.maxDistance > 0 && scored.length > 0
      ? 1 -
        scored.reduce((total, item) => total + (item.spread ?? 0), 0) /
          scored.length /
          scale.maxDistance
      : null;

  const buckets: Record<Bucket, string[]> = {
    agreed: [],
    close: [],
    contested: [],
    incomplete: [],
  };
  for (const item of items) buckets[item.bucket].push(item.itemId);

  return {
    participants: participants.map((p) => ({ id: p.id, label: p.label })),
    scale,
    items,
    agreement,
    buckets,
    polarising: items.filter((i) => i.polarising).map((i) => i.itemId),
    warnings,
  };
}
