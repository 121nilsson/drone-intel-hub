import { describe, expect, it } from "vitest";
import {
  ENTAILMENT_VERSION,
  entailmentAgreement,
  entailmentPrompt,
  independentReader,
  needsEntailment,
  readEntailmentReply,
  textHash,
  toEntailment,
} from "@/entities/drone/entailment";
import { readerOpposes, readerStance } from "@/entities/drone/entailment-verdict";
import { verifyDrone } from "@/entities/drone/verification";
import type { Drone, SpecClaim } from "@/entities/drone/types";
import { summarizeAudit, type AuditRow } from "@/shared/infra/verification/audit.server";

const POST = "The Lancet-3 has a range of 40 km.\nIts warhead weighs 3 kg.";

describe("what the second reader is shown", () => {
  it("is the post and the bare claims - never the extractor's quote", () => {
    const { prompt } = entailmentPrompt(POST, [
      { ref: "1", system: "Lancet-3", attribute: "Range", value: "40 km" },
    ]);
    expect(prompt).toContain(POST);
    expect(prompt).toContain('system "Lancet-3", attribute "Range", value "40 km"');
    expect(prompt).not.toMatch(/evidence|quote|confidence/i);
  });
});

describe("the mistakes the audit found are named in the instruction", () => {
  const { system } = entailmentPrompt(POST, []);

  it("a neighbouring quantity is not the attribute", () => {
    expect(system).toMatch(/altitude of a target is not the system's own maximum altitude/);
    expect(system).toMatch(/units struck/);
    expect(system).toMatch(/not\s+a production timeline/);
  });

  it("a vague descriptor is not a value, and a bound is not an exact figure", () => {
    expect(system).toMatch(/vague descriptor \(high-speed, mid-range, long-range/);
    expect(system).toMatch(/"up to\s+500" is not "500"/);
  });

  it("is a new reading round, so the answers given under the old wording are asked again", () => {
    expect(ENTAILMENT_VERSION).toBe("entailment-5");
    const claim = { entailment: { version: "entailment-3", textHash: "h" } } as SpecClaim;
    expect(needsEntailment(claim, "h", "fp")).toBe(true);
  });
});

describe("naming the system", () => {
  it("lists the other names the catalogue knows, so another script is not another system", () => {
    const { prompt } = entailmentPrompt("Герань-2 летит 2000 км.", [
      {
        ref: "1",
        system: "Shahed-136",
        aliases: ["Shahed-136", "Герань-2", "Geran-2"],
        attribute: "Range",
        value: "2000 km",
      },
    ]);
    expect(prompt).toContain('system "Shahed-136" (also called "Герань-2", "Geran-2")');
  });

  it("says when the post was cut", () => {
    expect(entailmentPrompt("x".repeat(20_000), []).truncated).toBe(true);
    expect(entailmentPrompt(POST, []).truncated).toBe(false);
  });
});

describe("reading its reply", () => {
  const read = (answers: unknown[]) => readEntailmentReply({ answers }, ["1"], POST).get("1")!;

  it("keeps a supported answer whose passage is in the post, matched as the verifier matches", () => {
    expect(read([{ ref: "1", verdict: "supported", span: "range of   40 KM" }])).toEqual({
      verdict: "supported",
      span: "range of   40 KM",
    });
  });

  it("downgrades a supported answer whose passage the post does not contain", () => {
    expect(read([{ ref: "1", verdict: "supported", span: "range of 60 km" }])).toMatchObject({
      verdict: "uncertain",
      note: "the passage the reader quoted is not in the post",
    });
  });

  it("downgrades a supported answer with no passage at all", () => {
    expect(read([{ ref: "1", verdict: "supported" }]).verdict).toBe("uncertain");
  });

  it("never lets a careless reply raise a claim", () => {
    expect(read([{ ref: "1", verdict: "Supported!" }]).verdict).toBe("uncertain");
    expect(read([]).verdict).toBe("uncertain");
    expect(readEntailmentReply("not json", ["1"], POST).get("1")?.verdict).toBe("uncertain");
    // An answer for a claim it was not asked about is ignored, not attached somewhere.
    expect(
      readEntailmentReply({ answers: [{ ref: "9", verdict: "supported" }] }, ["1"], POST).has("9"),
    ).toBe(false);
  });

  it("takes an echoed ref the way it was meant", () => {
    // gpt-oss-120b answered "ref 1" when asked about [1]; its answers were all lost.
    expect(read([{ ref: "ref 1", verdict: "supported", span: "range of 40 km" }]).verdict).toBe(
      "supported",
    );
    expect(read([{ ref: "[1]", verdict: "contradicted" }]).verdict).toBe("contradicted");
  });

  it("takes only the first number of a ref, so two refs never run together", () => {
    const r = readEntailmentReply(
      { answers: [{ ref: "1 of 13", verdict: "supported", span: "range of 40 km" }] },
      ["1", "13", "113"],
      POST,
    );
    expect(r.get("1")?.verdict).toBe("supported");
    expect(r.get("113")?.verdict).toBe("uncertain");
  });

  it("does not take 'not_found' on a post the reader saw only part of", () => {
    const r = readEntailmentReply(
      { answers: [{ ref: "1", verdict: "not_found" }] },
      ["1"],
      POST,
      true,
    );
    expect(r.get("1")).toMatchObject({
      verdict: "uncertain",
      note: "the post was longer than the reader was shown",
    });
  });

  it("keeps 'contradicted' on a cut post: what the reader did see already gave another value", () => {
    const r = readEntailmentReply(
      { answers: [{ ref: "1", verdict: "contradicted" }] },
      ["1"],
      POST,
      true,
    );
    expect(r.get("1")?.verdict).toBe("contradicted");
  });

  it("does not take the legacy 'unsupported' from a model: it no longer says which mistake it was", () => {
    expect(read([{ ref: "1", verdict: "unsupported" }])).toMatchObject({
      verdict: "uncertain",
      note: "the reader gave no valid verdict",
    });
  });

  it("records whether the reader is known to differ from the extractor", () => {
    const reader = { provider: "groq", model: "gpt-oss" };
    expect(toEntailment({ verdict: "supported" }, reader, "h", "t").independence).toBe("checked");
    expect(toEntailment({ verdict: "supported" }, reader, "h", "t", false).independence).toBe(
      "unknown",
    );
  });

  it("keeps a contradicted or not_found answer, with its passage only when the post has it", () => {
    expect(read([{ ref: "1", verdict: "contradicted", span: "invented" }])).toEqual({
      verdict: "contradicted",
    });
    expect(read([{ ref: "1", verdict: "not_found", span: "invented" }])).toEqual({
      verdict: "not_found",
    });
  });
});

describe("choosing the reader", () => {
  const options = [
    { provider: "nvidia", model: "nemotron" },
    { provider: "groq", model: "gpt-oss" },
  ];

  it("never picks a model that extracted any claim of the post", () => {
    expect(independentReader(options, new Set(["nemotron"]))).toEqual(options[1]);
    expect(independentReader(options, new Set(["nemotron", "gpt-oss"]))).toBeUndefined();
  });

  it("asks again only when the post or the reader's version changed", () => {
    const hash = textHash(POST);
    const claim = {
      value: 40,
      source: "s",
      date: "2026-11-01",
      entailment: toEntailment(
        { verdict: "supported", span: "40 km" },
        options[0]!,
        hash,
        "t",
        true,
        { claimFingerprint: "fp", readerInputHash: "in", truncated: false },
      ),
    } as SpecClaim;
    expect(needsEntailment(claim, hash, "fp")).toBe(false);
    expect(needsEntailment(claim, textHash(`${POST} Updated.`), "fp")).toBe(true);
    expect(claim.entailment?.version).toBe(ENTAILMENT_VERSION);
  });
});

describe("its verdict survives the deterministic checks", () => {
  it("is kept when verification re-checks the claim", () => {
    const claim: SpecClaim = {
      id: "c1",
      value: "40 km",
      raw: "40 km",
      source: "s",
      sourceId: "p1",
      date: "2026-11-01",
      evidence: "range of 40 km",
      entailment: toEntailment({ verdict: "supported" }, { provider: "p", model: "m" }, "h", "t"),
    };
    const drone = {
      id: "lancet-3",
      name: "Lancet-3",
      aliases: [],
      domain: "Air",
      origin: "RU",
      operators: [],
      propulsion: "Unknown",
      summary: "",
      specs: [{ key: "range", label: "Range", unit: "km", discoveredBy: "ai", claims: [claim] }],
      rf: [],
      components: [],
      evolution: [],
      counterpartIds: [],
      createdAt: "t",
      updatedAt: "t",
    } as unknown as Drone;
    const after = verifyDrone(drone, () => POST, [drone]);
    expect(after.specs[0]!.claims[0]!.verification).toBeDefined();
    expect(after.specs[0]!.claims[0]!.entailment).toEqual(claim.entailment);
  });
});

describe("measuring it against the person", () => {
  it("counts each verdict against the person's answer", () => {
    expect(
      entailmentAgreement([
        { human: "yes", reader: "supported" },
        { human: "no", reader: "supported" },
        { human: "no", reader: "unsupported" },
        { human: "yes", reader: "uncertain" },
      ]),
    ).toEqual({
      supported: { yes: 1, no: 1 },
      unsupported: { yes: 0, no: 1 },
      contradicted: { yes: 0, no: 0 },
      notFound: { yes: 0, no: 0 },
      legacyUnsupported: { yes: 0, no: 1 },
      uncertain: 1,
    });
  });

  it("keeps contradicted, not found and the legacy verdict apart, and sums them as opposed", () => {
    const a = entailmentAgreement([
      { human: "yes", reader: "contradicted" },
      { human: "no", reader: "not_found" },
      { human: "no", reader: "not_found" },
      { human: "yes", reader: "unsupported" },
    ]);
    expect(a.contradicted).toEqual({ yes: 1, no: 0 });
    expect(a.notFound).toEqual({ yes: 0, no: 2 });
    expect(a.legacyUnsupported).toEqual({ yes: 1, no: 0 });
    expect(a.unsupported).toEqual({ yes: 2, no: 2 });
  });

  it("never re-reads the legacy verdict as either of the two it was split into", () => {
    expect(readerStance("unsupported")).toBe("legacy_opposes");
    expect(readerStance("contradicted")).toBe("contradicts");
    expect(readerStance("not_found")).toBe("absent");
    expect(readerOpposes("unsupported")).toBe(true);
    expect(readerOpposes("uncertain")).toBe(false);
  });

  it("asks again when the claim changed under an unchanged post, or was read without a fingerprint", () => {
    const base = toEntailment(
      { verdict: "supported" },
      { provider: "p", model: "m" },
      "h",
      "t",
      true,
      {
        claimFingerprint: "fp-1",
        readerInputHash: "in",
        truncated: false,
      },
    );
    const claim = { entailment: base } as SpecClaim;
    expect(needsEntailment(claim, "h", "fp-1")).toBe(false);
    expect(needsEntailment(claim, "h", "fp-2")).toBe(true);
    const { claimFingerprint: _dropped, ...legacy } = base;
    expect(needsEntailment({ entailment: legacy } as SpecClaim, "h", "fp-1")).toBe(true);
  });

  let n = 0;
  const row = (over: Partial<AuditRow>): AuditRow => ({
    id: `r${n++}`,
    batch_id: "b1",
    position: n,
    role: "audit",
    in_seed: true,
    drone_id: "d",
    drone_name: "D",
    spec_label: "Range",
    claim_id: `c${n}`,
    language: "en",
    family: "range",
    value: "40 km",
    evidence: "40 km",
    source: "s",
    source_id: "p",
    answer: "yes",
    reader: "supported",
    obviously_wrong: false,
    read_via: "original",
    drawn_at: new Date("2026-11-01T00:00:00Z"),
    ...over,
  });

  it("measures it on verified claims and seed negatives, never on controls or excluded batches", () => {
    const s = summarizeAudit([
      row({}),
      row({ role: "negative", answer: "no", reader: "supported" }),
      row({ role: "control", answer: "no", reader: "supported" }),
      row({ batch_id: "b2", answer: "no", reader: "supported" }),
      row({ batch_id: "b2", role: "control", answer: "yes" }),
      row({ answer: "cannot_tell" }),
      row({ reader: null }),
    ]);
    expect(s.reader?.measured).toBe(2);
    expect(s.reader?.independenceUnknown).toBe(0);
    expect(s.reader?.agreement.supported).toEqual({ yes: 1, no: 1 });
  });

  it("says how many measured claims name no extractor", () => {
    const s = summarizeAudit([row({ reader_independence: "unknown" }), row({})]);
    expect(s.reader?.independenceUnknown).toBe(1);
  });

  it("is absent until the reader and the person overlap", () => {
    expect(summarizeAudit([row({ reader: null })]).reader).toBeUndefined();
  });
});
