import { describe, expect, it } from "vitest";
import {
  detectLanguageWithEvidence,
  detectLanguageWithVariant,
} from "@/entities/normalization/language";

import {
  ADVERSARIAL_CATEGORIES as CATEGORIES,
  type AdversarialRow,
} from "./fixtures/language-detect-adversarial";

/** A decisive stamp is deserved only when it names the one allowed language. */
function deservesItsStamp(row: AdversarialRow): boolean {
  const d = detectLanguageWithEvidence(row.text);
  return !d.decisive || (row.allowed !== null && d.language === row.allowed);
}

describe("D0 adversarial review: every decisive language stamp is deserved", () => {
  for (const [category, rows] of Object.entries(CATEGORIES)) {
    describe(category, () => {
      for (const row of rows) {
        const title = `${row.allowed ?? "mixed"}: ${row.text}`;
        if (row.knownFalseDecisive) {
          it.fails(`KNOWN FALSE-DECISIVE (open D0 defect) — ${title}`, () => {
            expect(deservesItsStamp(row)).toBe(true);
          });
        } else {
          it(title, () => {
            expect(deservesItsStamp(row)).toBe(true);
          });
        }
      }
    });
  }

  it("records the size of the open defect (update deliberately)", () => {
    const all = Object.values(CATEGORIES).flat();
    expect(all).toHaveLength(42);
    // Detector 3.0.0 cleared every row of the original 29; all open ones are other Cyrillic languages
    // (Belarusian 1, Bulgarian 4), which the two-language model cannot tell apart. Not fixed here.
    const open = all.filter((r) => r.knownFalseDecisive);
    expect(open).toHaveLength(5);
    expect(
      CATEGORIES["Other Cyrillic languages"]!.filter((r) => r.knownFalseDecisive),
    ).toHaveLength(5);
    expect(
      Object.entries(CATEGORIES)
        .filter(([c]) => c !== "Other Cyrillic languages")
        .flatMap(([, rows]) => rows)
        .filter((r) => r.knownFalseDecisive),
    ).toHaveLength(0);
  });

  it("keeps the six language-switch rows non-decisive under the production variant", () => {
    for (const row of CATEGORIES["Several sentences where the language switches"]!) {
      expect(detectLanguageWithEvidence(row.text).decisive, row.text).toBe(false);
    }
  });

  it("is why variant B is the default: variant A is decisive on one switch row", () => {
    // The original 29 rows: the other-Cyrillic rows are a separate, open defect (see above).
    const rows = Object.entries(CATEGORIES)
      .filter(([c]) => c !== "Other Cyrillic languages")
      .flatMap(([, r]) => r);
    const falseDecisive = (variant: "A" | "B") =>
      rows.filter((r) => {
        const d = detectLanguageWithVariant(r.text, variant);
        return d.decisive && (r.allowed === null || d.language !== r.allowed);
      }).length;
    expect(falseDecisive("B")).toBe(0);
    expect(falseDecisive("A")).toBe(1);
  });
});
