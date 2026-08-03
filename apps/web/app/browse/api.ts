import { createClient, type BrowseResult } from "@tl/api-client";

/**
 * The API as reached from the server.
 *
 * `NEXT_PUBLIC_API_URL` is written out in full so the bundler can inline it —
 * a destructured or computed read is not substituted. No token: browse and the
 * asset endpoint are both public.
 */
export function browseClient() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return null;
  return createClient({ baseUrl, fetch: globalThis.fetch });
}

/**
 * Results for a browse page, or an empty list.
 *
 * A browse page that cannot reach the API shows nothing rather than an error:
 * it is a discovery surface, and a stack trace where a grid should be is worse
 * for a first-time visitor than an empty one.
 */
export async function browseResults(params: {
  category?: string | null;
  q?: string | null;
}): Promise<BrowseResult[]> {
  const client = browseClient();
  if (!client) return [];
  return client.browse(params).catch(() => []);
}
