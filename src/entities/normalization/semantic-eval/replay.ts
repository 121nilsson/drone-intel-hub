/**
 * Phase 3.2 / S0 — automated replay and technical invariants for the isolated semantic resolver.
 *
 * Pure: no database, no file I/O, no network, no import of the legacy normaliser. The legacy
 * function is injected by the caller, so this module cannot fall back to it.
 *
 * What this module can and cannot say (the report repeats it):
 *   1. PARITY WITH LEGACY — how the resolver's answers relate to the legacy normaliser's on the
 *      hand-written fixtures. This is agreement, not correctness: the legacy answer is not ground
 *      truth, and a pass-through is not a label.
 *   2. TECHNICAL INVARIANTS — properties that must hold for any input, checked without any human
 *      label. A pass means the resolver follows its own rules.
 *   3. SEMANTIC CORRECTNESS — is a raw term really that concept? Needs human-reviewed evidence.
 *      NOT measured here, and never inferred from 1 or 2.
 */

import { isValidCanonicalId } from "../canonical-manifest";
import {
  compileSemanticSnapshot,
  type Class1_3AliasDefinition,
  type Class4AliasDefinition,
  normalizeAliasKey,
  type ReadonlySemanticSnapshot,
  type ResolutionContextInput,
  type SemanticAliasDefinition,
} from "../semantic-resolver";
import type { SemanticResolutionResult } from "../semantic-result";
import { CANONICAL_UNIT, canonicalUnitFor, type Dimension } from "../units";

// ─── 1. Parity with legacy ─────────────────────────────────────────────────

/** Structural shape of a hand-written fixture (src/test/fixtures/normalization-corpus.ts). */
export interface ParityFixture {
  readonly key: string;
  readonly label?: string | undefined;
  /** What the fixture file says the legacy normaliser returns. */
  readonly expected: string;
  readonly note?: string | undefined;
}

export type ParityClass =
  /** Legacy and resolver resolved the same concept. */
  | "agree"
  /** Legacy passed the key through unchanged and the resolver also declined to resolve it. */
  | "agree_unrecognised"
  /** Legacy resolved a concept; the resolver declined (coverage gap, or deliberate withholding). */
  | "resolver_withholds"
  /** The resolver resolved something the legacy normaliser did not, or a different concept. */
  | "resolver_differs";

export interface ParityRow {
  readonly key: string;
  readonly label: string | undefined;
  readonly legacyOutput: string;
  readonly legacyRecognised: boolean;
  /** True when the fixture's `expected` is not what the legacy function returns right now. */
  readonly fixtureDrift: boolean;
  readonly resolverStatus: SemanticResolutionResult["status"];
  readonly resolverCanonicalId: string | undefined;
  readonly class: ParityClass;
  readonly detail: string;
}

/**
 * Replays fixtures through the resolver and classifies each against the legacy output.
 * `legacy` is injected (the caller owns the import of the legacy normaliser).
 */
export function replayFixtures(
  fixtures: readonly ParityFixture[],
  snapshot: ReadonlySemanticSnapshot,
  legacy: (key: string, label?: string) => string,
): ParityRow[] {
  return fixtures.map((f) => {
    const legacyOutput = legacy(f.key, f.label);
    // The legacy normaliser returns an unmapped key verbatim; that is "did not recognise".
    const legacyRecognised = legacyOutput !== f.key;
    const r = snapshot.resolve({
      rawKey: f.key,
      ...(f.label !== undefined ? { rawLabel: f.label } : {}),
    });
    const resolved = r.status === "resolved";

    let cls: ParityClass;
    let detail: string;
    if (legacyRecognised && resolved && r.canonicalId === legacyOutput) {
      cls = "agree";
      detail = `both resolve ${legacyOutput}`;
    } else if (legacyRecognised && resolved) {
      cls = "resolver_differs";
      detail = `legacy ${legacyOutput}, resolver ${r.canonicalId}`;
    } else if (legacyRecognised) {
      cls = "resolver_withholds";
      detail = `legacy ${legacyOutput}, resolver ${r.status}`;
    } else if (resolved) {
      cls = "resolver_differs";
      detail = `legacy passed the key through, resolver resolved ${r.canonicalId}`;
    } else {
      cls = "agree_unrecognised";
      detail = `neither resolves (${r.status})`;
    }

    return {
      key: f.key,
      label: f.label,
      legacyOutput,
      legacyRecognised,
      fixtureDrift: legacyOutput !== f.expected,
      resolverStatus: r.status,
      resolverCanonicalId: r.canonicalId,
      class: cls,
      detail,
    };
  });
}

