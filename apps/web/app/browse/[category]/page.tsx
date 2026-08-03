import { categoryById } from "@tl/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { browseJsonLd, jsonLdScript, siteOrigin } from "../../seo";
import { browseClient, browseResults } from "../api";
import { BrowseGrid } from "../BrowseGrid";
import { SearchBox } from "../SearchBox";

export const revalidate = 60;

/**
 * One page per category, as a real URL with its own title and description
 * rather than a query string a crawler has to guess at. That is the whole SEO
 * argument for a curated taxonomy over free tags.
 *
 * Rendered per request, not prerendered: the page reads `searchParams` for the
 * in-category search box, which makes it dynamic no matter what
 * `generateStaticParams` would say. `sitemap.ts` is what tells a crawler these
 * URLs exist.
 */

interface PageProps {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category: id } = await params;
  const category = categoryById(id);
  if (!category) return { title: "Not found" };

  return {
    title: `${category.label} tier lists`,
    description: `Tier lists about ${category.label.toLowerCase()}, published by the people who made them. Open one, or fill in the template yourself.`,
    alternates: { canonical: `/browse/${category.id}` },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { category: id } = await params;
  const { q } = await searchParams;
  const category = categoryById(id);
  // An unknown category is a 404 rather than an empty page: the taxonomy is
  // closed, so a URL outside it names nothing and should not be indexed as if
  // it were an empty section.
  if (!category) notFound();

  const results = await browseResults({ category: category.id, q: q ?? null });
  const client = browseClient();

  return (
    <main
      style={{
        width: "100%",
        maxWidth: 1100,
        margin: "0 auto",
        padding: "24px 16px 48px",
        fontFamily: "system-ui, sans-serif",
        color: "#e6edf3",
      }}
    >
      <script
        type="application/ld+json"
        data-testid="jsonld"
        dangerouslySetInnerHTML={jsonLdScript(
          browseJsonLd({
            name: `${category.label} tier lists`,
            description: `Published ${category.label.toLowerCase()} lists.`,
            url: `${siteOrigin()}/browse/${category.id}`,
            results,
          }),
        )}
      />

      <p style={{ margin: "0 0 8px" }}>
        <Link href="/browse" style={{ color: "#8b98a6", fontSize: 13 }}>
          ← All categories
        </Link>
      </p>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>{category.label}</h1>
      <p style={{ margin: "0 0 20px", color: "#8b98a6" }}>
        {q ? <>Results for “{q}” in {category.label}.</> : `Published ${category.label.toLowerCase()} lists.`}
      </p>

      <SearchBox category={category.id} initial={q} />

      <BrowseGrid
        results={results}
        assetUrl={(assetId) => (client ? client.assetUrl(assetId) : "")}
        empty={q ? "Nothing matched that." : "Nothing published in this category yet."}
      />
    </main>
  );
}
