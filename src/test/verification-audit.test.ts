import { describe, expect, it } from "vitest";
import {
  CONTROL_WINDOW,
  alteredReading,
  auditDecision,
  controlMix,
  controlPositions,
  drawAuditSample,
  errorRateUpperBound,
  insertControls,
  readerDisagrees,
  textLanguage,
  type AuditCandidate,
} from "@/entities/drone/audit";
import { summarizeAudit, type AuditRow } from "@/shared/infra/verification/audit.server";
import { runCatalogueVerification } from "@/shared/infra/verification/run";
import type { Drone } from "@/entities/drone/types";
import type { VerificationRunRecord } from "@/shared/contracts/verification";

describe("an altered control", () => {
  it("scales every figure by one factor the post does not contain", () => {
    expect(alteredReading("40 km", [40])).toBe("120 km");
    expect(alteredReading("10–20 km", [10, 20])).toBe("30–60 km");
    // 120 is in the post, so ×3 would make the altered figure true; ×4 is used instead.
    expect(alteredReading("40 km", [40, 120])).toBe("160 km");
  });

  it("keeps the grouping it was written with", () => {
    expect(alteredReading("2,000 km", [2000])).toBe("6,000 km");
  });

  it("drops the catalogue's conversion, which would give the control away", () => {
    expect(alteredReading("40 kn (≈ 74.08 km/h)", [40])).toBe("120 kn");
  });

  it("is not made from a value with no figure, or a zero", () => {
    expect(alteredReading("solid rocket motor", [])).toBeUndefined();
    expect(alteredReading("0 m", [])).toBeUndefined();
  });
});

describe("the audit's stopping rule", () => {
  // The table in get_human_out_of_the_loop_plan.md §9 is this function's output; if one changes,
  // the other must.
  it("decides exactly as the plan's table says", () => {
    const at = (n: number) => Array.from({ length: 19 }, (_, k) => auditDecision(n, k)[0]).join("");
    expect(at(100)).toBe("ppccccccccfffffffff");
    expect(at(150)).toBe("pppccccccccccffffff");
    expect(at(200)).toBe("pppppnnnnnnnnnnnfff");
  });

  it("never decides before the first draw is answered, however it looks", () => {
    expect(auditDecision(50, 0)).toBe("continue");
    expect(auditDecision(20, 10)).toBe("continue");
  });

  it("bounds the error rate from above, not at the observed rate", () => {
    expect(errorRateUpperBound(100, 0)).toBeCloseTo(0.0295, 3);
    expect(errorRateUpperBound(50, 0)).toBeGreaterThan(0.05);
    expect(errorRateUpperBound(200, 4)).toBeLessThan(0.05);
    expect(errorRateUpperBound(200, 5)).toBeGreaterThan(0.05);
  });
});

describe("drawing the sample", () => {
  const pool: AuditCandidate[] = [
    ...Array.from({ length: 30 }, (_, i) => ({
      claimId: `en-r${i}`,
      language: "en" as const,
      family: "range",
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      claimId: `en-s${i}`,
      language: "en" as const,
      family: "speed",
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      claimId: `uk-r${i}`,
      language: "uk" as const,
      family: "range",
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      claimId: `ru-r${i}`,
      language: "ru" as const,
      family: "range",
    })),
  ];

  it("repeats exactly from its recorded seed", () => {
    expect(drawAuditSample(pool, 20, 42)).toEqual(drawAuditSample(pool, 20, 42));
    expect(drawAuditSample(pool, 20, 42)).not.toEqual(drawAuditSample(pool, 20, 43));
  });

  it("works through English first, then Ukrainian, then Russian", () => {
    const drawn = drawAuditSample(pool, 45, 1);
    expect(drawn.slice(0, 35).every((c) => c.language === "en")).toBe(true);
    expect(drawn.slice(35).every((c) => c.language === "uk")).toBe(true);
  });

  it("takes families in turn, so the commonest does not fill the batch", () => {
    const drawn = drawAuditSample(pool, 10, 7);
    expect(drawn.filter((c) => c.family === "speed")).toHaveLength(5);
  });

  it("never draws a claim already audited", () => {
    const done = new Set(pool.filter((c) => c.language === "en").map((c) => c.claimId));
    expect(drawAuditSample(pool, 5, 3, done).every((c) => c.language === "uk")).toBe(true);
  });

  it("places controls at distinct seeded positions", () => {
    const p = controlPositions(100, 4, 9);
    expect(new Set(p).size).toBe(4);
    expect(p.every((x) => x >= 0 && x <= 100)).toBe(true);
    expect(controlPositions(100, 4, 9)).toEqual(p);
  });
});

