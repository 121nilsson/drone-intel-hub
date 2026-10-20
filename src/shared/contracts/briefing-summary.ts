/** Regenerate at most about twice per day; the drift feed still updates live. */
export const BRIEFING_SUMMARY_TTL_MS = 12 * 60 * 60 * 1000;

export interface BriefingSummaryCache {
  summary: string;
  generatedAt: number;
}

export interface BriefingSummaryStored extends BriefingSummaryCache {
  contextFingerprint: string;
}

export function isBriefingSummaryFresh(generatedAt: number, now = Date.now()): boolean {
  return now - generatedAt <= BRIEFING_SUMMARY_TTL_MS;
}

export function parseBriefingSummaryStored(raw: unknown): BriefingSummaryStored | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o["summary"] !== "string" || typeof o["generatedAt"] !== "number") return null;
  if (typeof o["contextFingerprint"] !== "string" || !o["contextFingerprint"]) return null;
  return {
    summary: o["summary"],
    generatedAt: o["generatedAt"],
    contextFingerprint: o["contextFingerprint"],
  };
}
