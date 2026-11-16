import { describe, expect, it } from "vitest";
import {
  BLIND_COLUMNS,
  REVEAL_ONLY_COLUMNS,
  exportBlindCsv,
  exportDecisionsCsv,
  exportRevealCsv,
  importCsv,
  parseCsv,
  encodeCsv,
} from "@/entities/normalization/semantic-eval/csv";
import {
  EVAL_PROTOCOL_VERSION,
  SEMANTIC_EVAL_SCHEMA_VERSION,
  type Decision,
  type Example,
  type Prediction,
  type Suggestion,
} from "@/entities/normalization/semantic-eval/types";
import {
  ValidationError,
  canonicalJson,
  checkDecisionSet,
  parseJsonl,
  sameDecision,
  toJsonl,
  validateDecision,
  validateExample,
  validatePrediction,
  validateSuggestion,
} from "@/entities/normalization/semantic-eval/validate";
import { sha256Hex } from "@/entities/normalization/sha256";

const ID = sha256Hex("example-1");

function example(over: Partial<Example> = {}): Example {
  const resolverStatus = over.resolverStatus ?? "resolved";
  return {
    exampleId: ID,
    sourceClusterId: sha256Hex("source-cluster"),
    evidenceClusterId: sha256Hex("evidence-cluster"),
    source: { id: "dispatch-1", url: "https://example.test/a" },
    excerpt: "Maximum speed 120 km/h, payload up to 40 kg.",
    language: "en",
    rawKey: "max_speed",
    rawLabel: "Max Speed",
    rawValue: "120",
    rawUnit: "km/h",
    context: { domain: "Air", systemClass: "uav" },
    family: "speed",
    resolverStatus,
    stratum: `en|speed|${resolverStatus}`,
    origin: "historical",
    isPilot: true,
    frameId: sha256Hex("frame"),
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    ...over,
  };
}

function prediction(over: Partial<Prediction["result"]> = {}): Prediction {
  const snapshotHash = sha256Hex("snapshot");
  return {
    exampleId: ID,
    snapshotHash,
    resolverVersion: "1.1.0",
    result: {
      status: over.status ?? "resolved",
      ...(over.canonicalId !== undefined
        ? { canonicalId: over.canonicalId }
        : { canonicalId: "speed.max" }),
      ...(over.candidateCanonicalIds !== undefined
        ? { candidateCanonicalIds: over.candidateCanonicalIds }
        : {}),
      snapshotHash,
      snapshotVersion: 1,
      rawKey: "max_speed",
      diagnostics: [],
    },
  };
}

function suggestion(over: Partial<Suggestion> = {}): Suggestion {
  return {
    exampleId: ID,
    model: "test-model",
    promptHash: sha256Hex("prompt"),
    proposed: { verdict: "resolve", canonicalId: "speed.max" },
    rationale: "The evidence states maximum speed.",
    missingInfo: [],
    status: "suggested",
    ...over,
  };
}

function decision(over: Partial<Decision> = {}): Decision {
  const blindVerdict = over.blindVerdict ?? "resolve";
  const blindCanonicalId =
    "blindCanonicalId" in over
      ? over.blindCanonicalId
      : blindVerdict === "resolve"
        ? "speed.max"
        : undefined;
  const finalVerdict = over.finalVerdict ?? blindVerdict;
  const finalCanonicalId = "finalCanonicalId" in over ? over.finalCanonicalId : blindCanonicalId;
  const revised = blindVerdict !== finalVerdict || blindCanonicalId !== finalCanonicalId;
  return {
    exampleId: ID,
    blindVerdict,
    ...(blindCanonicalId !== undefined ? { blindCanonicalId } : {}),
    blindNote: "clear",
    finalVerdict,
    ...(finalCanonicalId !== undefined ? { finalCanonicalId } : {}),
    revisedAfterReveal: revised,
    ...(revised ? { revisionReason: "resolver showed a guarded term" } : {}),
    reviewer: "maintainer",
    reviewedAt: "2026-11-10T12:00:00.000Z",
    protocolVersion: EVAL_PROTOCOL_VERSION,
    status: "human_reviewed",
    ...over,
  };
}

