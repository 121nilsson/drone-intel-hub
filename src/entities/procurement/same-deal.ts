import { parseMoney } from "@/entities/normalization/currency";
import type { Procurement } from "./types";

const UNKNOWN = /^(unknown|n\/a|-|—)?$/i;

/** True when the field holds no real value ("Unknown", empty). */
export const isUnknown = (v: string | undefined) => UNKNOWN.test((v ?? "").trim());

/** One report's figure: "$32 million", "US$32 million" and "$32M" are the same amount. */
function dealKey(p: Procurement): string {
  const where = p.sourceUrl ?? p.sourceId ?? p.source;
  const money = p.amount ? parseMoney(p.amount) : undefined;
  const amount = money
    ? `${money.currency}:${money.amount}`
    : (p.amount ?? "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  return `${where.trim().toLowerCase()}|${amount}`;
}

/** How much a row says: a named company and buyer outrank a row of unknowns. */
function completeness(p: Procurement): number {
  return (
    (isUnknown(p.company) ? 0 : 4) +
    (isUnknown(p.customer) ? 0 : 2) +
    (p.country ? 1 : 0) +
    (p.systemIds?.length ?? 0) / 100
  );
}

/**
 * Rows that are one deal read more than once - the same report and the same figure, once with
 * the company unread and twice with it - shown as one row with a count. The most complete row
 * stands for the group; the others are not lost, only folded. Order follows the input.
 */
export function groupSameDeal(
  rows: readonly Procurement[],
): { contract: Procurement; reports: number }[] {
  const groups = new Map<string, Procurement[]>();
  for (const p of rows) {
    const k = dealKey(p);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out: { contract: Procurement; reports: number }[] = [];
  const seen = new Set<string>();
  for (const p of rows) {
    const k = dealKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const group = groups.get(k)!;
    const best = group.reduce((a, b) => (completeness(b) > completeness(a) ? b : a));
    out.push({ contract: best, reports: group.length });
  }
  return out;
}
