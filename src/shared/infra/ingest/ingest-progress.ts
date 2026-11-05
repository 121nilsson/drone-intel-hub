/** Label the server job uses for its stage-2 queue row, which is not a monitored source. */
export const QUEUE_ROW = "Queue";

/** Longer than one provider attempt budget (3 × 90s plus backoff), so a slow call is not "stalled". */
export const WORK_STALE_MS = 6 * 60_000;

export type WorkPhase = "fetching" | "analysing" | "done";

/** Heartbeat for the Sources status strip. The auto-sync job persists this; a tab holds it in memory. */
export interface WorkProgress {
  phase: WorkPhase;
  /** Source name, or source name plus a short quoted excerpt while analysing. */
  current: string;
  /** Dispatch id while analysing, so the archive row can be tagged. */
  currentId?: string;
  index: number;
  total: number;
  processed: number;
  irrelevant: number;
  merged: number;
  /** Optional: heartbeats written before auto-triage existed lack them. */
  promoted?: number;
  discarded?: number;
  queued: number;
  failed: number;
  remaining: number;
  updatedAt: string;
}

/** Fired at the start of a post, before it is marked, with the counts from earlier posts in this batch. */
export interface WorkItemEvent {
  id: string;
  sourceName: string;
  excerpt: string;
  index: number;
  total: number;
  processed: number;
  irrelevant: number;
  merged: number;
  promoted: number;
  discarded: number;
  queued: number;
  failed: number;
  remaining: number;
}

const EXCERPT_LEN = 80;

export function postExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_LEN) return flat;
  return `${flat.slice(0, EXCERPT_LEN - 1)}…`;
}

export function fetchingProgress(name: string, index: number, total: number): WorkProgress {
  return {
    phase: "fetching",
    current: name,
    index,
    total,
    processed: 0,
    irrelevant: 0,
    merged: 0,
    queued: 0,
    failed: 0,
    remaining: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function progressFromItem(event: WorkItemEvent): WorkProgress {
  return {
    phase: "analysing",
    current: event.excerpt ? `${event.sourceName} · "${event.excerpt}"` : event.sourceName,
    currentId: event.id,
    index: event.index,
    total: event.total,
    processed: event.processed,
    irrelevant: event.irrelevant,
    merged: event.merged,
    promoted: event.promoted,
    discarded: event.discarded,
    queued: event.queued,
    failed: event.failed,
    remaining: event.remaining,
    updatedAt: new Date().toISOString(),
  };
}
