import type { RawDispatch } from "@/entities/dispatch/types";

export type SourceYield = {
  stored: number;
  waiting: number;
  analysed: number;
  queued: number;
  filtered: number;
  duplicates: number;
  failed: number;
};

const empty = (): SourceYield => ({
  stored: 0,
  waiting: 0,
  analysed: 0,
  queued: 0,
  filtered: 0,
  duplicates: 0,
  failed: 0,
});

/**
 * Per-source dispatch breakdown. Computed once for the whole archive rather than per source row,
 * which would rescan every dispatch for each of ~79 sources on every render.
 */
export function yieldBySourceOf(dispatches: readonly RawDispatch[]): Map<string, SourceYield> {
  const bySource = new Map<string, SourceYield>();
  for (const d of dispatches) {
    const y = bySource.get(d.sourceId) ?? empty();
    y.stored++;
    if (d.status === "processed") y.analysed++;
    else if (d.status === "irrelevant") y.filtered++;
    else if (d.status === "duplicate") y.duplicates++;
    else if (d.status === "failed") y.failed++;
    else if (d.status === "pending") y.waiting++;
    if (d.outcome === "queued") y.queued++;
    bySource.set(d.sourceId, y);
  }
  return bySource;
}