describe("the language of a post", () => {
  it("tells Ukrainian from Russian by the letters only one of them uses", () => {
    expect(textLanguage("Дальність польоту становить 40 км, швидкість — 120 км/год")).toBe("uk");
    expect(textLanguage("Дальность полёта составляет 40 км, скорость 120 км/ч, это рекорд")).toBe(
      "ru",
    );
    expect(textLanguage("The drone has a range of 40 km")).toBe("en");
  });
});

describe("what the answers prove", () => {
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
    post_text: "40 km",
    answer: "yes",
    obviously_wrong: false,
    read_via: "original",
    drawn_at: new Date("2026-11-01T00:00:00Z"),
    ...over,
  });

  it("counts a 'can't tell' as neither an error nor a pass", () => {
    const s = summarizeAudit(
      [row({ answer: "yes" }), row({ answer: "no" }), row({ answer: "cannot_tell" })],
      0,
    );
    expect(s.overall).toMatchObject({ answered: 2, errors: 1, cannotTell: 1 });
  });

  it("drops the answers around a hidden control answered yes, not the rest of its batch", () => {
    const at = (position: number, over: Partial<AuditRow> = {}) =>
      row({ batch_id: "b1", position, ...over });
    const s = summarizeAudit(
      [
        at(0),
        at(10, { role: "control", answer: "yes", control_kind: "altered" }),
        at(10 + CONTROL_WINDOW),
        at(11 + CONTROL_WINDOW, { answer: "no" }),
        row({ batch_id: "b2", position: 10, answer: "no" }),
      ],
      0,
    );
    expect(s.failedControls.map((c) => c.kind)).toEqual(["altered"]);
    expect(s.voidedAnswers).toBe(2);
    // Outside the window in b1, and the other batch entirely.
    expect(s.overall).toMatchObject({ answered: 2, errors: 2 });
  });

  it("counts the answers again once a first-session control is disputed", () => {
    const rows = [
      row({ position: 1 }),
      row({ position: 2, role: "control", answer: "yes", control_kind: "misread" }),
    ];
    expect(summarizeAudit(rows, 0).overall.answered).toBe(0);
    rows[1]!.control_disputed_at = new Date();
    const s = summarizeAudit(rows, 0);
    expect(s.overall.answered).toBe(1);
    expect(s.voidedAnswers).toBe(0);
    expect(s.failedControls[0]).toMatchObject({ kind: "misread", disputed: true });
  });

  it("never lets an altered control be disputed away", () => {
    const rows = [
      row({ position: 1 }),
      row({
        position: 2,
        role: "control",
        answer: "yes",
        control_kind: "altered",
        control_disputed_at: new Date(),
      }),
    ];
    expect(summarizeAudit(rows, 0).overall.answered).toBe(0);
  });

  it("never scores a control or a seed negative as an audited verified claim", () => {
    const s = summarizeAudit(
      [row({ role: "negative", answer: "no" }), row({ role: "control", answer: "no" })],
      0,
    );
    expect(s.overall.answered).toBe(0);
    expect(s.seed.size).toBe(2);
  });

  it("flags a family with two errors in its first twenty", () => {
    const rows = [
      row({ family: "speed", answer: "no" }),
      row({ family: "speed", answer: "no" }),
      ...Array.from({ length: 5 }, () => row({ family: "range" })),
    ];
    const s = summarizeAudit(rows, 0);
    expect(s.byFamily.find((f) => f.family === "speed")?.alarm).toBe(true);
    expect(s.byFamily.find((f) => f.family === "range")?.alarm).toBe(false);
  });

  it("offers the next claim in draw order, and counts the rest", () => {
    const s = summarizeAudit(
      [row({ position: 2, answer: null }), row({ position: 1, answer: null }), row({})],
      3,
    );
    expect(s.next?.position).toBe(1);
    expect(s.openCount).toBe(2);
    expect(s.undrawn).toBe(3);
  });

  it("decides only at a batch boundary, however many answers are in", () => {
    // 3 errors in the first 100 do not pass; at 140 answers with no further error the bound has
    // dropped under 5%, but 140 is not a boundary, so the audit stays open until 150.
    const answers = (n: number, errorsAt: number[]) =>
      Array.from({ length: n }, (_, i) => row({ answer: errorsAt.includes(i) ? "no" : "yes" }));
    // The old look at non-probability draws survives as information only: it is never the gate.
    expect(summarizeAudit(answers(140, [0, 1, 2])).interim?.decision).toBe("continue");
    expect(summarizeAudit(answers(150, [0, 1, 2])).interim?.decision).toBe("continue");
    const passed = summarizeAudit(answers(100, [0]));
    expect(passed.interim?.decision).toBe("pass");
    expect(passed.interim?.decidedAt).toBe(100);
    expect(passed.decision).toBe("continue");
  });
});

