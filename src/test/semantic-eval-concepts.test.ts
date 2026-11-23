import { describe, expect, it } from "vitest";
import {
  CODE_SEED_RULES,
  CODE_SEED_SNAPSHOT,
  compileSemanticSnapshot,
} from "@/entities/normalization/semantic-resolver";
import {
  CANONICAL_CONCEPTS,
  CANONICAL_MANIFEST_VERSION,
  isValidCanonicalId,
} from "@/entities/normalization/canonical-manifest";
import {
  buildConceptCatalog,
  canonicalIdsInCatalog,
  canonicalIdNotInSnapshotMessage,
  renderConceptCatalog,
  renderConceptCatalogCsv,
} from "@/entities/normalization/semantic-eval/concepts";
import {
  exportBlindCsv,
  exportDecisionsCsv,
  exportRevealCsv,
  importCsv,
  encodeCsv,
  parseCsv,
} from "@/entities/normalization/semantic-eval/csv";
import {
  EVAL_PROTOCOL_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  isUnassessableVerdict,
  type Decision,
  type Example,
} from "@/entities/normalization/semantic-eval/types";
import { validateDecision } from "@/entities/normalization/semantic-eval/validate";
import { computeMetrics } from "@/entities/normalization/semantic-eval/metrics";
import { sha256Hex } from "@/entities/normalization/sha256";

const catalog = buildConceptCatalog(CODE_SEED_RULES, CODE_SEED_SNAPSHOT);
const ID = sha256Hex("concept-example");

function example(over: Partial<Example> = {}): Example {
  return {
    exampleId: ID,
    sourceClusterId: sha256Hex("source"),
    evidenceClusterId: sha256Hex("evidence"),
    source: { id: "dispatch-1" },
    excerpt: "Maximum speed 120 km/h.",
    language: "en",
    rawKey: "max_speed",
    context: {},
    family: "speed",
    resolverStatus: "resolved",
    stratum: "en|speed|resolved",
    origin: "historical",
    isPilot: true,
    frameId: sha256Hex("frame"),
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    ...over,
  };
}

function filledBlind(verdict: string, canonicalId: string, note: string): string {
  const table = parseCsv(exportBlindCsv([example()]));
  const h = table[0]!;
  table[1]![h.indexOf("verdict")] = verdict;
  table[1]![h.indexOf("canonical_id")] = canonicalId;
  table[1]![h.indexOf("note")] = note;
  return encodeCsv(table);
}

const IMPORT = { reviewer: "r", reviewedAt: "2026-11-18T12:00:00.000Z", catalog } as const;

