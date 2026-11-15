/**
 * Phase 3.2 / S0: the replay module is itself tested, so a green report can be trusted to mean
 * what it says (technical invariants hold) and a broken resolver is shown to turn it red.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { semanticKeyFor } from "../entities/normalization/semantic";
import {
  CODE_SEED_RULES,
  CODE_SEED_SNAPSHOT,
  SEMANTIC_RESOLVER_VERSION,
  compileSemanticSnapshot,
  type ReadonlySemanticSnapshot,
  type SemanticAliasDefinition,
} from "../entities/normalization/semantic-resolver";
import {
  countParity,
  renderReport,
  replayFixtures,
  runInvariants,
  type ParityFixture,
} from "../entities/normalization/semantic-eval/replay";
import type { SemanticResolutionResult } from "../entities/normalization/semantic-result";
import { UNIT_NORMALIZER_VERSION } from "../entities/normalization/units";
import { SEMANTICS } from "./fixtures/normalization-corpus";

const rule = (over: Record<string, unknown>): SemanticAliasDefinition =>
  ({
    ruleId: "r",
    canonicalId: "speed.max",
    aliasClass: "class1_synonym",
    language: "all",
    rawKey: "k",
    rationale: "t",
    author: "t",
    ...over,
  }) as SemanticAliasDefinition;

describe("replayFixtures: parity classes", () => {
  const snap = compileSemanticSnapshot([
    rule({ ruleId: "a", rawKey: "alpha", canonicalId: "speed.max" }),
    rule({ ruleId: "b", rawKey: "beta", canonicalId: "speed.cruise" }),
    rule({ ruleId: "c", rawKey: "gamma", canonicalId: "range.max" }),
  ]);
  const fixtures: ParityFixture[] = [
    { key: "alpha", expected: "speed.max" }, // both resolve the same
    { key: "beta", expected: "speed.max" }, // resolver says cruise, legacy says max
    { key: "delta", expected: "range.max" }, // legacy resolves, resolver does not know it
    { key: "gamma", expected: "gamma" }, // legacy passes through, resolver resolves
    { key: "epsilon", expected: "epsilon" }, // neither resolves
  ];
  const legacy = (key: string) => fixtures.find((f) => f.key === key)!.expected;
  const rows = replayFixtures(fixtures, snap, legacy);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  it("classifies each case", () => {
    expect(byKey["alpha"]!.class).toBe("agree");
    expect(byKey["beta"]!.class).toBe("resolver_differs");
    expect(byKey["delta"]!.class).toBe("resolver_withholds");
    expect(byKey["gamma"]!.class).toBe("resolver_differs");
    expect(byKey["epsilon"]!.class).toBe("agree_unrecognised");
  });

  it("counts every class", () => {
    expect(countParity(rows)).toEqual({
      agree: 1,
      agree_unrecognised: 1,
      resolver_withholds: 1,
      resolver_differs: 2,
    });
  });

  it("flags a fixture whose expectation no longer matches the live legacy output", () => {
    const drift = replayFixtures(
      [{ key: "alpha", expected: "speed.max" }],
      snap,
      () => "speed.cruise",
    );
    expect(drift[0]!.fixtureDrift).toBe(true);
    expect(rows.every((r) => !r.fixtureDrift)).toBe(true);
  });

  it("uses the injected legacy function, not an import", () => {
    const src = readFileSync(
      join(__dirname, "..", "entities", "normalization", "semantic-eval", "replay.ts"),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/from\s+["']\.\.\/semantic["']|semanticKeyFor|process\.env|node:fs/);
  });
});

describe("real fixtures against the seed snapshot", () => {
  const rows = replayFixtures(SEMANTICS, CODE_SEED_SNAPSHOT, semanticKeyFor);
  const byKey = new Map(rows.map((r) => [`${r.key}|${r.label ?? ""}`, r]));

  it("covers every fixture and the live legacy output matches each expectation", () => {
    expect(rows).toHaveLength(SEMANTICS.length);
    expect(rows.filter((r) => r.fixtureDrift)).toEqual([]);
  });

  it("never disagrees with legacy by resolving a different concept", () => {
    expect(rows.filter((r) => r.class === "resolver_differs")).toEqual([]);
  });

  it("pins the cases the review cares about", () => {
    expect(byKey.get("max_range|")!.class).toBe("agree");
    expect(byKey.get("combat_radius|")!.class).toBe("agree");
    expect(byKey.get("wingspan|")!.class).toBe("agree");
    // A bare 'beam' without a Sea domain is withheld, where legacy resolved it.
    expect(byKey.get("beam|Beam")!.class).toBe("resolver_withholds");
    expect(byKey.get("some_unknown_key|")!.class).toBe("agree_unrecognised");
  });
});

describe("technical invariants on the seed snapshot", () => {
  const results = runInvariants({ snapshot: CODE_SEED_SNAPSHOT, rules: CODE_SEED_RULES });

  it("all pass", () => {
    expect(results.filter((r) => !r.passed)).toEqual([]);
  });

  it("each invariant actually evaluated cases", () => {
    for (const r of results) expect(r.checked, r.id).toBeGreaterThan(0);
    expect(results.map((r) => r.id)).toEqual([
      "INV-01",
      "INV-02",
      "INV-03",
      "INV-04",
      "INV-05",
      "INV-06",
      "INV-07",
      "INV-08",
      "INV-09",
      "INV-10",
      "INV-11",
      "INV-12",
      "INV-13",
    ]);
  });
});

describe("invariants turn red for a broken resolver (they can fail)", () => {
  /** A resolver that wraps the real one and corrupts selected answers. */
  const broken = (
    corrupt: (input: string, r: SemanticResolutionResult) => SemanticResolutionResult,
  ): ReadonlySemanticSnapshot => ({
    ...CODE_SEED_SNAPSHOT,
    resolve: (input) => corrupt(input.rawKey, CODE_SEED_SNAPSHOT.resolve(input)),
  });
  const failing = (snap: ReadonlySemanticSnapshot) =>
    runInvariants({ snapshot: snap, rules: CODE_SEED_RULES })
      .filter((r) => !r.passed)
      .map((r) => r.id);

  it("INV-02 and INV-05: a Class 4 term that resolves", () => {
    const snap = broken((k, r) =>
      k === "power" ? { ...r, status: "resolved", canonicalId: "power.rf" } : r,
    );
    expect(failing(snap)).toEqual(expect.arrayContaining(["INV-02"]));
  });

  it("INV-04: an unknown term echoed back as a canonical id", () => {
    const snap = broken((k, r) =>
      k === "zorblax" ? { ...r, status: "resolved", canonicalId: "speed.max" } : r,
    );
    expect(failing(snap)).toContain("INV-04");
  });

  it("INV-05: a canonical id on an unresolved result", () => {
    const snap = broken((k, r) => (k === "zorblax" ? { ...r, canonicalId: "speed.max" } : r));
    expect(failing(snap)).toContain("INV-05");
  });

  it("INV-01 and INV-06: two concepts collapsed into one", () => {
    const snap = broken((k, r) =>
      k === "cruising_speed" ? { ...r, canonicalId: "speed.max" } : r,
    );
    const ids = failing(snap);
    expect(ids).toContain("INV-01");
    expect(ids).toContain("INV-06");
  });

  it("INV-03: a Class 2 rule that ignores its guard", () => {
    const snap = broken((k, r) =>
      k === "beam" ? { ...r, status: "resolved", canonicalId: "dimension.width" } : r,
    );
    expect(failing(snap)).toContain("INV-03");
  });

  it("INV-07: a spelling variant that resolves differently", () => {
    const snap = broken((k, r) =>
      k === "Top Speed" ? { ...r, status: "unresolved_unknown", canonicalId: undefined } : r,
    );
    expect(failing(snap)).toContain("INV-07");
  });

  it("INV-10: a result that is not frozen", () => {
    const snap = broken((k, r) => (k === "top_speed" ? { ...r } : r));
    expect(failing(snap)).toContain("INV-10");
  });

  it("INV-09: a resolver that is not deterministic", () => {
    let n = 0;
    const snap = broken((k, r) =>
      k === "top_speed" ? Object.freeze({ ...r, diagnostics: Object.freeze([String(n++)]) }) : r,
    );
    expect(failing(snap)).toContain("INV-09");
  });

  it("INV-11: a snapshot whose hash depends on rule order", () => {
    // Real snapshot, but rules handed in an order whose recompile can no longer match this hash.
    const wrongHash = { ...CODE_SEED_SNAPSHOT, contentHash: "0".repeat(64) };
    expect(failing(wrongHash)).toContain("INV-11");
  });

  it("INV-13: a near-miss canonical id accepted by Gate 0", () => {
    const snap = broken((k, r) =>
      k === "speed."
        ? { ...r, status: "resolved", canonicalId: "speed.max", matchType: "canonical_identity" }
        : r,
    );
    expect(failing(snap)).toContain("INV-13");
  });
});

