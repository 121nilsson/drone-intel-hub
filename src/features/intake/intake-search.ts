/**
 * URL codec for the intake queue's page. "Show more" reveals the next block of pending
 * candidates; keeping that count in the URL means a reload or a shared link lands on the same
 * depth instead of collapsing back to the first block.
 *
 * Page 1 is the default, so it is never written: a bare /intake stays bare. Anything that is not
 * a positive integer reads as page 1, which keeps a hand-edited URL from breaking the page.
 */
export const INTAKE_PAGE_SIZE = 20;

export interface IntakeSearch {
  draft?: string;
  source?: string;
  page?: string;
}

/** The page number in a URL value: a positive integer, anything else is page 1. */
export function parseIntakePage(raw: unknown): number {
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return 1;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : 1;
}

/** Shallow search params for validateSearch: the page param only when it is past the first. */
export function intakePageParams(raw: unknown): { page?: string } {
  const page = parseIntakePage(raw);
  return page > 1 ? { page: String(page) } : {};
}

/** The search to navigate to for `page`, keeping draft and source and dropping a stale page. */
export function withIntakePage(prev: IntakeSearch, page: number): IntakeSearch {
  const next: IntakeSearch = { ...prev };
  delete next.page;
  if (page > 1) next.page = String(page);
  return next;
}
