import { CATEGORIES } from "@tl/core";
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { browseJsonLd, jsonLdScript, siteOrigin } from "../seo";
import { browseClient, browseResults } from "./api";
import { BrowseGrid } from "./BrowseGrid";
import { SearchBox } from "./SearchBox";

export const metadata: Metadata = {
  title: "Browse tier lists",
  description:
    "Tier lists people have published. Open one, or fill in the template yourself and compare.",
  alternates: { canonical: "/browse" },
};

/**
 * Long enough that a busy page is not one API round trip per visitor, short
 * enough that a newly published list appears while its author is still looking.
 */
export const revalidate = 60;

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function BrowsePage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const results = await browseResults({ q: q ?? null });
  const client = browseClient();

  return (
    <main style={page}>
      <script
        type="application/ld+json"
        data-testid="jsonld"
        dangerouslySetInnerHTML={jsonLdScript(
          browseJsonLd({
            name: "Browse tier lists",
            description: "Tier lists people have published.",
            url: `${siteOrigin()}/browse`,
            results,
          }),
        )}
      />

      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Browse</h1>
      <p style={{ margin: "0 0 20px", color: "#8b98a6" }}>
        {q ? <>Results for “{q}”.</> : "Lists people chose to publish."}
      </p>

      <SearchBox initial={q} />

      <nav aria-label="Categories" style={{ marginBottom: 24 }}>
        <ul style={chips}>
          {CATEGORIES.map((category) => (
            <li key={category.id}>
              <Link href={`/browse/${category.id}`} style={chip} data-testid="category-link">
                {category.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <BrowseGrid
        results={results}
        assetUrl={(id) => (client ? client.assetUrl(id) : "")}
        empty={
          q
            ? "Nothing matched that."
            : "Nothing published yet. Share a list and tick “list it publicly”."
        }
      />
    </main>
  );
}

const page: CSSProperties = {
  width: "100%",
  maxWidth: 1100,
  margin: "0 auto",
  padding: "24px 16px 48px",
  fontFamily: "system-ui, sans-serif",
  color: "#e6edf3",
};

const chips: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const chip: CSSProperties = {
  display: "inline-block",
  padding: "6px 14px",
  background: "#12161b",
  border: "1px solid #2c3540",
  borderRadius: 999,
  color: "#e6edf3",
  textDecoration: "none",
  fontSize: 13,
};