describe("canonical concept reference", () => {
  it("carries the exact snapshot id and hash with the snapshot's full concept set", () => {
    expect(catalog.snapshotId).toBe(CODE_SEED_SNAPSHOT.snapshotId);
    expect(catalog.snapshotHash).toBe(CODE_SEED_SNAPSHOT.contentHash);
    expect(catalog.manifestVersion).toBe(CODE_SEED_SNAPSHOT.manifestVersion);
    expect(catalog.manifestVersion).toBe(CANONICAL_MANIFEST_VERSION);
    expect(canonicalIdsInCatalog(catalog)).toEqual(new Set(CANONICAL_CONCEPTS.map((c) => c.id)));
  });

  it("includes every id the snapshot resolves via gate 0, even without an alias rule", () => {
    // CODE_SEED_RULES has no cost rule, but the resolver accepts any manifest id by exact identity.
    for (const id of ["cost.unit", "guidance.system", "speed.dive"]) {
      const resolved = CODE_SEED_SNAPSHOT.resolve({ rawKey: id });
      expect(resolved.status, id).toBe("resolved");
      expect(resolved.canonicalId, id).toBe(id);
      expect(isValidCanonicalId(id)).toBe(true);
      expect(canonicalIdsInCatalog(catalog).has(id)).toBe(true);
    }
    const noRule = catalog.concepts.find((c) => c.id === "cost.unit")!;
    expect(noRule.aliases).toEqual([]);
  });

  it("is deterministic: same rules and snapshot give the same export", () => {
    const again = buildConceptCatalog(CODE_SEED_RULES, CODE_SEED_SNAPSHOT);
    expect(again).toEqual(catalog);
    expect(renderConceptCatalog(again)).toBe(renderConceptCatalog(catalog));
    expect(renderConceptCatalogCsv(again)).toBe(renderConceptCatalogCsv(catalog));
  });

  it("groups by family and includes ids, labels, descriptions and aliases", () => {
    const md = renderConceptCatalog(catalog);
    expect(md).toContain(`\`${catalog.snapshotId}\``);
    expect(md).toContain(catalog.snapshotHash);
    expect(md).toContain("## speed");
    expect(md).toContain("`speed.max`");
    const csv = parseCsv(renderConceptCatalogCsv(catalog));
    expect(csv[0]).toEqual(["canonical_id", "label", "family", "description", "aliases"]);
    const max = csv.find((row) => row[0] === "speed.max")!;
    expect(max![1]).toBe("Maximum Speed");
    expect(max![2]).toBe("speed");
    expect(max![3]).toContain("airspeed");
    expect(max![4]).toContain("top_speed");
    expect(csv.some((row) => row[0] === "cost.unit")).toBe(true);
  });

  it("binds the reference to the exact snapshot id and content hash", () => {
    // A snapshot compiled from different rules has a different content hash; the catalog must
    // carry that snapshot's id/hash verbatim, never the code-seed values.
    const otherRules = CODE_SEED_RULES.slice(0, 5);
    const other = compileSemanticSnapshot(otherRules, { snapshotId: "snap-other" });
    const otherCatalog = buildConceptCatalog(otherRules, other);
    expect(otherCatalog.snapshotId).toBe("snap-other");
    expect(otherCatalog.snapshotHash).toBe(other.contentHash);
    expect(otherCatalog.snapshotHash).not.toBe(catalog.snapshotHash);
    // The concept set is the manifest for both; it is the snapshot's rule aliases that differ.
    expect(catalog.concepts.find((c) => c.id === "power.rf")!.aliases.length).toBeGreaterThan(0);
    expect(otherCatalog.concepts.find((c) => c.id === "power.rf")!.aliases).toEqual([]);
  });
});

describe("snapshot-aware canonical id validation", () => {
  it("accepts a valid id that is present in the active snapshot", () => {
    const decisions = importCsv(filledBlind("resolve", "speed.max", "clear"), IMPORT).decisions;
    expect(decisions[0]!.blindCanonicalId).toBe("speed.max");
    expect(() => validateDecision(decisions[0]!, { catalog })).not.toThrow();
  });

  it("rejects an invalid, fabricated id with actionable guidance", () => {
    expect(() => importCsv(filledBlind("resolve", "payload.weight", "oops"), IMPORT)).toThrow(
      /Inspect the valid ids|registry_gap/,
    );
  });

  it("accepts a valid id with no alias rule, but still rejects a fabricated one", () => {
    // cost.unit has no seed rule, yet the frozen resolver accepts it by exact canonical identity.
    const decisions = importCsv(filledBlind("resolve", "cost.unit", "clear"), IMPORT).decisions;
    expect(decisions[0]!.blindCanonicalId).toBe("cost.unit");
    expect(() => validateDecision(decisions[0]!, { catalog })).not.toThrow();
    expect(canonicalIdNotInSnapshotMessage("payload.weight", catalog)).toContain(
      catalog.snapshotId,
    );
  });

  it("accepts the same id when no snapshot catalog is supplied", () => {
    // Backward compatibility: the manifest-level check still works for non-CLI callers.
    const d = importCsv(filledBlind("resolve", "cost.unit", "x"), {
      reviewer: "r",
      reviewedAt: "2026-11-18T12:00:00.000Z",
    }).decisions[0]!;
    expect(() => validateDecision(d)).not.toThrow();
  });
});

