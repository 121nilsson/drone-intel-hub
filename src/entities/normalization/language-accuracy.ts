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
