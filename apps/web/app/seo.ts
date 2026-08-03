import type { TierList } from "@tl/core";

/**
 * Where this deployment is reachable.
 *
 * Structured data is read by a crawler that has no page context, so every URL
 * in it has to be absolute — a relative one is silently dropped, which is the
 * worst kind of failure because the page still renders.
 */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export interface ShareJsonLdInput {
  doc: TierList;
  /** The absolute URL of the page this describes. */
  url: string;
  /** The preview image, when the share has one rendered. */
  image: string | null;
}

/**
 * A shared list, as structured data.
 *
 * Modelled as `ItemList` rather than `Article`: what the page *is* is a ranking
 * of named things, and that is the one schema.org type that says so. The tier
 * a thing landed in becomes its position, so the ranking survives the
 * translation instead of being flattened into prose.
 *
 * Returns a plain object rather than a string. The caller serialises it, and a
 * test can assert on fields instead of on JSON text.
 */
export function shareJsonLd({ doc, url, image }: ShareJsonLdInput): Record<string, unknown> {
  // Tier order is the ranking, so items are walked tier by tier. The tray is
  // deliberately skipped: an unplaced item has no rank, and giving it one
  // would assert something the author never said.
  const byId = new Map(doc.items.map((item) => [item.id, item]));
  const ranked: { name: string; tier: string }[] = [];
  for (const row of doc.rows) {
    const placed = doc.placements
      .filter((placement) => placement.rowId === row.id)
      .sort((a, b) => a.index - b.index);
    for (const placement of placed) {
      const item = byId.get(placement.itemId);
      if (!item) continue;
      ranked.push({ name: item.label || "Untitled item", tier: row.label });
    }
  }

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: doc.title || "Untitled tier list",
    description:
      doc.description ||
      `${ranked.length} ranked across ${doc.rows.length} tiers.`,
    url,
    numberOfItems: ranked.length,
    // Ordered because the tiers are ordered. Saying `Unordered` here would
    // discard the only information a tier list carries.
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    ...(image ? { image } : {}),
    itemListElement: ranked.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      // Not part of the ItemList vocabulary, but harmless and human-readable
      // in the rendered blob — the tier letter is the thing a reader looking
      // at the source would want to see beside the name.
      additionalType: entry.tier,
    })),
  };
}

export interface BrowseJsonLdInput {
  name: string;
  description: string;
  url: string;
  results: readonly { code: string; title: string }[];
}

/** A browse page: a collection whose members are the listed lists. */
export function browseJsonLd({
  name,
  description,
  url,
  results,
}: BrowseJsonLdInput): Record<string, unknown> {
  const origin = siteOrigin();
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    description,
    url,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: results.length,
      itemListElement: results.map((result, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: result.title || "Untitled tier list",
        url: `${origin}/l/${result.code}`,
      })),
    },
  };
}

/**
 * Props for a `<script type="application/ld+json">`.
 *
 * A list title is user-typed and lands inside a `<script>` element, where the
 * HTML parser is looking for `</script` and nothing else escapes for it. So
 * every `<` is written as its JSON unicode escape: identical to the parser
 * that reads the blob, invisible to the one that could be fooled by it.
 */
export function jsonLdScript(data: Record<string, unknown>): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") };
}
