/**
 * The curated top-level taxonomy.
 *
 * A closed list rather than free-form: browse pages are the discovery surface,
 * and a category is only useful if two people filing the same kind of list pick
 * the same one. Free-form tags exist alongside for everything this cannot say —
 * `tags` on the document is where "soulslike" or "2010s" belongs.
 *
 * Ids are stable slugs and are what the document stores. Labels are display
 * text and may be reworded without migrating anything.
 */
export interface Category {
  id: string;
  label: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: "anime", label: "Anime" },
  { id: "games", label: "Games" },
  { id: "movies", label: "Movies" },
  { id: "tv", label: "TV" },
  { id: "music", label: "Music" },
  { id: "food", label: "Food" },
  { id: "sports", label: "Sports" },
  { id: "internet", label: "Internet" },
  { id: "other", label: "Other" },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** The category with this id, or undefined. A document may hold any string. */
export function categoryById(id: string | null | undefined): Category | undefined {
  return id === null || id === undefined ? undefined : BY_ID.get(id);
}

/** Whether an id names a category this build knows about. */
export function isKnownCategory(id: string | null | undefined): boolean {
  return categoryById(id) !== undefined;
}

/**
 * Free-form tags, cleaned for storage and comparison.
 *
 * Lowercased and trimmed so "Soulslike" and "soulslike " are one tag rather
 * than three, deduplicated, and capped — a tag list is a handful of words, and
 * an unbounded one is a place to paste an essay into a browse page.
 */
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;

export function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}
