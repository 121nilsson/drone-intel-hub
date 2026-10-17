import type { DispatchStatus } from "@/entities/dispatch/types";

/**
 * Feed status filter tabs plus the URL codec for the feed's filters. Like the catalog, the feed
 * view (status tab, source pick) is shareable state — an analyst pastes "what happened on this
 * channel today" into a chat without describing their tab settings.
 */
export const DISPATCH_FILTERS = [
  "all",
  "pending",
  "processed",
  "irrelevant",
  "failed",
  "duplicate",
] as const;
export type DispatchFilter = (typeof DISPATCH_FILTERS)[number];

export interface FeedState {
  q: string;
  status: DispatchFilter;
  sourceId: string;
}

const FILTERS: DispatchFilter[] = [...DISPATCH_FILTERS];

/** Validate the URL search into shallow params; anything unknown is dropped wholesale. */
export function parseFeedSearchParams(s: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof s["q"] === "string" && s["q"]) out["q"] = s["q"];
  if (typeof s["status"] === "string" && (FILTERS as string[]).includes(s["status"]))
    out["status"] = s["status"];
  if (typeof s["source"] === "string" && s["source"]) out["source"] = s["source"];
  return out;
}

export function fromFeedParams(p: Record<string, string>): FeedState {
  return {
    q: p["q"] ?? "",
    status: (FILTERS.find((f) => f === p["status"]) ?? "all") as DispatchFilter,
    sourceId: p["source"] ?? "",
  };
}

export function toFeedSearch(state: FeedState): Record<string, string> {
  const out: Record<string, string> = {};
  if (state.q) out["q"] = state.q;
  if (state.status !== "all") out["status"] = state.status;
  if (state.sourceId) out["source"] = state.sourceId;
  return out;
}
