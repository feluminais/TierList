import type { BrowseResult } from "@tl/api-client";
import { categoryById } from "@tl/core";
import Link from "next/link";
import type { CSSProperties } from "react";

/**
 * The cards a browse page is made of.
 *
 * A card carries a title, a category and the link-preview image — never a
 * document. Browsing is not reading: a reader who wants the list follows the
 * code to `/l/[code]`, which is the one page that loads one.
 */
export function BrowseGrid({
  results,
  assetUrl,
  empty,
}: {
  results: BrowseResult[];
  assetUrl: (id: string) => string;
  empty: string;
}) {
  if (results.length === 0) {
    return (
      <p data-testid="browse-empty" style={{ color: "#8b98a6" }}>
        {empty}
      </p>
    );
  }

  return (
    <ul style={grid}>
      {results.map((result) => (
        <li key={result.code}>
          <Link href={`/l/${result.code}`} style={card} data-testid="browse-card">
            <span style={thumb}>
              {result.ogAssetId ? (
                // A plain <img>: the asset endpoint is already immutable and
                // cache-forever, and routing it through a second optimiser
                // costs a page whose whole point is opening fast.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assetUrl(result.ogAssetId)}
                  alt=""
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ color: "#5b6673", fontSize: 12 }}>No preview</span>
              )}
            </span>
            <span style={{ fontSize: 14 }}>{result.title || "Untitled tier list"}</span>
            {result.categoryId ? (
              <span style={tag}>{categoryById(result.categoryId)?.label ?? result.categoryId}</span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const grid: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 12,
};

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 10,
  background: "#12161b",
  border: "1px solid #232a33",
  borderRadius: 10,
  color: "#e6edf3",
  textDecoration: "none",
};

const thumb: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  aspectRatio: "16 / 9",
  background: "#0b0d10",
  borderRadius: 6,
  overflow: "hidden",
};

const tag: CSSProperties = {
  alignSelf: "flex-start",
  padding: "2px 8px",
  background: "#222b35",
  borderRadius: 999,
  color: "#8b98a6",
  fontSize: 11,
};
