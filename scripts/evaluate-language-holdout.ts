/**
 * Single evaluation of the language detector on the independent holdout (D0 revision 3).
 *
 * Prints counts only: per category (rows, decisive, false-decisive, non-decisive rate), totals, the
 * detector version, and the ids of false-decisive rows. It never prints a text. Run it once, in a
 * session that has not seen the holdout texts, after the rule and the word list are frozen.
 *
 *   npx tsx scripts/evaluate-language-holdout.ts
 */
import {
  LANGUAGE_DETECTOR_VERSION,
  detectLanguageWithEvidence,
} from "../src/entities/normalization/language";
import { summariseDecisions } from "../src/entities/normalization/language-accuracy";
import { LANGUAGE_DETECT_HOLDOUT } from "../src/test/fixtures/language-detect-holdout";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const summary = summariseDecisions(
  LANGUAGE_DETECT_HOLDOUT.map((r) => ({
    id: r.id,
    category: r.category,
    text: r.text,
    allowedDecisive: r.allowedDecisive,
  })),
  detectLanguageWithEvidence,
);

console.log(`detector version: ${LANGUAGE_DETECTOR_VERSION}`);
for (const c of summary.categories) {
  console.log(
    `${c.category}: rows=${c.rows} decisive=${c.decisive} false-decisive=${c.falseDecisive} non-decisive=${pct(c.nonDecisiveRate)}`,
  );
}
const t = summary.total;
console.log(
  `TOTAL: rows=${t.rows} decisive=${t.decisive} false-decisive=${t.falseDecisive} non-decisive=${pct(t.nonDecisiveRate)}`,
);
console.log(
  `false-decisive ids: ${summary.falseDecisiveIds.length ? summary.falseDecisiveIds.join(", ") : "none"}`,
);
