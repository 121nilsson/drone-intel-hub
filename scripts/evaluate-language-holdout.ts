/**
 * Single evaluation of the language detector on an independent holdout (D0 revision 3).
 *
 * Prints counts only: per category (rows, decisive, false-decisive, non-decisive rate), totals, the
 * detector version, and the ids of false-decisive rows. It never prints a text. Run it once, in a
 * session that has not seen the holdout texts, after the rule and the word list are frozen.
 *
 * The guard in `language-holdout.ts` refuses a consumed holdout or a detector version other than
 * the one the holdout is reserved for, before the holdout is loaded (review finding R5).
 *
 *   npx tsx scripts/evaluate-language-holdout.ts [--holdout v1]
 */
import {
  LANGUAGE_DETECTOR_VERSION,
  detectLanguageWithEvidence,
} from "../src/entities/normalization/language";
import { summariseDecisions } from "../src/entities/normalization/language-accuracy";
import { runHoldoutEvaluation } from "../src/entities/normalization/language-holdout";

interface HoldoutRow {
  readonly id: string;
  readonly category: string;
  readonly text: string;
  readonly allowedDecisive: "ru" | "uk" | "en" | null;
}

const args = process.argv.slice(2);
const i = args.indexOf("--holdout");
const holdoutId = i >= 0 && args[i + 1] ? args[i + 1]! : "v1";
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const result = await runHoldoutEvaluation<readonly HoldoutRow[]>({
  holdoutId,
  detectorVersion: LANGUAGE_DETECTOR_VERSION,
  load: async () =>
    (await import("../src/test/fixtures/language-detect-holdout")).LANGUAGE_DETECT_HOLDOUT,
  evaluate: (holdout) => {
    const summary = summariseDecisions(
      holdout.map((r) => ({
        id: r.id,
        category: r.category,
        text: r.text,
        allowedDecisive: r.allowedDecisive,
      })),
      detectLanguageWithEvidence,
    );
    console.log(`holdout ${holdoutId}, detector version: ${LANGUAGE_DETECTOR_VERSION}`);
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
  },
});
if (!result.ran) {
  process.stderr.write(`refused: ${result.refusal}\n`);
  process.exit(2);
}