describe("record validators", () => {
  it("accepts a complete example and rejects drift, over-long excerpts and bad cells", () => {
    expect(validateExample(example())).toEqual(example());
    expect(() => validateExample(example({ stratum: "en|speed|withheld" }))).toThrow(
      /stratum.*resolverStatus/,
    );
    expect(() => validateExample(example({ excerpt: "x".repeat(301) }))).toThrow(/300 chars/);
    expect(() => validateExample(example({ language: "de" as Example["language"] }))).toThrow(
      /one of en, ru, uk, unknown/,
    );
    expect(() => validateExample(example({ schemaVersion: "0.0.1" }))).toThrow(/schemaVersion/);
  });

  it("keeps a prior analyst verdict as context, never as a label", () => {
    const e = example({ priorAnalystReview: { claimId: "claim-7", verdict: "accepted" } });
    expect(validateExample(e).priorAnalystReview).toEqual({
      claimId: "claim-7",
      verdict: "accepted",
    });
    expect("label" in e).toBe(false);
  });

  it("rejects a prediction whose result hash does not match its stamp", () => {
    expect(validatePrediction(prediction()).snapshotHash).toBe(sha256Hex("snapshot"));
    expect(() => validatePrediction({ ...prediction(), snapshotHash: sha256Hex("other") })).toThrow(
      /does not match/,
    );
  });

  it("forbids an AI suggestion from ever being a human review", () => {
    expect(validateSuggestion(suggestion()).status).toBe("suggested");
    expect(() =>
      validateSuggestion(suggestion({ status: "human_reviewed" as Suggestion["status"] })),
    ).toThrow(/only "suggested"/);
    expect(() => validateSuggestion(suggestion({ proposed: { verdict: "resolve" } }))).toThrow(
      /canonical_id/,
    );
    expect(() =>
      validateSuggestion(
        suggestion({ proposed: { verdict: "unknown_term", canonicalId: "speed.max" } }),
      ),
    ).toThrow(/not allowed/);
    expect(() =>
      validateSuggestion(
        suggestion({ proposed: { verdict: "unknown_term", candidates: ["nope"] } }),
      ),
    ).toThrow(/not a canonical concept id/);
  });

  it("rejects invalid verdicts, missing canonical ids and inconsistent revision records", () => {
    expect(validateDecision(decision())).toEqual(decision());
    expect(() =>
      validateDecision(decision({ blindVerdict: "maybe" as Decision["blindVerdict"] })),
    ).toThrow(/invalid verdict|one of/);
    expect(() =>
      validateDecision(decision({ blindVerdict: "resolve", blindCanonicalId: undefined })),
    ).toThrow(/resolve requires/);
    expect(() =>
      validateDecision(
        decision({
          blindVerdict: "resolve",
          finalVerdict: "unknown_term",
          finalCanonicalId: undefined,
          revisionReason: undefined,
          revisedAfterReveal: false,
        }),
      ),
    ).toThrow(/revisedAfterReveal/);
    expect(() =>
      validateDecision(
        decision({
          blindVerdict: "resolve",
          blindCanonicalId: "speed.max",
          finalVerdict: "unknown_term",
          finalCanonicalId: undefined,
          revisedAfterReveal: true,
          revisionReason: "",
        }),
      ),
    ).toThrow(/revisionReason/);
  });

  it("keeps the mixed-version guard generic for a future protocol version", () => {
    const a = decision();
    // No second protocol exists yet; a cast simulates the day one is added. Unknown versions are
    // rejected at import, so this guard is forward-looking rather than reachable from today's CSV.
    const future = "protocol-future" as Decision["protocolVersion"];
    const b = decision({ exampleId: sha256Hex("example-2"), protocolVersion: future });
    expect(() => checkDecisionSet([a, b])).toThrow(/mixed protocol/);
    expect(() => checkDecisionSet([a, b], { allowMixedProtocol: true })).not.toThrow();
    expect(() => checkDecisionSet([a, a])).toThrow(/more than one active decision/);
  });
});

describe("JSONL round-trip", () => {
  it("round-trips decisions losslessly and rejects a bad line with its number", () => {
    const rows = [
      decision(),
      decision({
        exampleId: sha256Hex("example-2"),
        blindVerdict: "withhold_ambiguous",
        blindCanonicalId: undefined,
      }),
    ];
    const text = toJsonl(rows);
    const parsed = parseJsonl(text, validateDecision, "decisions.jsonl");
    expect(parsed.map((d, i) => sameDecision(rows[i]!, d))).toEqual([true, true]);
    expect(canonicalJson(rows[0])).toBe(canonicalJson(parsed[0]));
    expect(() =>
      parseJsonl(
        `${text}${JSON.stringify({ exampleId: "nope" })}\n`,
        validateDecision,
        "decisions.jsonl",
      ),
    ).toThrow(/decisions.jsonl line 3/);
  });
});

