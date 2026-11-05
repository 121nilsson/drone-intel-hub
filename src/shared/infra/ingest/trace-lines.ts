import { MAX_ATTEMPTS, type RawDispatch } from "@/entities/dispatch/types";
import { type PipelineDeps, type PipelineResult } from "@/shared/infra/ingest/pipeline";
import { traceLevel } from "@/shared/infra/pipeline-trace";
import type { ProcessReport } from "@/shared/infra/ingest/ingest-reports";
import { postExcerpt } from "@/shared/infra/ingest/ingest-progress";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The per-item log line: what ran, what was found, what was written.
 *
 * Ordered so the two things you scan for are in a fixed place — position and source at the front,
 * outcome and remaining backlog at the end — with the diagnostics in between. Optional parts drop
 * out rather than printing a placeholder, so a line never contains "undefined" and a missing
 * stage reads as absent rather than as a value.
 */
export function describeItem(
  d: RawDispatch,
  r: PipelineResult,
  index: number,
  total: number,
  rep: ProcessReport,
  deps: PipelineDeps,
  remaining: number,
): (string | number | undefined)[] {
  const e = r.candidate.extraction;
  const t = r.trace;
  // The catalog name, not the extracted one: on a merge these can differ, and the line is
  // about what the catalog now holds.
  const target =
    r.kind === "auto-merged" || r.kind === "auto-promoted" ? deps.drones.get(r.droneId) : undefined;
  const name = target?.name ?? e.name ?? "unidentified";

  const engines = t?.engines.length ? t.engines.join("+") : (e.metadata?.engine ?? "unknown");
  const found = [
    plural(t?.systems ?? 1, "system"),
    plural(t?.specs ?? e.specs.length, "spec"),
  ].join(", ");

  let added: string;
  if (r.kind === "auto-merged") {
    const addedSpecs = t?.specsMerged;
    added = `merged into ${JSON.stringify(name)}${addedSpecs ? ` (+${addedSpecs} specs)` : ""}`;
  } else if (r.kind === "auto-promoted") {
    added = `promoted new catalog entry ${JSON.stringify(name)}`;
  } else if (r.kind === "auto-discarded") {
    added = `discarded (conf below threshold)`;
  } else {
    added = "queued for review";
  }

  return [
    `${index}/${total}`,
    d.sourceName,
    `engine=${engines}`,
    e.metadata?.model ? `model=${e.metadata.model}` : undefined,
    `conf=${Math.round(e.confidence * 100)}%`,
    `found ${found}`,
    ...(t?.reasons.length ? [`why=${t.reasons.join(",")}`] : []),
    ...(t?.degraded.length ? [`degraded=${t.degraded.join(";")}`] : []),
    ...(r.relatedCandidates?.length ? [plural(r.relatedCandidates.length, "related")] : []),
    traceLevel() >= 2 ? `excerpt=${JSON.stringify(postExcerpt(d.text))}` : undefined,
    added,
    `left=${remaining}`,
    `run: ${rep.processed} analysed, ${rep.merged} merged, ${rep.promoted} promoted`,
  ];
}

/** The same line for a post the pre-filter dropped before any model was called. */
export function describeIrrelevant(
  d: RawDispatch,
  index: number,
  total: number,
  remaining: number,
): (string | number | undefined)[] {
  return [
    `${index}/${total}`,
    d.sourceName,
    "engine=pre-filter",
    "found 0 systems",
    "skipped (no drone signal)",
    traceLevel() >= 2 ? `excerpt=${JSON.stringify(postExcerpt(d.text))}` : undefined,
    `left=${remaining}`,
  ];
}
