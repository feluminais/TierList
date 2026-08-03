import type { MetadataRoute } from "next";

/**
 * `/editor`, `/lists` and `/compare` are per-device surfaces built from
 * `localStorage` — there is nothing stable behind them to index, and crawling
 * them spends budget that belongs on browse and on published lists.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/editor", "/editor/", "/lists", "/compare"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
