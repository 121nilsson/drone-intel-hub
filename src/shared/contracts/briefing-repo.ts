import type { BriefingSummaryStored } from "@/shared/contracts/briefing-summary";

/** The `sync_state` slot that holds the shared executive summary. */
export const BRIEFING_SUMMARY_SLOT = "briefing:executive_summary";

/** Port for the shared briefing summary. Methods throw on a storage failure. */
export interface BriefingRepo {
  /** The stored summary document as it was saved, or undefined when none is stored. */
  readSummary(): Promise<unknown>;
  /** Store the summary, replacing any previous one. */
  writeSummary(entry: BriefingSummaryStored): Promise<void>;
}