export function countParity(rows: readonly ParityRow[]): Record<ParityClass, number> {
  const out: Record<ParityClass, number> = {
    agree: 0,
    agree_unrecognised: 0,
    resolver_withholds: 0,
    resolver_differs: 0,
  };
  for (const r of rows) out[r.class]++;
  return out;
}

// ─── 2. Technical invariants ───────────────────────────────────────────────

export interface InvariantResult {
  readonly id: string;
  readonly title: string;
  /** How many individual cases were evaluated. */
  readonly checked: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

/** The resolver surface the invariants need; satisfied by a real snapshot or a test double. */
export interface InvariantSubject {
  readonly snapshot: ReadonlySemanticSnapshot;
  readonly rules: readonly SemanticAliasDefinition[];
}

/** Spellings that must resolve identically. Defined classes only, never a universal claim. */
export const EQUIVALENCE_CLASSES: readonly (readonly string[])[] = [
  [
    "top_speed",
    "Top Speed",
    "top-speed",
    "topSpeed",
    "TOP_SPEED",
    "top.speed",
    "Top/Speed",
    "ｔｏｐ＿ｓｐｅｅｄ",
  ],
  ["max_range", "Max Range", "maxRange", "max-range", "MAX_RANGE"],
  ["service_ceiling", "Service Ceiling", "serviceCeiling", "service-ceiling"],
  ["warhead_weight", "Warhead Weight", "warheadWeight", "warhead-weight"],
];

/** Pairs of raw keys that must never resolve to the same concept. */
export const MUST_DIFFER: readonly (readonly [string, string])[] = [
  ["top_speed", "cruising_speed"],
  ["warhead_weight", "payload_capacity"],
  ["service_ceiling", "max_altitude"],
  ["combat_radius", "max_range"],
  ["jamming_power", "engine_power"],
  ["range_min", "max_range"],
  ["range_min", "range"],
];

/** Keys whose normalised forms must stay distinct (delimiters and unit suffixes carry meaning). */
export const MUST_STAY_DISTINCT: readonly (readonly [string, string])[] = [
  ["range_min", "range"],
  ["aircraft", "air_craft"],
  ["air-craft", "aircraft"],
  ["altitude_min", "altitude"],
];

/** Terms that are in no rule set; deterministic so the report is reproducible. */
const UNKNOWN_PROBES: readonly string[] = [
  "hypothetical_laser_emitter",
  "some_exotic_attribute_xyz",
  "hypothetical_quantum_deflector",
  "flux_capacitor_rating",
  "zorblax",
  "max_zorblax_speed",
  "левітація",
  "ёмкость_антигравитации",
  "höjd_över_molnen",
  "最大幻想速度",
  "x",
  "unit_cost_of_nothing",
  "zorblax_rating",
  "total_cost",
  "programme_cost",
  "project_cost",
  "range_of_motion_in_yoga",
  "speed.fake",
  "range.hypothetical",
  "масса",
  "нагрузка",
  "боевые_части",
];

/** Near-miss canonical identifiers: must not be accepted by Gate 0. */
const NEAR_MISS_IDS: readonly string[] = [
  "speed.",
  ".max",
  "speed.max.extra",
  "speed..max",
  "range.hypothetical",
  "speedmax",
  "speed max extra",
];

const DOMAINS: readonly (string | undefined)[] = ["Air", "Sea", "Land", "Space", undefined];
const SYSTEM_CLASSES: readonly (string | undefined)[] = ["uav", "c-uas", "jammer", undefined];
const SUBSYSTEMS: readonly (string | undefined)[] = ["jammer", "engine", "radar", undefined];
const UNITS: readonly (string | undefined)[] = [undefined, "kg", "km", "W", "m/s", "m/s2", "deg"];

function ctx(
  rawKey: string,
  p: Partial<Omit<ResolutionContextInput, "rawKey">> = {},
): ResolutionContextInput {
  const out: { -readonly [K in keyof ResolutionContextInput]: ResolutionContextInput[K] } = {
    rawKey,
  };
  for (const [k, v] of Object.entries(p))
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function sampleUnitFor(dimension: Dimension): string {
  return CANONICAL_UNIT[dimension];
}

function otherUnitThan(dimension: Dimension): string {
  return dimension === "distance" ? CANONICAL_UNIT.mass : CANONICAL_UNIT.distance;
}

function shortJson(r: SemanticResolutionResult): string {
  return `${r.status}${r.canonicalId ? `:${r.canonicalId}` : ""}`;
}

/** Collects failures for one invariant, capped so a systemic break stays readable. */
class Check {
  checked = 0;
  readonly failures: string[] = [];
  constructor(
    readonly id: string,
    readonly title: string,
  ) {}
  ok(condition: boolean, message: string): void {
    this.checked++;
    if (!condition && this.failures.length < 20) this.failures.push(message);
    else if (!condition) this.failures.push("");
  }
  result(): InvariantResult {
    const failures = this.failures.filter((f) => f !== "");
    const extra = this.failures.length - failures.length;
    return {
      id: this.id,
      title: this.title,
      checked: this.checked,
      passed: this.failures.length === 0,
      failures: extra > 0 ? [...failures, `… and ${extra} more`] : failures,
    };
  }
}

export function runInvariants(subject: InvariantSubject): InvariantResult[] {
  const { snapshot, rules } = subject;
  const results: InvariantResult[] = [];
  const known = new Set(rules.map((r) => normalizeAliasKey(r.rawKey)));
  const nonAmbiguous = rules.filter(
    (r): r is Class1_3AliasDefinition => r.aliasClass !== "class4_ambiguous",
  );
  const direct = nonAmbiguous.filter((r) => r.aliasClass !== "class2_context");
  const class2 = nonAmbiguous.filter((r) => r.aliasClass === "class2_context");
  const class4 = rules.filter(
    (r): r is Class4AliasDefinition => r.aliasClass === "class4_ambiguous",
  );
  const lang = (r: { language: string }) => (r.language === "all" ? {} : { language: r.language });

  // INV-01
  {
    const c = new Check("INV-01", "Every Class 1/3 rule resolves its own key to its own concept");
    for (const r of direct) {
      const label = r.labelTokens ? r.labelTokens.join(" ") : undefined;
      const got = snapshot.resolve(ctx(r.rawKey, { ...lang(r), rawLabel: label }));
      c.ok(
        got.status === "resolved" &&
          got.canonicalId === r.canonicalId &&
          got.matchedRuleId === r.ruleId,
        `${r.ruleId}: '${r.rawKey}' → ${shortJson(got)} (expected ${r.canonicalId})`,
      );
    }
    results.push(c.result());
  }

  // INV-02
  {
    const c = new Check(
      "INV-02",
      "A known-ambiguous (Class 4) term never resolves, in any context",
    );
    for (const r of class4) {
      for (const domain of DOMAINS)
        for (const systemClass of SYSTEM_CLASSES)
          for (const subsystem of SUBSYSTEMS)
            for (const rawUnit of UNITS) {
              const got = snapshot.resolve(
                ctx(r.rawKey, { ...lang(r), domain, systemClass, subsystem, rawUnit }),
              );
              c.ok(
                got.status === "unresolved_ambiguous" &&
                  got.canonicalId === undefined &&
                  (got.candidateCanonicalIds ?? []).length > 0 &&
                  (got.candidateCanonicalIds ?? []).every(isValidCanonicalId),
                `${r.ruleId}: '${r.rawKey}' ${JSON.stringify({ domain, systemClass, subsystem, rawUnit })} → ${shortJson(got)}`,
              );
            }
    }
    results.push(c.result());
  }

  // INV-03
  {
    const c = new Check(
      "INV-03",
      "A Class 2 rule withholds without its context, resolves with all guards met, and withholds when any single guard is violated",
    );
    for (const r of class2) {
      const g = r.contextGuards ?? {};
      const satisfying: Partial<ResolutionContextInput> = {
        ...lang(r),
        ...(g.systemClasses?.[0] !== undefined ? { systemClass: g.systemClasses[0] } : {}),
        ...(g.domains?.[0] !== undefined ? { domain: g.domains[0] } : {}),
        ...(g.subsystems?.[0] !== undefined ? { subsystem: g.subsystems[0] } : {}),
        ...(g.unitDimension !== undefined ? { rawUnit: sampleUnitFor(g.unitDimension) } : {}),
      };
      const label = r.labelTokens ? r.labelTokens.join(" ") : undefined;

      const none = snapshot.resolve(ctx(r.rawKey, { ...lang(r), rawLabel: label }));
      c.ok(none.status === "unresolved_context", `${r.ruleId}: no context → ${shortJson(none)}`);

      const ok = snapshot.resolve(ctx(r.rawKey, { ...satisfying, rawLabel: label }));
      c.ok(
        ok.status === "resolved" && ok.canonicalId === r.canonicalId,
        `${r.ruleId}: guards met → ${shortJson(ok)} (expected ${r.canonicalId})`,
      );

      const violations: Array<[string, Partial<ResolutionContextInput>]> = [];
      if (g.systemClasses)
        violations.push(["systemClasses", { ...satisfying, systemClass: "__other__" }]);
      if (g.domains) violations.push(["domains", { ...satisfying, domain: "__other__" }]);
      if (g.subsystems) violations.push(["subsystems", { ...satisfying, subsystem: "__other__" }]);
      if (g.unitDimension !== undefined)
        violations.push([
          "unitDimension",
          { ...satisfying, rawUnit: otherUnitThan(g.unitDimension) },
        ]);
      for (const [name, partial] of violations) {
        const got = snapshot.resolve(ctx(r.rawKey, { ...partial, rawLabel: label }));
        c.ok(
          got.status === "unresolved_context" && got.canonicalId === undefined,
          `${r.ruleId}: guard ${name} violated → ${shortJson(got)}`,
        );
      }
    }
    results.push(c.result());
  }

  // INV-04
  {
    const c = new Check(
      "INV-04",
      "An unknown term never gets a canonical id and is never echoed back as one",
    );
    for (const term of UNKNOWN_PROBES) {
      if (known.has(normalizeAliasKey(term))) continue;
      const got = snapshot.resolve(ctx(term));
      c.ok(
        got.status === "unresolved_unknown" &&
          got.canonicalId === undefined &&
          got.rawKey === term &&
          got.candidateCanonicalIds === undefined,
        `'${term}' → ${shortJson(got)}`,
      );
    }
    results.push(c.result());
  }

  // INV-05
  {
    const c = new Check(
      "INV-05",
      "canonicalId is present if and only if status is 'resolved', and is always a manifest concept",
    );
    const probes: ResolutionContextInput[] = [
      ...rules.map((r) => ctx(r.rawKey, lang(r))),
      ...UNKNOWN_PROBES.map((t) => ctx(t)),
      ...NEAR_MISS_IDS.map((t) => ctx(t)),
      ...class2.flatMap((r) => DOMAINS.map((domain) => ctx(r.rawKey, { ...lang(r), domain }))),
    ];
    for (const p of probes) {
      const got = snapshot.resolve(p);
      const resolved = got.status === "resolved";
      c.ok(
        resolved === (got.canonicalId !== undefined) &&
          (!resolved || isValidCanonicalId(got.canonicalId ?? "")),
        `'${p.rawKey}' → ${shortJson(got)}`,
      );
    }
    results.push(c.result());
  }

  // INV-06
  {
    const c = new Check("INV-06", "Distinct concepts do not collapse");
    for (let i = 0; i < direct.length; i++) {
      for (let j = i + 1; j < direct.length; j++) {
        const a = direct[i]!;
        const b = direct[j]!;
        if (a.canonicalId === b.canonicalId) continue;
        const ra = snapshot.resolve(ctx(a.rawKey, lang(a)));
        const rb = snapshot.resolve(ctx(b.rawKey, lang(b)));
        c.ok(
          ra.canonicalId !== rb.canonicalId,
          `'${a.rawKey}' and '${b.rawKey}' both → ${ra.canonicalId}`,
        );
      }
    }
    for (const [x, y] of MUST_DIFFER) {
      const rx = snapshot.resolve(ctx(x));
      const ry = snapshot.resolve(ctx(y));
      c.ok(
        rx.canonicalId === undefined ||
          ry.canonicalId === undefined ||
          rx.canonicalId !== ry.canonicalId,
        `named pair '${x}' / '${y}' both → ${rx.canonicalId}`,
      );
    }
    results.push(c.result());
  }

  // INV-07
  {
    const c = new Check(
      "INV-07",
      "Spellings in the defined equivalence classes resolve identically (not a universal claim)",
    );
    for (const cls of EQUIVALENCE_CLASSES) {
      const [head, ...rest] = cls;
      const base = snapshot.resolve(ctx(head!));
      for (const v of rest) {
        const got = snapshot.resolve(ctx(v));
        c.ok(
          got.status === base.status &&
            got.canonicalId === base.canonicalId &&
            got.matchedRuleId === base.matchedRuleId,
          `'${v}' → ${shortJson(got)} but '${head}' → ${shortJson(base)}`,
        );
      }
    }
    results.push(c.result());
  }

  // INV-08
  {
    const c = new Check(
      "INV-08",
      "Delimiters and unit suffixes that carry meaning keep keys distinct",
    );
    for (const [a, b] of MUST_STAY_DISTINCT) {
      c.ok(
        normalizeAliasKey(a) !== normalizeAliasKey(b),
        `'${a}' and '${b}' normalise to the same key '${normalizeAliasKey(a)}'`,
      );
    }
    results.push(c.result());
  }

  // INV-09
  {
    const c = new Check(
      "INV-09",
      "Resolution is deterministic: 200 repeats give byte-identical results",
    );
    const probes: ResolutionContextInput[] = [
      ...direct.slice(0, 6).map((r) => ctx(r.rawKey)),
      ...class4.slice(0, 3).map((r) => ctx(r.rawKey)),
      ...class2.slice(0, 3).map((r) => ctx(r.rawKey, { domain: "Sea", rawUnit: "kg" })),
      ...UNKNOWN_PROBES.slice(0, 4).map((t) => ctx(t)),
    ];
    for (const p of probes) {
      const first = JSON.stringify(snapshot.resolve(p));
      let same = true;
      for (let i = 0; i < 200; i++) if (JSON.stringify(snapshot.resolve(p)) !== first) same = false;
      c.ok(same, `'${p.rawKey}' changed between repeats`);
    }
    results.push(c.result());
  }

  // INV-10
  {
    const c = new Check("INV-10", "Results are deeply frozen and share no mutable state");
    const sample: ResolutionContextInput[] = [
      ...direct.slice(0, 1).map((r) => ctx(r.rawKey)),
      ...class4.slice(0, 1).map((r) => ctx(r.rawKey)),
      ...class2.slice(0, 1).flatMap((r) => [
        ctx(r.rawKey),
        ctx(r.rawKey, {
          ...lang(r),
          ...(r.contextGuards?.domains?.[0] ? { domain: r.contextGuards.domains[0] } : {}),
          ...(r.contextGuards?.unitDimension
            ? { rawUnit: sampleUnitFor(r.contextGuards.unitDimension) }
            : {}),
        }),
      ]),
      ctx(UNKNOWN_PROBES[0]!),
    ];
    for (const p of sample) {
      const got = snapshot.resolve(p);
      const entriesFrozen = (got.guardAudit ?? []).every(
        (g) =>
          Object.isFrozen(g) && (typeof g.expected === "string" || Object.isFrozen(g.expected)),
      );
      c.ok(
        Object.isFrozen(got) &&
          Object.isFrozen(got.diagnostics) &&
          (got.guardAudit === undefined || Object.isFrozen(got.guardAudit)) &&
          (got.candidateCanonicalIds === undefined || Object.isFrozen(got.candidateCanonicalIds)) &&
          entriesFrozen,
        `'${p.rawKey}' result is not fully frozen`,
      );
    }
    results.push(c.result());
  }

  // INV-11
  {
    const c = new Check(
      "INV-11",
      "The content hash and the answers do not depend on rule input order",
    );
    let reversed: ReadonlySemanticSnapshot | undefined;
    try {
      reversed = compileSemanticSnapshot([...rules].reverse());
    } catch (e) {
      c.ok(false, `recompiling the same rules failed: ${(e as Error).message}`);
    }
    if (reversed) {
      c.ok(
        reversed.contentHash === snapshot.contentHash,
        `hash differs: ${reversed.contentHash} vs ${snapshot.contentHash}`,
      );
      for (const r of rules) {
        const p = ctx(r.rawKey, lang(r));
        c.ok(
          JSON.stringify(reversed.resolve(p)) === JSON.stringify(snapshot.resolve(p)),
          `'${r.rawKey}' answers differ after reordering`,
        );
      }
    }
    results.push(c.result());
  }

  // INV-12
  {
    const c = new Check(
      "INV-12",
      "Unit classification needs a full match: acceleration is never speed, prefixes never decide a dimension",
    );
    c.ok(canonicalUnitFor("m/s") === CANONICAL_UNIT.speed, "m/s is not a speed");
    for (const u of ["m/s2", "m/s²", "м/с2"]) {
      c.ok(canonicalUnitFor(u) === CANONICAL_UNIT.acceleration, `${u} is not an acceleration`);
    }
    for (const u of ["m/s3", "m/s2x", "km/hx", "kgx", "banana", ""]) {
      c.ok(canonicalUnitFor(u) === undefined, `'${u}' was classified as ${canonicalUnitFor(u)}`);
    }
    results.push(c.result());
  }

  // INV-13
  {
    const c = new Check("INV-13", "Near-miss canonical identifiers are not accepted by Gate 0");
    for (const id of NEAR_MISS_IDS) {
      const got = snapshot.resolve(ctx(id));
      c.ok(got.matchType !== "canonical_identity", `'${id}' was accepted as a canonical identity`);
      c.ok(
        got.canonicalId === undefined || isValidCanonicalId(got.canonicalId),
        `'${id}' → ${shortJson(got)}`,
      );
    }
    results.push(c.result());
  }

  return results;
}

// ─── 3. Report ─────────────────────────────────────────────────────────────

export interface ReportInput {
  readonly snapshot: ReadonlySemanticSnapshot;
  readonly resolverVersion: string;
  readonly unitNormalizerVersion: string;
  readonly fixtureCount: number;
  readonly parity: readonly ParityRow[];
  readonly invariants: readonly InvariantResult[];
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

/** Deterministic markdown (no timestamps): same inputs, same bytes. */
export function renderReport(input: ReportInput): string {
  const { snapshot, parity, invariants } = input;
  const counts = countParity(parity);
  const invOk = invariants.every((i) => i.passed);
  const lines: string[] = [];

  lines.push("# Semantic resolver replay (Phase 3.2 / S0)", "");
  lines.push(
    "> **A green S0 report does not show that the resolver is semantically correct.** It compares the resolver with the legacy normaliser on hand-written fixtures (agreement, not correctness) and checks technical invariants that need no human label. Whether a raw term really means a concept needs human-reviewed evidence, which S0 does not collect.",
    "",
  );
  lines.push(
    `- Snapshot: \`${snapshot.snapshotId}\`, hash \`${snapshot.contentHash}\``,
    `- Resolver version ${input.resolverVersion}, manifest ${snapshot.manifestVersion}, unit normalizer ${input.unitNormalizerVersion}`,
    `- Seed-only snapshot: ${snapshot.isDegradedSeedOnly ? "yes" : "no"}`,
    "",
  );

  lines.push("## 1. Parity with the legacy normaliser (not correctness)", "");
  lines.push(
    `${input.fixtureCount} hand-written fixtures. The legacy answer is not ground truth, and a legacy pass-through is not a label.`,
    "",
    `| Class | Count |`,
    `|---|---|`,
    `| agree | ${counts.agree} |`,
    `| agree_unrecognised | ${counts.agree_unrecognised} |`,
    `| resolver_withholds | ${counts.resolver_withholds} |`,
    `| resolver_differs | ${counts.resolver_differs} |`,
    "",
    "| Key | Label | Legacy | Resolver | Class | Detail |",
    "|---|---|---|---|---|---|",
  );
  for (const r of parity) {
    lines.push(
      `| ${cell(r.key)} | ${cell(r.label ?? "")} | ${cell(r.legacyOutput)} | ${cell(
        r.resolverCanonicalId ?? r.resolverStatus,
      )} | ${r.class} | ${cell(r.detail)}${r.fixtureDrift ? " (fixture expectation differs from the live legacy output)" : ""} |`,
    );
  }
  lines.push("");
  const differs = parity.filter((r) => r.class === "resolver_differs");
  lines.push(
    differs.length === 0
      ? "No `resolver_differs` rows. `resolver_withholds` rows are coverage gaps or deliberate withholding, not errors."
      : `**${differs.length} \`resolver_differs\` row(s) need a human look:** ${differs.map((d) => `\`${d.key}\``).join(", ")}.`,
    "",
  );

  lines.push("## 2. Technical invariants", "");
  lines.push(
    `Result: **${invOk ? "ALL PASS" : "FAILURES"}** (${invariants.filter((i) => i.passed).length}/${invariants.length} invariants).`,
    "",
    "| Id | Invariant | Cases | Result |",
    "|---|---|---|---|",
  );
  for (const i of invariants) {
    lines.push(`| ${i.id} | ${cell(i.title)} | ${i.checked} | ${i.passed ? "pass" : "**FAIL**"} |`);
  }
  lines.push("");
  for (const i of invariants.filter((x) => !x.passed)) {
    lines.push(`### ${i.id} failures`, "", ...i.failures.map((f) => `- ${f}`), "");
  }

  lines.push("## 3. Semantic correctness", "");
  lines.push(
    "**Not measured by S0.** No claim is made about whether any mapping is right. This needs the human-reviewed evidence planned in Phase 3.2 S1–S5.",
    "",
  );
  return lines.join("\n");
}

/** The committed parity report that `evaluate-semantic-registry` regenerates in replay mode. */
export const DEFAULT_REPLAY_REPORT_PATH = "scripts/output/semantic-replay.md";

/**
 * Where `evaluate-semantic-registry` writes the parity replay report, from its arguments.
 * Replay mode (no `--report`) regenerates the committed report by default. Under `--report` (S5)
 * the run is a check of an evaluation directory, so it writes the replay report only when `--out`
 * or `--stdout` asks for it and never rewrites the committed file implicitly (review finding R6).
 */
export function replayReportTarget(
  args: readonly string[],
):
  | { readonly kind: "stdout" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "skip" }
  | { readonly kind: "invalid"; readonly reason: string } {
  const i = args.indexOf("--out");
  if (i >= 0) {
    const out = args[i + 1];
    // A missing value, or the next flag in its place, is an error, never a file name (Q4).
    if (out === undefined || out.length === 0 || out.startsWith("--")) {
      return { kind: "invalid", reason: "--out needs a file path" };
    }
    if (args.includes("--stdout")) {
      return { kind: "invalid", reason: "--out and --stdout exclude each other" };
    }
    return { kind: "file", path: out };
  }
  if (args.includes("--stdout")) return { kind: "stdout" };
  if (args.includes("--report")) return { kind: "skip" };
  return { kind: "file", path: DEFAULT_REPLAY_REPORT_PATH };
}
