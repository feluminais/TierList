import type { TierList } from "./types";

/**
 * Whether two documents hold the same content, whatever order their keys are in.
 *
 * A document crosses representations that keep keys in an order of their own —
 * a Postgres `jsonb` column above all — so comparing serialised text directly
 * would call two identical documents different.
 */
export function sameDocument(a: TierList, b: TierList): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([x], [y]) =>
            x < y ? -1 : x > y ? 1 : 0,
          ),
        )
      : v,
  );
}
