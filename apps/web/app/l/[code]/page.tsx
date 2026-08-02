import { createClient, type SharedList } from "@tl/api-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaticBoard } from "./StaticBoard";

/**
 * A public page is server-rendered on every request rather than cached at
 * build time — the list behind a code keeps changing, and a stale board is
 * worse than a slightly slower one. `revalidate` gives the platform's own
 * cache a short window, so a link that lands in a busy channel does not become
 * one API round trip per reader.
 */
export const revalidate = 30;

interface PageProps {
  // Next 15+ hands route params as a promise.
  params: Promise<{ code: string }>;
}

/**
 * The API as reached from the *server*.
 *
 * `NEXT_PUBLIC_API_URL` is written out in full so the bundler can inline it,
 * exactly as `useApiClient` does — a destructured or computed read is not
 * substituted. No token: every endpoint this page touches is public, which is
 * the whole point of a share code.
 */
function serverClient() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return null;
  return createClient({ baseUrl, fetch: globalThis.fetch });
}

async function loadShare(code: string): Promise<SharedList | null> {
  const client = serverClient();
  if (!client) return null;
  // A share that cannot be fetched is a page that cannot be rendered, but it
  // is not a crash: an API that is down should give a reader "not found"
  // rather than a stack trace, and the alternative is a 500 on every link.
  return client.getShare(code).catch(() => null);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const share = await loadShare(code);
  if (!share) return { title: "Tier list not found" };

  const doc = share.document;
  const title = doc.title || "Untitled tier list";
  // Falls back to something factual rather than to marketing copy: a preview
  // card in a chat window is the only description most readers will ever see,
  // and "12 items across 5 tiers" tells them more than a slogan would.
  const description =
    doc.description ||
    `${doc.items.length} ${plural(doc.items.length, "item")} across ${doc.rows.length} ${plural(doc.rows.length, "tier")}.`;

  const client = serverClient();
  const image = share.ogAssetId && client ? client.assetUrl(share.ogAssetId) : null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      // `images: []` rather than `undefined` when there is none, so a share
      // created before its preview was rendered does not inherit some other
      // page's image from a parent layout.
      images: image ? [{ url: image }] : [],
    },
    twitter: {
      // The large card is what makes a pasted link show the board rather than
      // a thumbnail beside two lines of text — this milestone's whole
      // acceptance test is what the link looks like in Discord.
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : [],
    },
  };
}

export default async function SharedListPage({ params }: PageProps) {
  const { code } = await params;
  const share = await loadShare(code);
  if (!share) notFound();

  const client = serverClient();
  const doc = share.document;

  return (
    <main
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "24px 16px 48px",
        fontFamily: "system-ui, sans-serif",
        color: "#e6edf3",
      }}
    >
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>{doc.title || "Untitled tier list"}</h1>
      {doc.description ? (
        <p style={{ margin: "0 0 16px", color: "#8b98a6" }}>{doc.description}</p>
      ) : (
        <p style={{ margin: "0 0 16px", color: "#8b98a6" }}>
          {doc.items.length} {plural(doc.items.length, "item")} · {doc.rows.length}{" "}
          {plural(doc.rows.length, "tier")}
        </p>
      )}

      <StaticBoard
        doc={doc}
        assetUrl={(id) => (client ? client.assetUrl(id) : "")}
        sources={new Map(share.assets.map((a) => [a.id, { width: a.width, height: a.height }]))}
      />
    </main>
  );
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