describe("renderReport", () => {
  const parity = replayFixtures(SEMANTICS, CODE_SEED_SNAPSHOT, semanticKeyFor);
  const invariants = runInvariants({ snapshot: CODE_SEED_SNAPSHOT, rules: CODE_SEED_RULES });
  const input = {
    snapshot: CODE_SEED_SNAPSHOT,
    resolverVersion: SEMANTIC_RESOLVER_VERSION,
    unitNormalizerVersion: UNIT_NORMALIZER_VERSION,
    fixtureCount: SEMANTICS.length,
    parity,
    invariants,
  };
  const report = renderReport(input);

  it("opens by saying a green report is not semantic correctness", () => {
    expect(report.split("\n").slice(0, 4).join("\n")).toMatch(
      /does not show that the resolver is semantically correct/,
    );
  });

  it("keeps the three sections separate, in order", () => {
    const i1 = report.indexOf("## 1. Parity with the legacy normaliser (not correctness)");
    const i2 = report.indexOf("## 2. Technical invariants");
    const i3 = report.indexOf("## 3. Semantic correctness");
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(report.slice(i3)).toMatch(/Not measured by S0/);
  });

  it("is deterministic (no timestamps) and records the versions it ran against", () => {
    expect(renderReport(input)).toBe(report);
    expect(report).toContain(CODE_SEED_SNAPSHOT.contentHash);
    expect(report).toContain(`unit normalizer ${UNIT_NORMALIZER_VERSION}`);
    expect(report).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  it("shows failures, not just a summary, when an invariant fails", () => {
    const red = renderReport({
      ...input,
      invariants: [
        { id: "INV-99", title: "demo", checked: 3, passed: false, failures: ["case x → resolved"] },
      ],
    });
    expect(red).toContain("FAILURES");
    expect(red).toContain("### INV-99 failures");
    expect(red).toContain("case x → resolved");
  });

  it("calls out resolver_differs rows for a human look", () => {
    const withDiff = renderReport({
      ...input,
      parity: [
        {
          key: "k",
          label: undefined,
          legacyOutput: "speed.max",
          legacyRecognised: true,
          fixtureDrift: false,
          resolverStatus: "resolved",
          resolverCanonicalId: "speed.cruise",
          class: "resolver_differs",
          detail: "legacy speed.max, resolver speed.cruise",
        },
      ],
    });
    expect(withDiff).toMatch(/1 `resolver_differs` row\(s\) need a human look/);
  });
});