describe("a verification run on the server", () => {
  it("writes its ledger row through the writer it is given, not the browser's server function", async () => {
    const recorded: VerificationRunRecord[] = [];
    const drones = { list: () => [] as Drone[], upsert: () => {} };
    await runCatalogueVerification({ drones, dispatches: { list: () => [] } }, async (r) => {
      recorded.push(r);
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ checked: 0, before: { verified: 0 } });
  });
});

describe("the controls of a batch", () => {
  it("carries a misread control in every batch of a normal size, so the variant habit is measured", () => {
    expect(controlMix(50)).toEqual({ altered: 2, misread: 1 });
    expect(controlMix(25)).toEqual({ altered: 1, misread: 1 });
    expect(controlMix(100)).toEqual({ altered: 4, misread: 1 });
  });

  it("keeps a tiny batch to one altered control and no misread one", () => {
    expect(controlMix(10)).toEqual({ altered: 1, misread: 0 });
  });

  it("places controls among the claims without reordering the claims", () => {
    const items = Array.from({ length: 20 }, (_, i) => `claim-${i}`);
    const out = insertControls(items, ["control-a", "control-b"], 7);
    expect(out).toHaveLength(22);
    expect(out.filter((x) => x.startsWith("claim-"))).toEqual(items);
    expect(out.filter((x) => x.startsWith("control-")).sort()).toEqual(["control-a", "control-b"]);
    // The same seed puts them in the same places.
    expect(insertControls(items, ["control-a", "control-b"], 7)).toEqual(out);
  });
});

describe("where the reader contradicts the person", () => {
  it("is a yes against unsupported, or a no against supported", () => {
    expect(readerDisagrees("yes", "unsupported")).toBe(true);
    expect(readerDisagrees("no", "supported")).toBe(true);
  });

  it("is not agreement, an uncertain reader, no reading, or a can't-tell", () => {
    expect(readerDisagrees("yes", "supported")).toBe(false);
    expect(readerDisagrees("no", "unsupported")).toBe(false);
    expect(readerDisagrees("yes", "uncertain")).toBe(false);
    expect(readerDisagrees("no", null)).toBe(false);
    expect(readerDisagrees("cannot_tell", "supported")).toBe(false);
    expect(readerDisagrees(null, "unsupported")).toBe(false);
  });
});
