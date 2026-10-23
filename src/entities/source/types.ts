import type { Domain } from "@/entities/drone/types";

export type SourcePlatform = "X" | "Telegram" | "RSS" | "Web" | "Bluesky";
export const PLATFORMS: SourcePlatform[] = ["X", "Telegram", "RSS", "Web", "Bluesky"];

export interface MonitoredSource {
  id: string;
  name: string;
  platform: SourcePlatform;
  handle: string; // URL or @handle
  domain: Domain;
  notes: string;
  lastFetched?: string;
  /** Post IDs already ingested — prevents duplicates across syncs. */
  seenIds?: string[];
  lastError?: string | undefined;
  /** False turns the source off: no scheduled or "fetch all" collection. */
  autoSync?: boolean;
  /** Consecutive failed fetches; reset by any success. See features/sources/source-health.ts. */
  failStreak?: number | undefined;
  /** Set after repeated failures: the source is skipped until then, then tried again. */
  pausedUntil?: string | undefined;
  /** The source has been paused before and not recovered since; failing again turns it off. */
  pausedOnce?: boolean | undefined;
  /** Why automation turned the source off, shown on the Sources page. */
  disabledReason?: string | undefined;
  /**
   * Consecutive fetches that answered 200 with zero posts. Never a failure on its own - a feed
   * that publishes weekly is legally empty most ticks - but the streak is what tells a parser
   * change from a quiet day. See SILENT_RUNS in features/sources/source-health.ts.
   */
  emptyStreak?: number | undefined;
  /** Last fetch that returned at least one post: proof this source's parser still works. */
  lastPostAt?: string | undefined;
}
