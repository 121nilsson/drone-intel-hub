import { describe, expect, it } from "vitest";
import {
  extractClassSpecs,
  extractPrice,
  extractUnitPrice,
} from "@/shared/infra/heuristics";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";

/**
 * Characterization tests — pin current behavior before the DRY refactor.
 *
 * These lock the outputs the existing corpus does NOT cover:
 *   - inline weight/dimension regexes that join across newlines ([^\d] spans \n)
 *   - gap-width boundaries (weight 20 vs dimension 16 vs default 24)
 *   - reversed warhead pattern (number before cue, line ~242)
 *   - Geran-25 lookbehind guard (already exists; pin it)
 *   - UAV-300 anti-missile rule (already exists; pin it)
 *   - magnitude edge cases (Swedish miljarder vs bare m; UA мiльярд vs RU миллиард)
 *
 * When the DRY pass routes these through measureCue, these tests either keep passing
 * (behavior preserved) or fail and force an explicit decision about the delta.
 */

function specs(raw: string) {
  const out: Array<{ key: string; value: number | string; unit: string | undefined }> = [];
  extractClassSpecs(raw, (key, _l, value, unit) => out.push({ key, value, unit }));
  return out;
}

const t1 = new HeuristicExtractor(1);

const allSpecs = async (raw: string) => {
  const e = await t1.extract(raw, []);
  return e.specs.map((s) => ({ key: s.key, value: s.value, unit: s.unit }));
};

describe("characterization: inline weight/dimension regexes (heuristic-ai.ts extractFacts)", () => {
  it("does NOT join payload and weight across a newline (exclude-\n policy)", async () => {
    // measureCue uses [^\d\n] — newlines break the gap window. This is an intentional
    // behavior change from the old inline [^\d] which spanned newlines.
    const s = await allSpecs("payload\n20 kg");
    expect(s).not.toContainEqual({ key: "payload", value: 20, unit: "kg" });
  });

  it("does NOT join weight_mtow and value across a newline (exclude-\n policy)", async () => {
    const s = await allSpecs("максимальная взлетная масса\n250 кг");
    expect(s).not.toContainEqual({ key: "weight_mtow", value: 250, unit: "кг" });
  });

  it("respects weight gap of 20 (boundary: 20 non-digit chars between cue and number)", async () => {
    const near = "max takeoff weight" + ".".repeat(19) + " 300 kg";
    const far = "max takeoff weight" + ".".repeat(21) + " 300 kg";
    expect(await allSpecs(near)).toContainEqual({ key: "weight_mtow", value: 300, unit: "kg" });
    expect(await allSpecs(far)).not.toContainEqual({ key: "weight_mtow", value: 300, unit: "kg" });
  });

  it("respects dimension gap of 16 (boundary: 16 non-digit chars between cue and number)", async () => {
    const near = "length" + ".".repeat(15) + " 3 m";
    const far = "length" + ".".repeat(17) + " 3 m";
    expect(await allSpecs(near)).toContainEqual({ key: "length", value: 3, unit: "m" });
    expect(await allSpecs(far)).not.toContainEqual({ key: "length", value: 3, unit: "m" });
  });

  it("reads reversed warhead pattern (number before cue, line ~242)", async () => {
    // measureCue only supports cue→number order; this reversed form is bespoke.
    const s = await allSpecs("50 kg warhead");
    expect(s).toContainEqual({ key: "warhead", value: 50, unit: "kg" });
  });

  it("reads warhead with cue then number (measureCue-compatible order)", async () => {
    const s = await allSpecs("warhead 50 kg");
    expect(s).toContainEqual({ key: "warhead", value: 50, unit: "kg" });
  });
});

describe("characterization: magnitude edge cases (parseMagnitude table gaps)", () => {
  it("keeps Swedish miljarder vs bare m ambiguity (alt() longest-first)", () => {
    // alt() sorts longest-first so "miljarder" wins over bare "m".
    const p = extractUnitPrice("kostar $2 miljarder per styck");
    expect(p?.value).toBe("$2 miljarder");
  });

  it("keeps Swedish miljoner", () => {
    const p = extractUnitPrice("kostar $2 miljoner per styck");
    expect(p?.value).toBe("$2 miljoner");
  });

  it("keeps Ukrainian magnitude abbreviation млрд", () => {
    // "млрд" is in the uk lexicon magnitudes; the full word requires Cyrillic і
    // which is hard to type reliably — the abbreviation form is unambiguous.
    const ua = extractPrice("вартість $2 млрд");
    expect(ua).toBe("$2 млрд");
  });

  it("keeps Russian млрд", () => {
    const ru = extractPrice("цена $2 млрд");
    expect(ru).toMatch(/^\$2 млрд$/);
  });
});

