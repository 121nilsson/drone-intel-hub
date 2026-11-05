import type { WorkProgress } from "@/shared/infra/ingest/auto-ingest";
import { WORK_STALE_MS } from "@/shared/infra/ingest/auto-ingest";

export function progressAge(progress: WorkProgress): number | null {
  const age = Date.now() - Date.parse(progress.updatedAt);
  return Number.isFinite(age) ? age : null;
}

export function isActive(progress: WorkProgress | null): progress is WorkProgress {
  return !!progress && (progress.phase === "fetching" || progress.phase === "analysing");
}

/** A heartbeat still inside one provider attempt budget. */
export function isLive(progress: WorkProgress | null): progress is WorkProgress {
  if (!isActive(progress)) return false;
  const age = progressAge(progress);
  return age !== null && age <= WORK_STALE_MS;
}

export function isStalled(progress: WorkProgress | null): progress is WorkProgress {
  if (!isActive(progress)) return false;
  const age = progressAge(progress);
  return age !== null && age > WORK_STALE_MS;
}

export function formatWork(progress: WorkProgress): string {
  if (progress.phase === "analysing")
    return `Analysing · ${progress.current} · ${progress.index} of ${progress.total} · ${progress.remaining} waiting`;
  return `Fetching · ${progress.current} · ${progress.index} of ${progress.total}`;
}