describe("registry-gap annotation", () => {
  it("records a meaningful missing concept without a canonical id", () => {
    const decisions = importCsv(
      filledBlind("registry_gap", "", "Meaningful 'kill chain phase' datum; no id in snapshot"),
      IMPORT,
    ).decisions;
    expect(decisions[0]!.blindVerdict).toBe("registry_gap");
    expect(decisions[0]!.blindCanonicalId).toBeUndefined();
    expect(() => validateDecision(decisions[0]!, { catalog })).not.toThrow();
    expect(isUnassessableVerdict("registry_gap")).toBe(true);
  });

  it("requires a note and forbids a canonical id on a gap", () => {
    expect(() => importCsv(filledBlind("registry_gap", "", ""), IMPORT)).toThrow(
      /registry_gap requires a note/,
    );
    expect(() => importCsv(filledBlind("registry_gap", "speed.max", "note"), IMPORT)).toThrow(
      /canonical_id not allowed/,
    );
    const blank: Decision = {
      exampleId: ID,
      blindVerdict: "registry_gap",
      blindNote: "  ",
      finalVerdict: "registry_gap",
      revisedAfterReveal: false,
      reviewer: "r",
      reviewedAt: "2026-11-18T12:00:00.000Z",
      protocolVersion: EVAL_PROTOCOL_VERSION,
      status: "human_reviewed",
    };
    expect(() => validateDecision(blank)).toThrow(/registry_gap requires a note/);
  });

  it("requires a dedicated final_note for a gap first introduced after reveal", () => {
    const table = parseCsv(
      exportRevealCsv({ examples: [example()], predictions: [], suggestions: [] }),
    );
    const h = table[0]!;
    const row = table[1]!;
    row[h.indexOf("verdict")] = "resolve";
    row[h.indexOf("canonical_id")] = "speed.max";
    row[h.indexOf("note")] = "clear speed reading";
    row[h.indexOf("final_verdict")] = "registry_gap";
    row[h.indexOf("revision_reason")] = "after reveal the concept is absent from the registry";
    expect(() => importCsv(encodeCsv(table), { ...IMPORT, step: "reveal" })).toThrow(
      /final_note is required/,
    );

    row[h.indexOf("final_note")] = "Meaningful datum absent from the frozen registry";
    const decisions = importCsv(encodeCsv(table), { ...IMPORT, step: "reveal" }).decisions;
    expect(decisions[0]!.blindVerdict).toBe("resolve");
    expect(decisions[0]!.finalVerdict).toBe("registry_gap");
    expect(decisions[0]!.finalNote).toBe("Meaningful datum absent from the frozen registry");
    expect(() => validateDecision(decisions[0]!, { catalog })).not.toThrow();
    // The annotation survives a reveal round-trip instead of being dropped.
    const roundTripped = importCsv(exportDecisionsCsv(decisions, [example()], "reveal"), {
      ...IMPORT,
      step: "reveal",
    }).decisions;
    expect(roundTripped[0]).toEqual(decisions[0]);
  });

  it("never counts a gap as a resolution and reports it separately", () => {
    const prediction = {
      exampleId: ID,
      snapshotHash: catalog.snapshotHash,
      resolverVersion: "1.1.0",
      result: {
        status: "resolved" as const,
        canonicalId: "speed.max",
        snapshotHash: catalog.snapshotHash,
        snapshotVersion: 1,
        rawKey: "max_speed",
        diagnostics: [],
      },
    };
    const d = importCsv(
      filledBlind("registry_gap", "", "Meaningful datum absent from the registry"),
      IMPORT,
    ).decisions[0]!;
    const result = computeMetrics({
      examples: [example()],
      predictions: [prediction],
      decisions: [d],
      sampledExampleIds: [ID],
      frameId: example().frameId,
      seed: "seed",
      cutoff: "2026-11-01T00:00:00Z",
      snapshotHash: catalog.snapshotHash,
      resolverVersion: "1.1.0",
      manifestHash: sha256Hex("manifest"),
      pilot: true,
      origins: ["historical"],
    });
    // A registry gap is an error against the resolver, never a successful resolution.
    expect(result.precision.resolution.pointEstimate).toBe(0);
    expect(result.diagnostics.registryGaps).toBe(1);
    expect(result.diagnostics.unassessable).toBe(0);
  });
});