describe("characterization: Geran-25 / UAV-300 guards (already exist; pin them)", () => {
  it("does not match Geran-2 inside Geran-25 (digit-following-hyphen lookbehind)", async () => {
    const e = await t1.extract("a Geran-25 launch", []);
    expect(e.specs.length).toBe(0);
  });

  it("does not read UAV-300 designation number as 300 missiles", async () => {
    const e = await t1.extract("AKINCI STRIKES WITH SUPERSONIC UAV-300 MISSILE!", []);
    expect(e.specs.find((s) => s.key === "missiles")).toBeUndefined();
    expect(e.payloads).toEqual([]);
  });

  it("still counts real quantities of missiles beside a designation", async () => {
    const s = await allSpecs("The UAV carries 4 missiles and 2 bombs");
    expect(s).toContainEqual({ key: "missiles", value: 4, unit: undefined });
  });
});

describe("characterization: SHORAD envelope isolation (notAfter)", () => {
  it("keeps engagement range out of vehicle range", () => {
    const s = specs("Tor-M2 has an engagement range of 16 km and detection range of 32 km.");
    expect(s).toContainEqual({ key: "engagement_range", value: 16, unit: "km" });
    expect(s).toContainEqual({ key: "detection_range", value: 32, unit: "km" });
    expect(s.some((x) => x.key === "range")).toBe(false);
  });

  it("keeps target altitude out of vehicle altitude", () => {
    const s = specs("engagement altitude of 5 km and service ceiling of 8 km.");
    expect(s).toContainEqual({ key: "target_altitude_max", value: 5, unit: "km" });
    expect(s).toContainEqual({ key: "altitude", value: 8, unit: "km" });
  });
});

describe("characterization: price in headlines is not unit cost", () => {
  it("refuses programme total even with price cue", () => {
    expect(extractUnitPrice("the $2 billion contract was signed in March")).toBeUndefined();
    expect(extractUnitPrice("a deal worth $30 million was announced")).toBeUndefined();
  });

  it("reads real price in a post that also mentions totals", () => {
    const p = extractUnitPrice(
      "India signed a $2 billion agreement with Armenia. The Akash launcher costs about $4 million apiece.",
    );
    expect(p?.value).toBe("$4 million");
    expect(p?.evidence).toContain("apiece");
  });
});

describe("characterization: reversed (number-first) forms routed through measureCue", () => {
  it("reads reversed dimension (number before cue)", async () => {
    // The old inline reversed-dimension regex (number → m → cue) kept working when the
    // dimension group moved into measureCue with order: "after".
    const s = await allSpecs("12 m length");
    expect(s).toContainEqual({ key: "length", value: 12, unit: "m" });
  });

  it("after-forms stop at sentence boundaries (restored old gap, excludes . and ;)", async () => {
    // RESTORED — old boundary parity. Allowing the after-form gap to cross "." let a value
    // from one spec's sentence be attributed to another: "12 m wide. Length otherwise
    // unknown." yielded length = 12 m (the width's value stolen through the period). The
    // after-form gap is now [^.;\d\n], matching the old inline reversed patterns. The
    // zero-gap match on "wide" itself still works, so the width is not lost.
    const s = await allSpecs("12 m wide. Length otherwise unknown.");
    expect(s).toContainEqual({ key: "width", value: 12, unit: "m" });
    expect(s).not.toContainEqual({ key: "length", value: 12, unit: "m" });
  });

  it("reads a same-sentence after-form warhead with a non-zero gap", async () => {
    const s = await allSpecs("40 kg high explosive warhead");
    expect(s).toContainEqual({ key: "warhead", value: 40, unit: "kg" });
  });

  it("after-form warhead does not cross the sentence that separates it", async () => {
    // "40 kg" describes the missile's weight, not the warhead mentioned in the next
    // sentence. Under the pre-restore gap this read as warhead = 40 kg.
    const s = await allSpecs(
      "The missile weighs 40 kg. Its thermobaric warhead is still under development.",
    );
    expect(s).not.toContainEqual({ key: "warhead", value: 40, unit: "kg" });
  });
});

describe("characterization: counted-noun side effects (relocated into extractCountedNouns)", () => {
  it("still pushes a camera sensor observation beside the count spec", async () => {
    const e = await t1.extract("fitted with 2 cameras", []);
    expect(e.sensors?.length).toBe(1);
    expect(e.sensors?.[0]).toMatchObject({ category: "camera", quantity: 2 });
    const s = e.specs.map((x) => ({ key: x.key, value: x.value }));
    expect(s).toContainEqual({ key: "cameras", value: 2 });
  });
});
