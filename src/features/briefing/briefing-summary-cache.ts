import {
  BRIEFING_SUMMARY_TTL_MS,
  type BriefingSummaryCache,
  isBriefingSummaryFresh,
} from "@/features/briefing/briefing-summary-shared";

export { BRIEFING_SUMMARY_TTL_MS, type BriefingSummaryCache };

const STORAGE_KEY = "dti.briefing.summary.v1";

export function readBriefingSummaryCache(now = Date.now()): BriefingSummaryCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BriefingSummaryCache;
    if (typeof parsed.summary !== "string" || typeof parsed.generatedAt !== "number") return null;
    if (!isBriefingSummaryFresh(parsed.generatedAt, now)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeBriefingSummaryCache(entry: BriefingSummaryCache) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
}
