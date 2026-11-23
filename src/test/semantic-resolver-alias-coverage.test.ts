/**
 * Phase 3.2 pilot follow-up — focused regression coverage for the two aliases added after the
 * five-card fixture review, plus the negative controls that must keep failing safe.
 */

import { describe, expect, it } from "vitest";
import {
  CODE_SEED_SNAPSHOT,
  normalizeAliasKey,
  type ResolutionContextInput,
} from "../entities/normalization/semantic-resolver";

function resolve(input: ResolutionContextInput) {
  return CODE_SEED_SNAPSHOT.resolve(input);
}

describe("unit_cost → cost.unit", () => {
  it("resolves deterministically to the existing cost concept", () => {
    const r = resolve({ rawKey: "unit_cost" });
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("cost.unit");
    expect(r.aliasClass).toBe("class1_synonym");
    expect(r.matchType).toBe("literal_synonym");
    expect(r.matchedRuleId).toBe("seed-cost-unit-en-1");
  });

  it("normalises spelling variants to the same rule, including NFKC folding", () => {
    const variants = [
      "unit_cost",
      "Unit Cost",
      "unit-cost",
      "unit.cost",
      "unitCost",
      "UNIT_COST",
      "ｕｎｉｔ＿ｃｏｓｔ",
    ];
    const first = resolve({ rawKey: "unit_cost" });
    for (const rawKey of variants) {
      expect(normalizeAliasKey(rawKey), rawKey).toBe("unit_cost");
      const r = resolve({ rawKey });
      expect(r.status, rawKey).toBe(first.status);
      expect(r.canonicalId, rawKey).toBe("cost.unit");
      expect(r.matchedRuleId, rawKey).toBe(first.matchedRuleId);
    }
  });

  it("does not broaden into total programme or project cost", () => {
    for (const rawKey of [
      "total_cost",
      "programme_cost",
      "program_project_cost",
      "project_cost",
      "cost_total",
      "cost",
      "unit_cost_of_nothing",
    ]) {
      const r = resolve({ rawKey });
      expect(r.status, rawKey).not.toBe("resolved");
      expect(r.canonicalId, rawKey).toBeUndefined();
    }
  });
});

describe("боевая_часть → payload.warhead", () => {
  it("resolves the reviewed Russian term to the warhead concept", () => {
    const r = resolve({ rawKey: "боевая_часть", language: "ru", rawUnit: "кг" });
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("payload.warhead");
    expect(r.aliasClass).toBe("class3_qualified");
    expect(r.matchedRuleId).toBe("seed-payload-warhead-ru-1");
  });

  it("normalises Cyrillic and delimiter variants deterministically", () => {
    const variants = [
      "боевая_часть",
      "Боевая Часть",
      "БОЕВАЯ-ЧАСТЬ",
      "боевая.часть",
      "боевая  часть",
      "боевая_часть_kg",
    ];
    for (const rawKey of variants) {
      expect(normalizeAliasKey(rawKey), rawKey).toBe("боевая_часть");
      const r = resolve({ rawKey, language: "ru" });
      expect(r.status, rawKey).toBe("resolved");
      expect(r.canonicalId, rawKey).toBe("payload.warhead");
    }
  });

  it("honours language scoping: no language or another language never licenses the guess", () => {
    for (const language of [undefined, "en", "uk", "sv", "de"]) {
      const r = resolve({
        rawKey: "боевая_часть",
        ...(language !== undefined ? { language } : {}),
      });
      expect(r.status, String(language)).toBe("unresolved_unknown");
      expect(r.canonicalId, String(language)).toBeUndefined();
    }
    expect(resolve({ rawKey: "боевая_часть", language: " RU " }).canonicalId).toBe(
      "payload.warhead",
    );
  });

  it("does not collapse into generic payload mass/capacity or broad Russian terminology", () => {
    const warhead = resolve({ rawKey: "боевая_часть", language: "ru" });
    expect(warhead.canonicalId).not.toBe("payload.mass");
    expect(warhead.canonicalId).not.toBe("payload.capacity");
    for (const rawKey of ["масса", "нагрузка", "боевые_части", "корисне_навантаження", "часть"]) {
      const r = resolve({ rawKey, language: "ru" });
      expect(r.status, rawKey).not.toBe("resolved");
      expect(r.canonicalId, rawKey).toBeUndefined();
    }
  });
});

describe("existing aliases still resolve after the coverage change", () => {
  it("keeps the previously reviewed English aliases", () => {
    const known: ReadonlyArray<[string, string]> = [
      ["load_factor", "maneuver.load_factor_max"],
      ["engine_power", "power.engine"],
      ["max_g", "maneuver.load_factor_max"],
      ["top_speed", "speed.max"],
      ["cruising_speed", "speed.cruise"],
      ["warhead_weight", "payload.warhead"],
      ["payload_capacity", "payload.capacity"],
      ["service_ceiling", "altitude.service_ceiling"],
      ["combat_radius", "range.combat_radius"],
    ];
    for (const [rawKey, canonicalId] of known) {
      const r = resolve({ rawKey });
      expect(r.status, rawKey).toBe("resolved");
      expect(r.canonicalId, rawKey).toBe(canonicalId);
    }
  });

  it("keeps the context and ambiguity guards intact", () => {
    expect(resolve({ rawKey: "beam", domain: "Sea" }).canonicalId).toBe("dimension.width");
    expect(resolve({ rawKey: "beam", domain: "Air" }).status).toBe("unresolved_context");
    expect(resolve({ rawKey: "radius" }).status).toBe("unresolved_ambiguous");
    expect(resolve({ rawKey: "power" }).status).toBe("unresolved_ambiguous");
  });
});

describe("negative controls stay withheld", () => {
  it("zorblax_rating and similar arbitrary terms remain unrecognised", () => {
    for (const rawKey of [
      "zorblax_rating",
      "zorblax",
      "quantum_deflector_rating",
      "hypothetical_laser_emitter",
    ]) {
      const r = resolve({ rawKey });
      expect(r.status, rawKey).toBe("unresolved_unknown");
      expect(r.canonicalId, rawKey).toBeUndefined();
    }
  });

  it("adding the aliases does not echo an unknown key back as a canonical id", () => {
    for (const rawKey of ["unit_cost_rating", "боевая_часть_рейтинг"]) {
      const r = resolve({ rawKey });
      expect(r.canonicalId, rawKey).toBeUndefined();
      expect(r.rawKey, rawKey).toBe(rawKey);
    }
  });
});
