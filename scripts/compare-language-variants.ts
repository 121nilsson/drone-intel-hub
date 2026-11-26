/**
 * Development comparison of detector variants A and B (D0 revision 3, plan rule 6). Runs on the
 * development sets only: the corpus and the adversarial review set. It never reads the holdout.
 *
 *   npx tsx scripts/compare-language-variants.ts
 */
import { detectLanguageWithVariant } from "../src/entities/normalization/language";
import type { LanguageDetectorVariant } from "../src/entities/normalization/language";
import {
  summariseDecisions,
  type DecisionRow,
} from "../src/entities/normalization/language-accuracy";
import { LANGUAGE_CORPUS } from "../src/test/fixtures/language-detect-corpus";
import { ADVERSARIAL_CATEGORIES } from "../src/test/fixtures/language-detect-adversarial";

const corpusRows: DecisionRow[] = LANGUAGE_CORPUS.map((r, i) => ({
  id: `corpus-${i}`,
  category: r.category,
  text: r.text,
  // A decisive result is acceptable only for the true language (unknown: never).
  allowedDecisive: r.trueLanguage === "unknown" ? null : r.trueLanguage,
}));
const adversarialRows: DecisionRow[] = Object.entries(ADVERSARIAL_CATEGORIES).flatMap(
  ([category, rows]) =>
    rows.map((r, i) => ({
      id: `${category}#${i}`,
      category,
      text: r.text,
      allowedDecisive: r.allowed,
    })),
);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
for (const [name, rows] of [
  ["corpus", corpusRows],
  ["adversarial", adversarialRows],
] as const) {
  console.log(`\n== ${name} ==`);
  for (const variant of ["A", "B"] as LanguageDetectorVariant[]) {
    const s = summariseDecisions(rows, (t) => detectLanguageWithVariant(t, variant));
    console.log(
      `variant ${variant}: rows=${s.total.rows} decisive=${s.total.decisive} false-decisive=${s.total.falseDecisive} non-decisive=${pct(s.total.nonDecisiveRate)}`,
    );
    for (const c of s.categories)
      console.log(
        `  ${c.category}: rows=${c.rows} decisive=${c.decisive} false=${c.falseDecisive} nondec=${pct(c.nonDecisiveRate)}`,
      );
    if (s.falseDecisiveIds.length)
      console.log(`  false-decisive ids: ${s.falseDecisiveIds.join(" | ")}`);
  }
}
