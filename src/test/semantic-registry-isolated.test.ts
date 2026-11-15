/**
 * Phase 3.1 — Isolated Semantic Registry Test Suite
 *
 * Tests the pure, database-free resolver against all invariants specified in
 * docs/phase-3-hybrid-semantic-registry.md § 17.
 *
 * Key invariants this suite enforces:
 *   1. Manifest integrity (closed allowlist, no prefix matching).
 *   2. Adversarial non-conflation (speed.max ≠ speed.cruise, etc.).
 *   3. Gate 2 guard evaluation (beam/domain, effective_range/systemClass).
 *   4. Gate 5 hard stop — NO call to semanticKeyFor() on unknown input.
 *   5. Determinism across 10 000 iterations.
 *   6. Offline invariance (resolver works with DATABASE_URL unset).
 *   7. Snapshot immutability (returned objects cannot mutate internal state).
 *   8. Withholding on negative cases (bare radius/power/capacity).
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../entities/normalization/sha256";
import {
  isValidCanonicalId,
  CANONICAL_CONCEPTS,
} from "../entities/normalization/canonical-manifest";
import {
  CODE_SEED_SNAPSHOT,
  normalizeAttributeKey,
  compileSemanticSnapshot,
  type SemanticAliasDefinition,
} from "../entities/normalization/semantic-resolver";
import type { SemanticResolutionResult } from "../entities/normalization/semantic-result";

// ─── Helpers ───────────────────────────────────────────────────────────────

function resolve(
  rawKey: string,
  opts: {
    rawLabel?: string;
    rawUnit?: string | undefined;
    systemClass?: string;
    domain?: string;
    subsystem?: string;
  } = {},
): SemanticResolutionResult {
  return CODE_SEED_SNAPSHOT.resolve({ rawKey, ...opts });
}

// ─── 1. Manifest Integrity ─────────────────────────────────────────────────

describe("Manifest integrity", () => {
  it("accepts all entries in CANONICAL_CONCEPTS", () => {
    for (const concept of CANONICAL_CONCEPTS) {
      expect(isValidCanonicalId(concept.id), `${concept.id} should be valid`).toBe(true);
    }
  });

  it("rejects a fake entry that starts with a valid family prefix", () => {
    expect(isValidCanonicalId("range.fake_entry")).toBe(false);
  });

  it("rejects a bare family prefix (no leaf)", () => {
    expect(isValidCanonicalId("speed.")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidCanonicalId("")).toBe(false);
  });

  it("accepts speed.max", () => {
    expect(isValidCanonicalId("speed.max")).toBe(true);
  });

  it("accepts altitude.service_ceiling", () => {
    expect(isValidCanonicalId("altitude.service_ceiling")).toBe(true);
  });

  it("accepts range.combat_radius", () => {
    expect(isValidCanonicalId("range.combat_radius")).toBe(true);
  });

  it("rejects raw key that looks like a canonical id but is not registered", () => {
    expect(isValidCanonicalId("speed.hypothetical")).toBe(false);
  });
});

// ─── 2. Adversarial Non-Conflation Tests ──────────────────────────────────

describe("Adversarial non-conflation", () => {
  it("top_speed → speed.max", () => {
    const r = resolve("top_speed");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("speed.max");
  });

  it("cruising_speed → speed.cruise (NOT speed.max)", () => {
    const r = resolve("cruising_speed");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("speed.cruise");
    expect(r.canonicalId).not.toBe("speed.max");
  });

  it("top_speed and cruising_speed resolve to DIFFERENT concepts", () => {
    const r1 = resolve("top_speed");
    const r2 = resolve("cruising_speed");
    expect(r1.canonicalId).not.toEqual(r2.canonicalId);
  });

  it("warhead_weight → payload.warhead (NOT payload.capacity)", () => {
    const r = resolve("warhead_weight");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("payload.warhead");
    expect(r.canonicalId).not.toBe("payload.capacity");
  });

  it("payload_capacity → payload.capacity (NOT payload.warhead)", () => {
    const r = resolve("payload_capacity");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("payload.capacity");
    expect(r.canonicalId).not.toBe("payload.warhead");
  });

  it("warhead_weight and payload_capacity resolve to DIFFERENT concepts", () => {
    const r1 = resolve("warhead_weight");
    const r2 = resolve("payload_capacity");
    expect(r1.canonicalId).not.toEqual(r2.canonicalId);
  });

  it("service_ceiling → altitude.service_ceiling (NOT altitude.max)", () => {
    const r = resolve("service_ceiling");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("altitude.service_ceiling");
    expect(r.canonicalId).not.toBe("altitude.max");
  });

  it("max_altitude → altitude.max (NOT altitude.service_ceiling)", () => {
    const r = resolve("max_altitude");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("altitude.max");
    expect(r.canonicalId).not.toBe("altitude.service_ceiling");
  });

  it("service_ceiling and max_altitude resolve to DIFFERENT concepts", () => {
    const r1 = resolve("service_ceiling");
    const r2 = resolve("max_altitude");
    expect(r1.canonicalId).not.toEqual(r2.canonicalId);
  });

  it("combat_radius → range.combat_radius (NOT range.max)", () => {
    const r = resolve("combat_radius");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("range.combat_radius");
    expect(r.canonicalId).not.toBe("range.max");
  });

  it("max_range → range.max (NOT range.combat_radius)", () => {
    const r = resolve("max_range");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("range.max");
    expect(r.canonicalId).not.toBe("range.combat_radius");
  });

  it("jamming_power → power.rf", () => {
    const r = resolve("jamming_power");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("power.rf");
  });

  it("engine_power → power.engine", () => {
    const r = resolve("engine_power");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("power.engine");
  });

  it("jamming_power and engine_power resolve to DIFFERENT concepts", () => {
    const r1 = resolve("jamming_power");
    const r2 = resolve("engine_power");
    expect(r1.canonicalId).not.toEqual(r2.canonicalId);
  });
});

// ─── 3. Gate 0: Exact manifest identity ───────────────────────────────────

describe("Gate 0: Exact canonical manifest identity", () => {
  it("resolves speed.max via Gate 0 when rawKey is exactly a canonical id", () => {
    const r = resolve("speed.max");
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("speed.max");
    expect(r.matchType).toBe("canonical_identity");
  });

  it("resolves altitude.service_ceiling via Gate 0", () => {
    const r = resolve("altitude.service_ceiling");
    expect(r.status).toBe("resolved");
    expect(r.matchType).toBe("canonical_identity");
  });
});

// ─── 4. Gate 2: Context Guard Evaluation ──────────────────────────────────

describe("Gate 2: Context guard evaluation", () => {
  it("beam with domain:Sea → dimension.width (guard satisfied)", () => {
    const r = resolve("beam", { domain: "Sea" });
    expect(r.status).toBe("resolved");
    expect(r.canonicalId).toBe("dimension.width");
    expect(r.aliasClass).toBe("class2_context");
    expect(r.matchType).toBe("context_guard");
    expect(r.guardAudit).toBeDefined();
    expect(r.guardAudit?.some((g) => g.guardName === "domains" && g.satisfied)).toBe(true);
  });

  it("beam with domain:Air → unresolved_context (guard failed — not a naval vessel)", () => {
    const r = resolve("beam", { domain: "Air" });
    expect(r.status).toBe("unresolved_context");
    expect(r.canonicalId).toBeUndefined();
    expect(r.guardAudit).toBeDefined();
    expect(r.guardAudit?.some((g) => !g.satisfied)).toBe(true);
  });

  it("beam with no domain → unresolved_context (guard failed — domain missing)", () => {
    const r = resolve("beam");
    expect(r.status).toBe("unresolved_context");
    expect(r.canonicalId).toBeUndefined();
  });

  it("guardAudit records the actual value that was provided", () => {
    const r = resolve("beam", { domain: "Air" });
    const domainGuard = r.guardAudit?.find((g) => g.guardName === "domains");
    expect(domainGuard?.actual).toBe("Air");
    expect(domainGuard?.satisfied).toBe(false);
  });

  it("guardAudit records undefined when context is missing", () => {
    const r = resolve("beam");
    const domainGuard = r.guardAudit?.find((g) => g.guardName === "domains");
    expect(domainGuard?.actual).toBeUndefined();
  });
});

// ─── 5. Gate 5: Hard stop — no legacy fallback ────────────────────────────

describe("Gate 5: Hard stop — no legacy fallback", () => {
  it("completely unknown term → status:unresolved_unknown, canonicalId:undefined", () => {
    const r = resolve("hypothetical_laser_emitter");
    expect(r.status).toBe("unresolved_unknown");
    expect(r.canonicalId).toBeUndefined();
  });

  it("unknown term does NOT return the raw key as canonicalId", () => {
    const r = resolve("some_exotic_attribute_xyz");
    expect(r.canonicalId).not.toBe("some_exotic_attribute_xyz");
    expect(r.canonicalId).toBeUndefined();
  });

  it("semanticKeyFor is never called — spy verifies zero invocations", async () => {
    // Dynamically import semantic.ts to spy on it.
    // The resolver must NEVER call semanticKeyFor as a fallback.
    const semanticModule = await import("../entities/normalization/semantic");
    const spy = vi.spyOn(semanticModule, "semanticKeyFor");

    // Run several resolutions including an unknown term.
    resolve("hypothetical_laser_emitter");
    resolve("some_other_unknown_attribute");
    resolve("max_range"); // known term

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rawKey is preserved unconditionally even when unresolved", () => {
    const r = resolve("hypothetical_laser_emitter");
    expect(r.rawKey).toBe("hypothetical_laser_emitter");
  });

  it("diagnostics explain why the term is unresolved", () => {
    const r = resolve("hypothetical_laser_emitter");
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics[0]).toMatch(/not indexed/i);
  });
});

// ─── 6. Determinism ───────────────────────────────────────────────────────

describe("Determinism", () => {
  it("produces bitwise-identical results across 10 000 identical inputs", () => {
    const first = resolve("top_speed", { domain: "Air", rawUnit: "km/h" });
    for (let i = 0; i < 10_000; i++) {
      const r = resolve("top_speed", { domain: "Air", rawUnit: "km/h" });
      expect(r.status).toBe(first.status);
      expect(r.canonicalId).toBe(first.canonicalId);
      expect(r.snapshotHash).toBe(first.snapshotHash);
      expect(r.snapshotVersion).toBe(first.snapshotVersion);
    }
  });

  it("produces bitwise-identical results for unresolved inputs", () => {
    const first = resolve("unknown_term_xyz");
    for (let i = 0; i < 1_000; i++) {
      const r = resolve("unknown_term_xyz");
      expect(r.status).toBe(first.status);
      expect(r.canonicalId).toBe(first.canonicalId);
    }
  });
});

// ─── 7. Offline invariance ─────────────────────────────────────────────────

describe("Offline invariance", () => {
  it("resolves without DATABASE_URL set", () => {
    // CODE_SEED_SNAPSHOT is compiled at module load time — no DB needed.
    const savedUrl = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];

    try {
      const r = resolve("max_range");
      expect(r.status).toBe("resolved");
      expect(r.canonicalId).toBe("range.max");
    } finally {
      if (savedUrl !== undefined) process.env["DATABASE_URL"] = savedUrl;
    }
  });

  it("CODE_SEED_SNAPSHOT is flagged isDegradedSeedOnly", () => {
    expect(CODE_SEED_SNAPSHOT.isDegradedSeedOnly).toBe(true);
  });
});

// ─── 8. Snapshot immutability ──────────────────────────────────────────────

describe("Snapshot immutability", () => {
  it("returned result object is frozen", () => {
    const r = resolve("top_speed");
    expect(Object.isFrozen(r)).toBe(true);
  });

  it("mutating properties on a returned result does not affect subsequent calls", () => {
    const r1 = resolve("top_speed") as unknown as Record<string, unknown>;
    // Attempt mutation — should throw in strict mode / be silently ignored
    try {
      r1["canonicalId"] = "speed.mutated_evil";
    } catch {
      // Expected in strict mode
    }
    const r2 = resolve("top_speed");
    expect(r2.canonicalId).toBe("speed.max");
  });

  it("diagnostics array on result is frozen", () => {
    const r = resolve("hypothetical_laser_emitter");
    expect(Object.isFrozen(r.diagnostics)).toBe(true);
  });

  it("snapshot object itself is frozen (internal state cannot be replaced)", () => {
    expect(Object.isFrozen(CODE_SEED_SNAPSHOT)).toBe(true);
  });

  it("compiling a new snapshot from the same rules produces an independent resolver", () => {
    // Prove that two compiled snapshots are independent — mutating one does not affect the other.
    const rules: SemanticAliasDefinition[] = [
      {
        ruleId: "test-rule-1",
        canonicalId: "speed.max",
        aliasClass: "class1_synonym",
        language: "all",
        rawKey: "top_speed",
        rationale: "test",
        author: "test",
      },
    ];
    const snap1 = compileSemanticSnapshot(rules, {
      snapshotId: "snap-a",
      version: 1,
    });
    const snap2 = compileSemanticSnapshot(rules, {
      snapshotId: "snap-b",
      version: 2,
    });

    expect(snap1.resolve({ rawKey: "top_speed" }).snapshotVersion).toBe(1);
    expect(snap2.resolve({ rawKey: "top_speed" }).snapshotVersion).toBe(2);
    // Same rules + same code => same content hash, whatever id/version they get.
    expect(snap1.contentHash).toBe(snap2.contentHash);
  });

  it("throws snapshot compilation error if a Class 1 rule has an invalid canonicalId", () => {
    const invalidRules = [
      {
        ruleId: "bad-rule-1",
        canonicalId: "speed.invalid_concept_not_in_manifest",
        aliasClass: "class1_synonym" as const,
        language: "en" as const,
        rawKey: "some_key",
        rationale: "test",
        author: "test",
      },
    ];
    expect(() => compileSemanticSnapshot(invalidRules)).toThrow(
      /Snapshot compilation error: Rule 'bad-rule-1' specifies invalid canonicalId/,
    );
  });

  it("throws snapshot compilation error if a Class 4 rule has an invalid candidate target", () => {
    const invalidClass4 = [
      {
        ruleId: "bad-class4-1",
        aliasClass: "class4_ambiguous" as const,
        language: "en" as const,
        rawKey: "ambig_term",
        candidateCanonicalIds: ["speed.max", "range.non_existent_target"],
        rationale: "test",
        author: "test",
      },
    ];
    expect(() => compileSemanticSnapshot(invalidClass4)).toThrow(
      /Snapshot compilation error: Class 4 rule 'bad-class4-1' specifies invalid canonical candidate 'range.non_existent_target'/,
    );
  });
});

// ─── 9. Withholding on negative and ambiguous cases ───────────────────────

describe("Withholding on negative/ambiguous cases", () => {
  // These are the core "negative" test cases — terms that MUST NOT auto-resolve.

  it("bare 'radius' → unresolved_ambiguous (Class 4)", () => {
    const r = resolve("radius");
    expect(r.status).toBe("unresolved_ambiguous");
    expect(r.canonicalId).toBeUndefined();
    expect(r.aliasClass).toBe("class4_ambiguous");
  });

  it("bare 'power' → unresolved_ambiguous (Class 4)", () => {
    const r = resolve("power");
    expect(r.status).toBe("unresolved_ambiguous");
    expect(r.canonicalId).toBeUndefined();
  });

  it("bare 'capacity' → unresolved_ambiguous (Class 4)", () => {
    const r = resolve("capacity");
    expect(r.status).toBe("unresolved_ambiguous");
    expect(r.canonicalId).toBeUndefined();
  });

  it("'beam' without domain context → unresolved (not silently mapped to dimension.width)", () => {
    const r = resolve("beam");
    // Must not silently resolve to dimension.width — that's only valid for Sea domain.
    expect(r.canonicalId).not.toBe("dimension.width");
    expect(r.status).not.toBe("resolved");
  });

  it("completely novel term → unresolved_unknown (never resolved)", () => {
    const r = resolve("hypothetical_quantum_deflector");
    expect(r.status).toBe("unresolved_unknown");
    expect(r.canonicalId).toBeUndefined();
  });

  // Withholding recall and precision over the inline negative test set.
  it("regression: every inline negative/ambiguous case is withheld (not the Tier 2 benchmark)", () => {
    const negativeInputs = [
      { rawKey: "radius" },
      { rawKey: "power" },
      { rawKey: "capacity" },
      { rawKey: "beam" }, // no domain — should withhold
      { rawKey: "hypothetical_laser_emitter" },
      { rawKey: "some_unknown_drone_attribute" },
    ];

    const unresolved = negativeInputs.filter((inp) => {
      const r = CODE_SEED_SNAPSHOT.resolve(inp);
      return r.status !== "resolved";
    });

    const withholdingRecall = unresolved.length / negativeInputs.length;
    // Six hand-picked cases are a regression guard, not evidence of corpus-level recall.
    // The >=98% / >=99% thresholds are measured in Phase 3.2 on the reference corpus.
    expect(withholdingRecall).toBe(1);
  });

  it("regression: every inline valid synonym resolves to its expected concept (not the Tier 2 benchmark)", () => {
    // This test verifies that the resolver resolves known valid synonyms correctly.
    const validPositiveInputs = [
      { rawKey: "top_speed", expectedId: "speed.max" },
      { rawKey: "max_range", expectedId: "range.max" },
      { rawKey: "wingspan", expectedId: "dimension.wingspan" },
      { rawKey: "mtow", expectedId: "weight.mtow" },
      { rawKey: "jamming_power", expectedId: "power.rf" },
      { rawKey: "engine_power", expectedId: "power.engine" },
      { rawKey: "beam", domain: "Sea", expectedId: "dimension.width" },
      { rawKey: "service_ceiling", expectedId: "altitude.service_ceiling" },
      { rawKey: "cruising_speed", expectedId: "speed.cruise" },
      { rawKey: "combat_radius", expectedId: "range.combat_radius" },
    ];

    // Count correctly resolved
    const correctlyResolved = validPositiveInputs.filter(({ rawKey, expectedId, ...opts }) => {
      const r = CODE_SEED_SNAPSHOT.resolve({ rawKey, ...opts });
      return r.status === "resolved" && r.canonicalId === expectedId;
    });

    const resolutionPrecision = correctlyResolved.length / validPositiveInputs.length;
    expect(resolutionPrecision).toBe(1);
  });
});

// ─── 10. Key normalisation ─────────────────────────────────────────────────

describe("normalizeAttributeKey", () => {
  it("lowercases input", () => {
    expect(normalizeAttributeKey("MaxSpeed")).toContain("max_speed");
  });

  it("converts camelCase to snake_case", () => {
    expect(normalizeAttributeKey("maxSpeed")).toBe("max_speed");
  });

  it("converts hyphens to underscores", () => {
    expect(normalizeAttributeKey("max-speed")).toBe("max_speed");
  });

  it("strips trailing unit artifact _km", () => {
    expect(normalizeAttributeKey("range_km")).toBe("range");
  });

  it("does NOT strip _min: range_min stays distinct from range", () => {
    expect(normalizeAttributeKey("range_min")).toBe("range_min");
    expect(normalizeAttributeKey("altitude_min")).toBe("altitude_min");
  });

  it("treats punctuation as a delimiter, never deleting it", () => {
    for (const v of [
      "max speed",
      "max-speed",
      "max.speed",
      "max/speed",
      "max__speed",
      "Max  Speed",
    ]) {
      expect(normalizeAttributeKey(v), v).toBe("max_speed");
    }
    expect(normalizeAttributeKey("air craft")).toBe("air_craft");
    expect(normalizeAttributeKey("air-craft")).toBe("air_craft");
    expect(normalizeAttributeKey("aircraft")).toBe("aircraft");
  });

  it("applies NFKC (full-width forms fold)", () => {
    expect(normalizeAttributeKey("\uff2d\uff41\uff58\uff3f\uff33\uff50\uff45\uff45\uff44")).toBe(
      "max_speed",
    );
  });

  it("strips trailing unit artifact _kg", () => {
    expect(normalizeAttributeKey("weight_kg")).toBe("weight");
  });

  it("preserves Cyrillic characters", () => {
    const result = normalizeAttributeKey("максимальная_скорость");
    expect(result).toContain("максимальная");
  });

  it("preserves Swedish characters å, ä, ö", () => {
    expect(normalizeAttributeKey("vingbredd_m")).toBe("vingbredd");
    expect(normalizeAttributeKey("högsta_fart")).toBe("högsta_fart");
    expect(normalizeAttributeKey("bärkraft_kg")).toBe("bärkraft");
  });

  it("preserves Ukrainian characters і, ї, є", () => {
    expect(normalizeAttributeKey("крейсерська_швидкість")).toBe("крейсерська_швидкість");
    expect(normalizeAttributeKey("корисне_навантаження")).toBe("корисне_навантаження");
  });

  it("preserves Persian and Arabic script", () => {
    const persian = normalizeAttributeKey("سرعت_بیشینه");
    expect(persian).toBe("سرعت_بیشینه");
  });

  it("preserves Chinese characters", () => {
    const chinese = normalizeAttributeKey("最大飞行速度");
    expect(chinese).toBe("最大飞行速度");
  });

  it("is idempotent — normalising twice gives the same result", () => {
    const once = normalizeAttributeKey("MaxSpeed_km");
    const twice = normalizeAttributeKey(once);
    expect(once).toBe(twice);
  });
});

// ─── 11. snapshotHash and snapshotVersion on results ─────────────────────

describe("Snapshot metadata on results", () => {
  it("every result carries a non-empty snapshotHash", () => {
    const r = resolve("max_range");
    expect(typeof r.snapshotHash).toBe("string");
    expect(r.snapshotHash.length).toBeGreaterThan(0);
  });

  it("every result carries snapshotVersion matching the snapshot", () => {
    const r = resolve("max_range");
    expect(r.snapshotVersion).toBe(CODE_SEED_SNAPSHOT.version);
  });
});

// ─── 12. Compiler validation ──────────────────────────────────────────────

function rule(over: Record<string, unknown>): SemanticAliasDefinition {
  return {
    ruleId: "r",
    canonicalId: "speed.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "k",
    rationale: "t",
    author: "t",
    ...over,
  } as SemanticAliasDefinition;
}

describe("Snapshot compiler validation", () => {
  it("normalises rule keys at compile time (Top-Speed matches top_speed)", () => {
    const s = compileSemanticSnapshot([rule({ rawKey: "Top-Speed" })]);
    expect(s.resolve({ rawKey: "top_speed" }).canonicalId).toBe("speed.max");
  });

  it("rejects two rules colliding on the same normalized key", () => {
    expect(() =>
      compileSemanticSnapshot([
        rule({ ruleId: "a", rawKey: "x-y" }),
        rule({ ruleId: "b", rawKey: "x_y", canonicalId: "speed.cruise" }),
      ]),
    ).toThrow(/collides/);
  });

  it("rejects a Class 4 key that is also a direct synonym", () => {
    expect(() =>
      compileSemanticSnapshot([
        rule({ ruleId: "a", rawKey: "power" }),
        rule({
          ruleId: "b",
          rawKey: "Power",
          aliasClass: "class4_ambiguous",
          canonicalId: undefined,
          candidateCanonicalIds: ["power.rf"],
        }),
      ]),
    ).toThrow(/collides/);
  });

  it("rejects duplicate ruleIds", () => {
    expect(() => compileSemanticSnapshot([rule({ rawKey: "a" }), rule({ rawKey: "b" })])).toThrow(
      /duplicate ruleId/,
    );
  });

  it("rejects a Class 2 rule with no effective guard", () => {
    expect(() =>
      compileSemanticSnapshot([rule({ aliasClass: "class2_context", contextGuards: {} })]),
    ).toThrow(/no effective context guard/);
    expect(() =>
      compileSemanticSnapshot([
        rule({ aliasClass: "class2_context", contextGuards: { domains: [] } }),
      ]),
    ).toThrow(/no effective context guard/);
  });

  it("rejects context guards on Class 1 and Class 3 rules", () => {
    expect(() => compileSemanticSnapshot([rule({ contextGuards: { domains: ["Sea"] } })])).toThrow(
      /must not carry context guards/,
    );
  });

  it("rejects a Class 4 rule with no candidates", () => {
    expect(() =>
      compileSemanticSnapshot([
        rule({ aliasClass: "class4_ambiguous", canonicalId: undefined, candidateCanonicalIds: [] }),
      ]),
    ).toThrow(/no candidates/);
  });

  it("rejects regex-like label tokens", () => {
    expect(() => compileSemanticSnapshot([rule({ labelTokens: ["max.*"] })])).toThrow(/regex-like/);
  });
});

// ─── 13. Label tokens are whole-word ──────────────────────────────────────

describe("Label token matching", () => {
  const snap = compileSemanticSnapshot([rule({ rawKey: "range", labelTokens: ["max"] })]);

  it("matches a whole word in the label", () => {
    const r = snap.resolve({ rawKey: "range", rawLabel: "Max. range (km)" });
    expect(r.status).toBe("resolved");
    expect(r.matchType).toBe("token_bounded");
  });

  it("does not match a substring of another word", () => {
    expect(snap.resolve({ rawKey: "range", rawLabel: "Maximal range" }).status).not.toBe(
      "resolved",
    );
    expect(snap.resolve({ rawKey: "range", rawLabel: "Maxwell" }).status).not.toBe("resolved");
  });

  it("does not match when the label is missing", () => {
    expect(snap.resolve({ rawKey: "range" }).status).toBe("unresolved_unknown");
  });
});

// ─── 14. Deep immutability and encapsulation ──────────────────────────────

describe("Deep immutability", () => {
  it("snapshot exposes only its public surface (no lookup maps)", () => {
    expect(Object.keys(CODE_SEED_SNAPSHOT).sort()).toEqual(
      [
        "activatedAt",
        "contentHash",
        "isDegradedSeedOnly",
        "manifestVersion",
        "resolve",
        "snapshotId",
        "version",
      ].sort(),
    );
    expect(() => {
      (CODE_SEED_SNAPSHOT as unknown as Record<string, unknown>)["resolve"] = () => null;
    }).toThrow();
  });

  it("mutating the caller's rules after compilation does not change resolution", () => {
    const guards = { domains: ["Sea"] };
    const cands = ["power.rf", "power.engine"];
    const rules = [
      rule({
        ruleId: "a",
        rawKey: "beam",
        aliasClass: "class2_context",
        canonicalId: "dimension.width",
        contextGuards: guards,
      }),
      rule({
        ruleId: "b",
        rawKey: "power",
        aliasClass: "class4_ambiguous",
        canonicalId: undefined,
        candidateCanonicalIds: cands,
      }),
    ];
    const snap = compileSemanticSnapshot(rules);
    guards.domains.push("Air");
    cands.push("speed.max");
    (rules[0] as { canonicalId: string }).canonicalId = "speed.max";
    expect(snap.resolve({ rawKey: "beam", domain: "Air" }).status).toBe("unresolved_context");
    expect(snap.resolve({ rawKey: "beam", domain: "Sea" }).canonicalId).toBe("dimension.width");
    expect(snap.resolve({ rawKey: "power" }).candidateCanonicalIds).toEqual([
      "power.rf",
      "power.engine",
    ]);
  });

  it("guardAudit and its entries are deeply frozen and not shared between calls", () => {
    const a = resolve("beam", { domain: "Sea" });
    const b = resolve("beam", { domain: "Sea" });
    expect(Object.isFrozen(a.guardAudit)).toBe(true);
    const g = a.guardAudit![0]!;
    expect(Object.isFrozen(g)).toBe(true);
    expect(Object.isFrozen(g.expected)).toBe(true);
    expect(g.expected).not.toBe(b.guardAudit![0]!.expected);
    expect(() => {
      (g.expected as string[]).push("Air");
    }).toThrow();
  });

  it("class 4 candidates are exposed frozen", () => {
    const r = resolve("power");
    expect(r.candidateCanonicalIds).toEqual(["power.rf", "power.engine"]);
    expect(Object.isFrozen(r.candidateCanonicalIds)).toBe(true);
  });

  it("a newer snapshot does not affect an older one", () => {
    const old = compileSemanticSnapshot([rule({ rawKey: "k" })], { version: 1 });
    compileSemanticSnapshot([rule({ rawKey: "k", canonicalId: "speed.cruise" })], { version: 2 });
    expect(old.resolve({ rawKey: "k" }).canonicalId).toBe("speed.max");
  });

  it("repeated runs are deeply equal, not just field-equal", () => {
    const first = resolve("beam", { domain: "Sea", rawLabel: "Beam" });
    for (let i = 0; i < 200; i++) {
      expect(resolve("beam", { domain: "Sea", rawLabel: "Beam" })).toEqual(first);
    }
  });
});

// ─── 15. Content hash covers everything that matters ──────────────────────

describe("Snapshot content hash", () => {
  const base = () => [rule({ ruleId: "a", rawKey: "k1" }), rule({ ruleId: "b", rawKey: "k2" })];
  const hash = (r: SemanticAliasDefinition[]) => compileSemanticSnapshot(r).contentHash;

  it("sha256Hex matches node:crypto", () => {
    for (const t of [
      "",
      "abc",
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(64),
      "å中🙂".repeat(40),
    ]) {
      expect(sha256Hex(t)).toBe(createHash("sha256").update(t, "utf8").digest("hex"));
    }
  });

  it("is a 64-char hex digest, stable, and independent of rule order", () => {
    const h = hash(base());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hash(base())).toBe(h);
    expect(hash(base().reverse())).toBe(h);
  });

  it("changes when any rule field changes", () => {
    const h = hash(base());
    const variants: Array<Record<string, unknown>> = [
      { rawKey: "k9" },
      { canonicalId: "speed.cruise" },
      { aliasClass: "class3_qualified" },
      { rationale: "other" },
      { author: "other" },
      { language: "sv" },
      { labelTokens: ["max"] },
    ];
    for (const v of variants) {
      const r = base();
      r[0] = rule({ ruleId: "a", rawKey: "k1", ...v });
      expect(hash(r), JSON.stringify(v)).not.toBe(h);
    }
    expect(hash(base().slice(0, 1))).not.toBe(h);
  });

  it("changes when a guard or Class 4 candidate changes", () => {
    const g = (d: string[]) => [
      rule({
        aliasClass: "class2_context",
        rawKey: "beam",
        canonicalId: "dimension.width",
        contextGuards: { domains: d },
      }),
    ];
    expect(hash(g(["Sea"]))).not.toBe(hash(g(["Sea", "Air"])));
    const c = (ids: string[]) => [
      rule({
        aliasClass: "class4_ambiguous",
        canonicalId: undefined,
        rawKey: "power",
        candidateCanonicalIds: ids,
      }),
    ];
    expect(hash(c(["power.rf"]))).not.toBe(hash(c(["power.rf", "power.engine"])));
  });

  it("the code seed hash is computed, not a hand-written constant", () => {
    expect(CODE_SEED_SNAPSHOT.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── 16. Isolation: no legacy path, no production integration ─────────────

const NORM_DIR = join(__dirname, "..", "entities", "normalization");
const ISOLATED = [
  "canonical-manifest.ts",
  "semantic-resolver.ts",
  "semantic-result.ts",
  "sha256.ts",
];

function importsOf(src: string): string[] {
  return [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("Isolation from legacy and production code", () => {
  it("the whole transitive import graph is free of semantic.ts, DB/server code, env and packages", () => {
    const SRC = join(__dirname, "..");
    const resolveSpec = (from: string, spec: string): string | undefined => {
      const rel = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : join(from, "..", spec);
      for (const c of [`${rel}.ts`, join(rel, "index.ts")]) {
        try {
          if (statSync(c).isFile()) return c;
        } catch {
          /* try next */
        }
      }
      return undefined;
    };
    const seen = new Set<string>();
    const queue = ISOLATED.map((f) => join(NORM_DIR, f));
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/semanticKeyFor|process\.env|\.server/);
      for (const spec of importsOf(src)) {
        expect(spec.startsWith("./") || spec.startsWith("@/"), `${file} imports '${spec}'`).toBe(
          true,
        );
        const target = resolveSpec(file, spec);
        expect(target, `${file} -> '${spec}' unresolved`).toBeDefined();
        expect(target, `${file} reaches the legacy normalizer`).not.toMatch(
          /normalization[\\/](semantic|apply|core-registry)\.ts$/,
        );
        queue.push(target!);
      }
    }
    // Sanity: the walk really followed the chain through units.ts.
    expect([...seen].some((f) => /units\.ts$/.test(f))).toBe(true);
  });

  it("no production module imports the isolated resolver yet", () => {
    const SRC = join(__dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "test") walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || ISOLATED.includes(name)) continue;
        const src = readFileSync(full, "utf8");
        if (
          importsOf(src).some((s) =>
            /semantic-resolver|canonical-manifest|semantic-result|\/sha256$/.test(s),
          )
        ) {
          offenders.push(full);
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

// ─── 17. Manifest is genuinely immutable ──────────────────────────────────

describe("Manifest immutability", () => {
  it("every concept object is frozen, not only the array", () => {
    expect(Object.isFrozen(CANONICAL_CONCEPTS)).toBe(true);
    for (const c of CANONICAL_CONCEPTS) expect(Object.isFrozen(c), c.id).toBe(true);
  });

  it("a runtime edit of a concept throws and cannot desynchronise the id set", () => {
    const first = CANONICAL_CONCEPTS[0]! as { id: string };
    const before = first.id;
    expect(() => {
      first.id = "evil.concept";
    }).toThrow();
    expect(first.id).toBe(before);
    expect(isValidCanonicalId("evil.concept")).toBe(false);
    expect(isValidCanonicalId(before)).toBe(true);
  });

  it("concept ids are unique", () => {
    const ids = CANONICAL_CONCEPTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── 18. Same hash => same behaviour (order independence) ─────────────────

describe("Order independence", () => {
  const c2 = (ruleId: string, domains: string[]) =>
    rule({
      ruleId,
      rawKey: "beam",
      aliasClass: "class2_context",
      canonicalId: "dimension.width",
      contextGuards: { domains },
    });

  it("two Class 2 rules passing together give identical results in any order", () => {
    const rules = [c2("z-rule", ["Sea", "Air"]), c2("a-rule", ["Sea"]), c2("m-rule", ["Sea"])];
    const forward = compileSemanticSnapshot(rules);
    const reversed = compileSemanticSnapshot([...rules].reverse());
    const shuffled = compileSemanticSnapshot([rules[1]!, rules[0]!, rules[2]!]);
    expect(reversed.contentHash).toBe(forward.contentHash);
    expect(shuffled.contentHash).toBe(forward.contentHash);
    const ctx = { rawKey: "beam", domain: "Sea" };
    const r = forward.resolve(ctx);
    expect(r.matchedRuleId).toBe("a-rule");
    expect(reversed.resolve(ctx)).toEqual(r);
    expect(shuffled.resolve(ctx)).toEqual(r);
  });

  it("failing-guard audit is also order independent", () => {
    const rules = [c2("b", ["Sea"]), c2("a", ["Land"])];
    const f = compileSemanticSnapshot(rules).resolve({ rawKey: "beam", domain: "Air" });
    const r = compileSemanticSnapshot([...rules].reverse()).resolve({
      rawKey: "beam",
      domain: "Air",
    });
    expect(r).toEqual(f);
  });
});

// ─── 19. unitDimension guard ──────────────────────────────────────────────

describe("unitDimension guard", () => {
  it("weight with a mass unit resolves to weight.total", () => {
    for (const rawUnit of ["g", "kg", "lb"]) {
      const r = resolve("weight", { rawUnit });
      expect(r.status, rawUnit).toBe("resolved");
      expect(r.canonicalId).toBe("weight.total");
      const g = r.guardAudit!.find((a) => a.guardName === "unitDimension")!;
      expect(g.expected).toBe("mass");
      expect(g.actual).toBe("mass");
    }
  });

  it("weight with a non-mass, unknown or missing unit fails safe", () => {
    for (const rawUnit of ["km", "deg", "°", "banana", "", undefined]) {
      const r = resolve("weight", { rawUnit });
      expect(r.status, String(rawUnit)).toBe("unresolved_context");
      expect(r.canonicalId).toBeUndefined();
    }
  });

  it("rejects an unknown unitDimension at compile time", () => {
    expect(() =>
      compileSemanticSnapshot([
        rule({
          aliasClass: "class2_context",
          contextGuards: { unitDimension: "angle" as unknown as "mass" },
        }),
      ]),
    ).toThrow(/unknown unitDimension/);
  });

  it("combines with other guards: all must hold", () => {
    const s = compileSemanticSnapshot([
      rule({
        aliasClass: "class2_context",
        rawKey: "weight",
        canonicalId: "weight.total",
        contextGuards: { domains: ["Air"], unitDimension: "mass" },
      }),
    ]);
    expect(s.resolve({ rawKey: "weight", domain: "Air", rawUnit: "kg" }).status).toBe("resolved");
    expect(s.resolve({ rawKey: "weight", domain: "Sea", rawUnit: "kg" }).status).toBe(
      "unresolved_context",
    );
    expect(s.resolve({ rawKey: "weight", domain: "Air", rawUnit: "km" }).status).toBe(
      "unresolved_context",
    );
  });

  it("the guard is part of the content hash", () => {
    const h = (d: "mass" | "distance") =>
      compileSemanticSnapshot([
        rule({
          aliasClass: "class2_context",
          rawKey: "weight",
          canonicalId: "weight.total",
          contextGuards: { unitDimension: d },
        }),
      ]).contentHash;
    expect(h("mass")).not.toBe(h("distance"));
  });
});

// ─── 20. Complete guard audit ─────────────────────────────────────────────

describe("Complete guard audit", () => {
  const s = compileSemanticSnapshot([
    rule({
      aliasClass: "class2_context",
      rawKey: "span",
      canonicalId: "dimension.wingspan",
      contextGuards: {
        systemClasses: ["uav"],
        domains: ["Air"],
        subsystems: ["wing"],
        unitDimension: "distance",
      },
    }),
  ]);

  it("records every guard even when the first one fails", () => {
    const r = s.resolve({ rawKey: "span", systemClass: "usv", domain: "Sea" });
    expect(r.status).toBe("unresolved_context");
    expect(r.guardAudit!.map((g) => g.guardName)).toEqual([
      "systemClasses",
      "domains",
      "subsystems",
      "unitDimension",
    ]);
    expect(r.guardAudit!.every((g) => !g.satisfied)).toBe(true);
    expect(r.diagnostics.length).toBe(4);
  });

  it("marks only the failing guard as unsatisfied", () => {
    const r = s.resolve({
      rawKey: "span",
      systemClass: "uav",
      domain: "Air",
      subsystem: "wing",
      rawUnit: "kg",
    });
    expect(r.status).toBe("unresolved_context");
    expect(r.guardAudit!.filter((g) => !g.satisfied).map((g) => g.guardName)).toEqual([
      "unitDimension",
    ]);
  });

  it("resolves when all four hold", () => {
    expect(
      s.resolve({
        rawKey: "span",
        systemClass: "uav",
        domain: "Air",
        subsystem: "wing",
        rawUnit: "m",
      }).status,
    ).toBe("resolved");
  });
});

// ─── 21. Language scoping ─────────────────────────────────────────────────

describe("Language scoping", () => {
  const rules = [
    rule({ ruleId: "sv-1", rawKey: "fart", language: "sv", canonicalId: "speed.max" }),
    rule({ ruleId: "uk-1", rawKey: "fart", language: "uk", canonicalId: "speed.cruise" }),
    rule({
      ruleId: "all-1",
      rawKey: "wingspan",
      language: "all",
      canonicalId: "dimension.wingspan",
    }),
  ];
  const snap = compileSemanticSnapshot(rules);

  it("the same term resolves per caller language", () => {
    expect(snap.resolve({ rawKey: "fart", language: "sv" }).canonicalId).toBe("speed.max");
    expect(snap.resolve({ rawKey: "fart", language: "uk" }).canonicalId).toBe("speed.cruise");
  });

  it("a language-specific rule does not match another or an unknown language", () => {
    expect(snap.resolve({ rawKey: "fart", language: "en" }).status).toBe("unresolved_unknown");
    expect(snap.resolve({ rawKey: "fart" }).status).toBe("unresolved_unknown");
  });

  it("language 'all' rules apply to every caller, with or without a language", () => {
    for (const language of [undefined, "sv", "xx"]) {
      expect(
        snap.resolve({ rawKey: "wingspan", ...(language ? { language } : {}) }).canonicalId,
      ).toBe("dimension.wingspan");
    }
  });

  it("caller language is compared case-insensitively", () => {
    expect(snap.resolve({ rawKey: "fart", language: " SV " }).canonicalId).toBe("speed.max");
  });

  it("same key in overlapping language scopes is a compile error, disjoint scopes are not", () => {
    expect(() =>
      compileSemanticSnapshot([
        rule({ ruleId: "a", rawKey: "x", language: "all" }),
        rule({ ruleId: "b", rawKey: "x", language: "sv", canonicalId: "speed.cruise" }),
      ]),
    ).toThrow(/collides/);
    expect(() =>
      compileSemanticSnapshot([
        rule({ ruleId: "a", rawKey: "x", language: "en" }),
        rule({ ruleId: "b", rawKey: "x", language: "sv", canonicalId: "speed.cruise" }),
      ]),
    ).not.toThrow();
  });

  it("rejects an unknown rule language", () => {
    expect(() => compileSemanticSnapshot([rule({ language: "klingon" })])).toThrow(
      /unknown language/,
    );
  });

  it("language is part of the content hash", () => {
    const h = (language: string) => compileSemanticSnapshot([rule({ language })]).contentHash;
    expect(h("sv")).not.toBe(h("uk"));
  });
});
