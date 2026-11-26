/**
 * Language Detection Accuracy (D0 of the v1.3.0 plan). A pure measure of the detector against
 * human-labelled text. It is reported in its own section and never combined with Resolution or
 * Withholding Precision.
 *
 * The critical cell is a decisive ru<->uk confusion: a detector that says "uk, decisive" about
 * Russian text (or the reverse) feeds a wrong language to the resolver. A non-decisive answer
 * is not a confident detection and can never be that kind of error.
 */
import type { DetectedLanguage, LanguageDetection } from "./language";

export interface LanguageAccuracySample {
  readonly truth: DetectedLanguage;
  readonly detection: Pick<LanguageDetection, "language" | "decisive">;
}

const LANGS: readonly DetectedLanguage[] = ["en", "ru", "uk", "unknown"];

export interface LanguageAccuracyReport {
  readonly total: number;
  /** matrix[truth][detected] */
  readonly matrix: Readonly<Record<DetectedLanguage, Readonly<Record<DetectedLanguage, number>>>>;
  readonly decisiveCount: number;
  /** decisiveCount / total, 0 when empty. */
  readonly decisiveRate: number;
  /** Decisive results whose language is wrong. */
  readonly decisiveErrors: number;
  /** Decisive ru for uk text, or decisive uk for ru text. Must be 0. */
  readonly decisiveRuUkConfusions: number;
}

export function languageDetectionAccuracy(
  samples: readonly LanguageAccuracySample[],
): LanguageAccuracyReport {
  const matrix = Object.fromEntries(
    LANGS.map((t) => [t, Object.fromEntries(LANGS.map((d) => [d, 0]))]),
  ) as Record<DetectedLanguage, Record<DetectedLanguage, number>>;
  let decisiveCount = 0;
  let decisiveErrors = 0;
  let decisiveRuUkConfusions = 0;
  for (const { truth, detection } of samples) {
    matrix[truth][detection.language]++;
    if (!detection.decisive) continue;
    decisiveCount++;
    if (detection.language !== truth) decisiveErrors++;
    if (
      (truth === "uk" && detection.language === "ru") ||
      (truth === "ru" && detection.language === "uk")
    ) {
      decisiveRuUkConfusions++;
    }
  }
  return {
    total: samples.length,
    matrix,
    decisiveCount,
    decisiveRate: samples.length === 0 ? 0 : decisiveCount / samples.length,
    decisiveErrors,
    decisiveRuUkConfusions,
  };
}

/** A labelled text for the decisive-claim check. `allowedDecisive: null` means no decisive claim is acceptable. */
export interface DecisionRow {
  readonly id: string;
  readonly category: string;
  readonly text: string;
  readonly allowedDecisive: "ru" | "uk" | "en" | null;
}

export interface DecisionCounts {
  readonly rows: number;
  readonly decisive: number;
  /** Decisive, and not the one allowed language (any decisive claim when none is allowed). */
  readonly falseDecisive: number;
  /** (rows - decisive) / rows, 0 when empty. */
  readonly nonDecisiveRate: number;
}

export interface DecisionSummary {
  readonly categories: readonly (DecisionCounts & { readonly category: string })[];
  readonly total: DecisionCounts;
  /** Ids only, never texts. */
  readonly falseDecisiveIds: readonly string[];
}

const counts = (rows: number, decisive: number, falseDecisive: number): DecisionCounts => ({
  rows,
  decisive,
  falseDecisive,
  nonDecisiveRate: rows === 0 ? 0 : (rows - decisive) / rows,
});

/**
 * Per-category and total counts of decisive and false-decisive results. Pure: the caller passes the
 * detector, and the summary contains counts and row ids only, never text.
 */
export function summariseDecisions(
  rows: readonly DecisionRow[],
  detect: (text: string) => Pick<LanguageDetection, "language" | "decisive">,
): DecisionSummary {
  const byCategory = new Map<string, { rows: number; decisive: number; falseDecisive: number }>();
  const falseDecisiveIds: string[] = [];
  for (const row of rows) {
    const d = detect(row.text);
    const c = byCategory.get(row.category) ?? { rows: 0, decisive: 0, falseDecisive: 0 };
    c.rows++;
    if (d.decisive) {
      c.decisive++;
      if (row.allowedDecisive === null || d.language !== row.allowedDecisive) {
        c.falseDecisive++;
        falseDecisiveIds.push(row.id);
      }
    }
    byCategory.set(row.category, c);
  }
  const all = [...byCategory.values()];
  const sum = (k: "rows" | "decisive" | "falseDecisive") => all.reduce((n, c) => n + c[k], 0);
  return {
    categories: [...byCategory].map(([category, c]) => ({
      category,
      ...counts(c.rows, c.decisive, c.falseDecisive),
    })),
    total: counts(sum("rows"), sum("decisive"), sum("falseDecisive")),
    falseDecisiveIds,
  };
}