describe("review CSV", () => {
  it("blind schema has no resolver or AI column", () => {
    expect(
      BLIND_COLUMNS.some((c) =>
        REVEAL_ONLY_COLUMNS.includes(c as (typeof REVEAL_ONLY_COLUMNS)[number]),
      ),
    ).toBe(false);
    const e = example();
    const csv = exportBlindCsv([e]);
    for (const col of REVEAL_ONLY_COLUMNS) expect(csv).not.toContain(col);
    expect(csv.split("\n")[0]).toBe(BLIND_COLUMNS.join(","));
  });

  it("reveal schema adds resolver/AI columns and a blank final verdict", () => {
    const csv = exportRevealCsv({
      examples: [example()],
      predictions: [prediction()],
      suggestions: [suggestion()],
    });
    for (const col of REVEAL_ONLY_COLUMNS) expect(csv).toContain(col);
    expect(csv).toContain("resolved");
    expect(csv).toContain("speed.max");
    const row = parseCsv(csv);
    expect(row[1]![row[0]!.indexOf("final_verdict")]).toBe("");
  });

  it("refuses a blind CSV that carries AI columns", () => {
    const blind = exportBlindCsv([example()]);
    const polluted = blind.replace(
      BLIND_COLUMNS.join(","),
      [...BLIND_COLUMNS, "ai_verdict"].join(","),
    );
    expect(() =>
      importCsv(polluted, { reviewer: "r", reviewedAt: "2026-11-10T12:00:00.000Z" }),
    ).toThrow(/blind import refuses/);
  });

  it("round-trips decisions losslessly in both schemas", () => {
    const e = example();
    const rows = [
      decision(),
      decision({
        exampleId: sha256Hex("example-2"),
        blindVerdict: "withhold_context",
        blindCanonicalId: undefined,
        finalVerdict: "resolve",
        finalCanonicalId: "range.max",
        revisedAfterReveal: true,
        revisionReason: "resolver found a guard",
      }),
    ];
    const opts = { reviewer: "maintainer", reviewedAt: "2026-11-10T12:00:00.000Z" };
    const examples = [e, example({ exampleId: sha256Hex("example-2") })];
    // The blind schema intentionally cannot encode a post-reveal revision; use unrevised rows there.
    const blindCsv = exportDecisionsCsv([rows[0]!], examples, "blind");
    expect(
      importCsv(blindCsv, { ...opts, step: "blind" }).decisions.map((d, i) =>
        sameDecision([rows[0]!][i]!, d),
      ),
    ).toEqual([true]);
    const revealCsv = exportDecisionsCsv(rows, examples, "reveal");
    const imported = importCsv(revealCsv, { ...opts, step: "reveal" });
    expect(imported.decisions.map((d, i) => sameDecision(rows[i]!, d))).toEqual([true, true]);
  });

  it("rejects incomplete rows and unknown protocol versions", () => {
    const e = example();
    const csv = exportDecisionsCsv([decision()], [e], "blind");
    const noVerdict = csv.replace(/resolve,/, ",");
    expect(() =>
      importCsv(noVerdict, { reviewer: "r", reviewedAt: "2026-11-10T12:00:00.000Z" }),
    ).toThrow(/verdict is required|row 2/);
    // Only protocol-v1 is defined; a row naming any other version is invalid input even when
    // --allow-mixed-protocol is set. The generic guard in checkDecisionSet is future-proofing.
    const second = sha256Hex("example-2");
    const unknown = `${csv.trimEnd()}\n${exportDecisionsCsv(
      [
        decision({
          exampleId: second,
          protocolVersion: "protocol-v0" as Decision["protocolVersion"],
        }),
      ],
      [example({ exampleId: second })],
      "blind",
    )
      .trimEnd()
      .split("\n")
      .slice(1)
      .join("\n")}\n`;
    for (const allowMixedProtocol of [false, true]) {
      expect(() =>
        importCsv(unknown, {
          reviewer: "r",
          reviewedAt: "2026-11-10T12:00:00.000Z",
          allowMixedProtocol,
        }),
      ).toThrow(/invalid protocol_version/);
    }
  });

  it("quotes commas, quotes and embedded newlines", () => {
    const csv = encodeCsv([["a,b", 'say "hi"', "line1\nline2"]]);
    expect(parseCsv(csv)).toEqual([["a,b", 'say "hi"', "line1\nline2"]]);
  });

  it("an unrevised blind decision keeps its verdict after reveal import", () => {
    const csv = exportRevealCsv({
      examples: [example()],
      predictions: [prediction()],
      suggestions: [],
    });
    const filled = parseCsv(csv);
    const row = filled[1]!;
    const header = filled[0]!;
    row[header.indexOf("verdict")] = "resolve";
    row[header.indexOf("canonical_id")] = "speed.max";
    const decisions = importCsv(encodeCsv(filled), {
      reviewer: "r",
      reviewedAt: "2026-11-10T12:00:00.000Z",
    }).decisions;
    expect(decisions[0]!.blindVerdict).toBe("resolve");
    expect(decisions[0]!.finalVerdict).toBe("resolve");
    expect(decisions[0]!.revisedAfterReveal).toBe(false);
  });
});

describe("validation errors are actionable", () => {
  it("names the record and the field", () => {
    try {
      validateExample(example({ rawKey: "" }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as Error).message).toMatch(/Example\.rawKey/);
    }
  });
});
