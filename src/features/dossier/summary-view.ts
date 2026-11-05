/**
 * What the dossier's summary area shows, decided in one place.
 *
 * It used to show up to four things in a row on opening a system: the scraped text, a "translating"
 * line, the translation, and finally the AI brief. Each came from its own effect and each replaced
 * the last, so the area changed shape three times in a few seconds. Now one view is chosen from the
 * state, and a brief that is about to be generated is waited for rather than shown around.
 */
export type SummaryView =
  /** The AI brief, with its sections. */
  | "brief"
  /** A brief is being or about to be generated: the scraped text, quiet, with a status line. */
  | "generating"
  /** The scraped text's English translation, with the original behind a disclosure. */
  | "translated"
  /** A translation is on its way. */
  | "translating"
  /** The scraped text as it is. */
  | "plain";

export interface SummaryState {
  hasBrief: boolean;
  /** The store is attached, so the server's AI configuration is known. Nothing is decided before. */
  ready: boolean;
  aiConfigured: boolean;
  /** The brief is missing, stale, or built from older evidence. */
  briefNeedsWork: boolean;
  briefError: string | null;
  translated: string | null;
  translating: boolean;
}

/**
 * True while a brief is, or is about to be, generated on its own: the translation is then pointless
 * (the brief replaces the text it would translate) and showing it only adds a step.
 */
export function awaitingBrief(
  s: Pick<SummaryState, "ready" | "aiConfigured" | "briefNeedsWork" | "briefError" | "hasBrief">,
) {
  return !s.ready || (!s.hasBrief && s.aiConfigured && s.briefNeedsWork && !s.briefError);
}

export function summaryView(s: SummaryState): SummaryView {
  if (s.hasBrief) return "brief";
  if (!s.ready) return "plain";
  if (awaitingBrief(s)) return "generating";
  if (s.translated) return "translated";
  if (s.translating) return "translating";
  return "plain";
}
