import { createClient } from "@tl/api-client";
import { compare, type Bucket, type ComparisonResult, type Participant } from "@tl/core";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { CodeBar } from "./CodeBar";

export const metadata: Metadata = {
  title: "Compare tier lists",
  description: "See what two filled tier lists agree on, and what they would argue about.",
};

/** Same short window as the share page: a fill keeps changing while it is filled. */
export const revalidate = 30;

interface PageProps {
  searchParams: Promise<{ codes?: string }>;
}

function serverClient() {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl) return null;
  return createClient({ baseUrl, fetch: globalThis.fetch });
}

const BUCKET_TITLES: Record<Bucket, string> = {
  agreed: "Agreed",
  close: "Close",
  contested: "Contested",
  incomplete: "Incomplete",
};

const BUCKET_BLURBS: Record<Bucket, string> = {
  agreed: "Same tier, both of you.",
  close: "One tier apart.",
  contested: "Two tiers apart or more.",
  incomplete: "Somebody left it in the tray.",
};

export default async function ComparePage({ searchParams }: PageProps) {
  const { codes: raw } = await searchParams;
  const codes = (raw ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  const client = serverClient();
  const loaded = client
    ? await Promise.all(
        codes.map(async (code) => ({ code, share: await client.getShare(code).catch(() => null) })),
      )
    : codes.map((code) => ({ code, share: null }));

  const missing = loaded.filter((l) => !l.share).map((l) => l.code);
  const participants: Participant[] = loaded
    .filter((l) => l.share)
    .map((l) => ({
      id: l.code,
      label: l.share!.document.title || l.code,
      doc: l.share!.document,
    }));

  const result = participants.length > 0 ? compare(participants) : null;

  return (
    <main style={page}>
      <h1 style={{ fontSize: 28, margin: "0 0 4px" }}>Compare</h1>
      <p style={{ margin: "0 0 20px", color: "#8b98a6" }}>
        Paste two or more share links. Everyone had to fill in the same template.
      </p>

      <CodeBar codes={codes} />

      {!client ? (
        <p style={warned}>Not connected to an API, so there is nothing to load.</p>
      ) : missing.length > 0 ? (
        <p style={warned} role="alert" data-testid="compare-missing">
          Could not find {missing.join(", ")}.
        </p>
      ) : null}

      {codes.length === 0 ? (
        <p style={{ color: "#8b98a6" }} data-testid="compare-empty">
          Nothing to compare yet.
        </p>
      ) : result ? (
        <Result result={result} />
      ) : null}
    </main>
  );
}

function Result({ result }: { result: ComparisonResult }) {
  const scored = result.items.filter((i) => i.bucket !== "incomplete").length;

  return (
    <>
      {result.warnings.length > 0 ? (
        <ul style={warnings} data-testid="compare-warnings">
          {result.warnings.map((w) => (
            <li key={w.kind}>{w.message}</li>
          ))}
        </ul>
      ) : null}

      <section style={headline}>
        <div>
          <div data-testid="agreement" style={{ fontSize: 46, fontWeight: 700, lineHeight: 1 }}>
            {result.agreement === null ? "—" : `${Math.round(result.agreement * 100)}%`}
          </div>
          <div style={{ color: "#8b98a6" }}>
            {result.agreement === null
              ? "nothing in common to score"
              : `agreement over ${scored} ${scored === 1 ? "item" : "items"}`}
          </div>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, color: "#8b98a6" }}>
          {result.participants.map((p) => (
            <li key={p.id} data-testid="compare-participant">
              <strong style={{ color: "#e6edf3" }}>{p.label}</strong>{" "}
              <span style={{ fontFamily: "monospace", fontSize: 12 }}>{p.id}</span>
            </li>
          ))}
        </ul>
      </section>

      {result.polarising.length > 0 ? (
        <section style={{ ...group, borderColor: "#7c3aed" }} data-testid="compare-polarising">
          <h2 style={groupTitle}>
            Polarising{" "}
            <span style={{ color: "#8b98a6", fontWeight: 400, fontSize: 13 }}>
              opposite halves of the scale — the interesting ones
            </span>
          </h2>
          <ItemRows result={result} itemIds={result.polarising} />
        </section>
      ) : null}

      {(["contested", "close", "agreed", "incomplete"] as Bucket[]).map((bucket) =>
        result.buckets[bucket].length > 0 ? (
          <section key={bucket} style={group} data-testid={`compare-bucket-${bucket}`}>
            <h2 style={groupTitle}>
              {BUCKET_TITLES[bucket]}{" "}
              <span style={{ color: "#8b98a6", fontWeight: 400, fontSize: 13 }}>
                {BUCKET_BLURBS[bucket]}
              </span>
            </h2>
            <ItemRows result={result} itemIds={result.buckets[bucket]} />
          </section>
        ) : null,
      )}
    </>
  );
}

/** One row per item, showing where each participant put it. */
function ItemRows({ result, itemIds }: { result: ComparisonResult; itemIds: string[] }) {
  const byId = new Map(result.items.map((i) => [i.itemId, i]));
  const tierLabel = (rank: number) => result.scale?.labels[rank] ?? String(rank);

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
      {itemIds.map((id) => {
        const item = byId.get(id);
        if (!item) return null;
        return (
          <li key={id} style={row} data-testid="compare-item">
            <span style={{ flex: 1 }}>{item.label || id}</span>
            {result.participants.map((p) => {
              const rank = item.ranks[p.id];
              return (
                <span
                  key={p.id}
                  title={p.label}
                  data-testid="compare-rank"
                  style={rank === undefined ? unranked : tier}
                >
                  {rank === undefined ? "—" : tierLabel(rank)}
                </span>
              );
            })}
          </li>
        );
      })}
    </ul>
  );
}

const page: CSSProperties = {
  width: "100%",
  maxWidth: 900,
  margin: "0 auto",
  padding: "24px 16px 48px",
  fontFamily: "system-ui, sans-serif",
  color: "#e6edf3",
};

const headline: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  padding: 16,
  marginBottom: 16,
  background: "#12161b",
  border: "1px solid #232a33",
  borderRadius: 10,
};

const group: CSSProperties = {
  padding: 14,
  marginBottom: 12,
  background: "#0e1216",
  border: "1px solid #232a33",
  borderRadius: 10,
};

const groupTitle: CSSProperties = { margin: "0 0 10px", fontSize: 15 };

const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 10px",
  background: "#12161b",
  borderRadius: 6,
};

const tier: CSSProperties = {
  minWidth: 30,
  textAlign: "center",
  padding: "2px 6px",
  background: "#2b3542",
  borderRadius: 5,
  fontSize: 12,
  fontWeight: 700,
};

const unranked: CSSProperties = { ...tier, background: "transparent", color: "#5b6673" };

const warnings: CSSProperties = {
  margin: "0 0 16px",
  padding: "10px 14px 10px 30px",
  background: "rgba(251,191,36,0.08)",
  border: "1px solid #6b5320",
  borderRadius: 8,
  color: "#fbbf24",
  fontSize: 13,
};

const warned: CSSProperties = { color: "#fbbf24" };
