import { CATEGORIES } from "@tl/core";
import type { MetadataRoute } from "next";
import { browseResults } from "./browse/api";

/**
 * Rebuilt hourly. A sitemap baked once at build time would never mention a
 * list published after the deploy, which is every list.
 */
export const revalidate = 3600;

/** Where this deployment is reachable. Relative URLs are not valid in a sitemap. */
function origin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/**
 * The pages worth crawling.
 *
 * Only publicly listed lists appear. A share code is unlisted by default and
 * putting one here would publish, to every crawler, a link its author only
 * meant to send to a friend — the same distinction the `listed` column exists
 * to keep.
 *
 * The editor, `/lists` and `/compare` are deliberately absent: they are
 * per-device surfaces with nothing stable to index.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = origin();

  const stable: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/browse`, changeFrequency: "daily", priority: 0.8 },
    ...CATEGORIES.map((c) => ({
      url: `${base}/browse/${c.id}`,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];

  // A sitemap that cannot reach the API is the stable pages rather than a
  // build failure: the crawler gets less, not nothing.
  const listed = await browseResults({}).catch(() => []);

  return [
    ...stable,
    ...listed.map((result) => ({
      url: `${base}/l/${result.code}`,
      lastModified: new Date(result.updatedAt),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
