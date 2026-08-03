import { createTierList, reduce, type TierList } from "@tl/core";
import { describe, expect, it } from "vitest";
import { browseJsonLd, jsonLdScript, shareJsonLd } from "../app/seo";

const NOW = "2026-08-01T12:00:00.000Z";

/**
 * Asymmetric on every axis that could hide a bug: the tiers are filled out of
 * order, one tier is left empty, one item is left in the tray, and the labels
 * are distinct words rather than "a"/"b" — so a function that read the items
 * in document order, or that ranked the tray, or that dropped an empty tier's
 * items into the wrong bucket, produces a visibly different answer.
 */
function doc(): TierList {
  let d = createTierList({ id: "list-1", title: "Best noodles", now: NOW });
  const [s, a, b] = d.rows;

  d = reduce(d, { type: "item/addText", id: "i-ramen", label: "Ramen" }, NOW);
  d = reduce(d, { type: "item/addText", id: "i-udon", label: "Udon" }, NOW);
  d = reduce(d, { type: "item/addText", id: "i-soba", label: "Soba" }, NOW);
  d = reduce(d, { type: "item/addText", id: "i-pho", label: "Pho" }, NOW);

  // B first, then S — so "the order items were added" and "the order tiers
  // rank" disagree.
  d = reduce(d, { type: "placement/place", itemId: "i-soba", rowId: b!.id, index: 0 }, NOW);
  d = reduce(d, { type: "placement/place", itemId: "i-udon", rowId: s!.id, index: 0 }, NOW);
  d = reduce(d, { type: "placement/place", itemId: "i-ramen", rowId: s!.id, index: 1 }, NOW);
  // `i-pho` stays in the tray. A(1) stays empty.
  void a;
  return d;
}

describe("shareJsonLd", () => {
  it("ranks items by tier, then by position within the tier", () => {
    const data = shareJsonLd({ doc: doc(), url: "https://x/l/CODE", image: null });
    const elements = data.itemListElement as { position: number; name: string }[];

    expect(elements.map((e) => e.name)).toEqual(["Udon", "Ramen", "Soba"]);
    expect(elements.map((e) => e.position)).toEqual([1, 2, 3]);
  });

  /**
   * The tray is "not ranked yet", and a crawler reading a position off it
   * would be told the author placed something they explicitly did not.
   */
  it("leaves unplaced items out entirely", () => {
    const data = shareJsonLd({ doc: doc(), url: "https://x/l/CODE", image: null });
    const elements = data.itemListElement as { name: string }[];

    expect(elements.map((e) => e.name)).not.toContain("Pho");
    expect(data.numberOfItems).toBe(3);
  });

  it("names the tier each item landed in", () => {
    const d = doc();
    const data = shareJsonLd({ doc: d, url: "https://x/l/CODE", image: null });
    const elements = data.itemListElement as { name: string; additionalType: string }[];

    const soba = elements.find((e) => e.name === "Soba")!;
    expect(soba.additionalType).toBe(d.rows[2]!.label);
    const udon = elements.find((e) => e.name === "Udon")!;
    expect(udon.additionalType).toBe(d.rows[0]!.label);
  });

  it("declares a descending order, because the tiers are a ranking", () => {
    const data = shareJsonLd({ doc: doc(), url: "https://x/l/CODE", image: null });
    expect(data.itemListOrder).toBe("https://schema.org/ItemListOrderDescending");
  });

  /**
   * A relative URL in structured data is dropped silently, so the absolute one
   * has to arrive here already built.
   */
  it("carries the page URL and, when there is one, the preview image", () => {
    const withImage = shareJsonLd({
      doc: doc(),
      url: "https://x/l/CODE",
      image: "https://api/assets/og-1",
    });
    expect(withImage.url).toBe("https://x/l/CODE");
    expect(withImage.image).toBe("https://api/assets/og-1");

    // Absent rather than null: a null image is a field a validator complains
    // about, where a missing one is simply a page without a picture.
    const without = shareJsonLd({ doc: doc(), url: "https://x/l/CODE", image: null });
    expect("image" in without).toBe(false);
  });

  it("falls back to a factual description when the author wrote none", () => {
    const data = shareJsonLd({ doc: doc(), url: "https://x/l/CODE", image: null });
    expect(data.description).toBe("3 ranked across 5 tiers.");
  });
});

describe("browseJsonLd", () => {
  it("lists each result in order, with an absolute link to its share page", () => {
    const data = browseJsonLd({
      name: "Anime tier lists",
      description: "Published anime lists.",
      url: "https://x/browse/anime",
      results: [
        { code: "AAAAAAAA", title: "Best noodles" },
        { code: "BBBBBBBB", title: "" },
      ],
    });

    const entity = data.mainEntity as { numberOfItems: number; itemListElement: unknown[] };
    expect(entity.numberOfItems).toBe(2);
    expect(entity.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Best noodles",
        url: "http://localhost:3000/l/AAAAAAAA",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Untitled tier list",
        url: "http://localhost:3000/l/BBBBBBBB",
      },
    ]);
  });
});

describe("jsonLdScript", () => {
  /**
   * The blob is written inside a `<script>`, where the HTML parser stops at
   * `</script` and nothing else — not at a quote, not at a JSON escape. A
   * title is user-typed, so this is the boundary that has to hold.
   */
  it("escapes every `<`, so a title cannot close the script element", () => {
    const html = jsonLdScript({
      name: "</script><img src=x onerror=alert(1)>",
    }).__html;

    expect(html).not.toContain("<");
    expect(html).toContain("\\u003c/script");
    // Still valid JSON, and still says what it said.
    expect(JSON.parse(html)).toEqual({ name: "</script><img src=x onerror=alert(1)>" });
  });
});
