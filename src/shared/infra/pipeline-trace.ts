/**
 * Per-item pipeline tracing.
 *
 * Ingestion is otherwise a black box: a sync run reports one aggregate line ("20 analysed, 7
 * merged"), which tells you something went wrong but not which post, which engine ran, or what
 * was found. This emits one line per item so a failing run can be read straight out of
 * `docker compose logs app`.
 *
 * Lives in shared/infra because both sides of the pipeline need it - `features/intake` builds
 * the trace, `features/sources` prints it - and a feature may not import another feature.
 *
 *   PIPELINE_TRACE=0        off (default is ON: a run is exactly when you want the detail)
 *   PIPELINE_TRACE=verbose  adds the post excerpt and per-tier stage lines
 *
 * Nothing here may throw: tracing is observability, and an exception from a logger would take
 * down the batch it was meant to describe.
 */

export type TraceLevel = 0 | 1 | 2;

/**
 * Read per call rather than cached in a module-level const.
 *
 * The rest of the codebase caches such values at import, which is right for values that cannot
 * change at runtime - but this one is exactly what a test needs to flip between cases, and a
 * frozen const would make that untestable.
 */
export function traceLevel(): TraceLevel {
  const raw = (process.env["PIPELINE_TRACE"] ?? "").trim().toLowerCase();
  if (!raw) return 1;
  if (raw === "0" || raw === "off" || raw === "false" || raw === "no") return 0;
  if (raw === "2" || raw === "verbose" || raw === "debug") return 2;
  return 1;
}

/**
 * One line per item, built from ordered parts.
 *
 * Empty parts drop out rather than printing `undefined` or a dangling separator, which is what
 * makes it safe to pass optional values straight through. Length is capped so one pathological
 * post cannot emit a megabyte-long log line.
 */
const MAX_PART = 80;

export function traceItem(parts: readonly (string | number | undefined | null)[]): void {
  if (traceLevel() === 0) return;
  try {
    const line = parts
      .flatMap((p) => (p === undefined || p === null || p === "" ? [] : [String(p)]))
      .map((p) => (p.length > MAX_PART ? `${p.slice(0, MAX_PART - 1)}…` : p))
      .join(" · ");
    if (line) console.log(`[pipeline] ${line}`);
  } catch {
    /* tracing must never fail a batch */
  }
}

/** Stage-level detail, only under PIPELINE_TRACE=verbose. */
export function traceStage(stage: string, detail: string): void {
  if (traceLevel() < 2) return;
  try {
    console.log(`[pipeline] ${stage} · ${detail}`);
  } catch {
    /* tracing must never fail a batch */
  }
}

/**
 * A failure, logged whatever the level is set to.
 *
 * Deliberately not gated: an item that errored has no other console trace, and `PIPELINE_TRACE=0`
 * is about cutting volume on a healthy run of hundreds of items, not about silencing the one
 * line that explains why a run stopped.
 */
export function traceFailure(parts: readonly (string | number | undefined | null)[]): void {
  try {
    const line = parts
      .flatMap((p) => (p === undefined || p === null || p === "" ? [] : [String(p)]))
      .join(" · ");
    if (line) console.log(`[pipeline] ${line}`);
  } catch {
    /* tracing must never fail a batch */
  }
}
