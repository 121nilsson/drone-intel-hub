import { describe, expect, it } from "vitest";
import { CONTROL_WINDOW } from "@/entities/drone/audit";
import type { FormalDesign } from "@/entities/drone/audit-design";
import { summarizeAudit, type AuditRow } from "@/shared/infra/verification/audit.server";

/**
 * The formal evaluation as the audit page reads it: sample units, presentations, and the rule
 * that a unit asked again is still one observation (migrations/026).
 */

const DESIGN_ID = "design-1";
const design: { id: string; design: FormalDesign } = {
  id: DESIGN_ID,
  design: { populations: { en: 4 }, allocation: { en: 4 }, size: 200, seed: 1 },
};

let n = 0;
const row = (over: Partial<AuditRow>): AuditRow => ({
  id: `r${n++}`,
  batch_id: "formal-1",
  position: n,
  role: "audit",
  in_seed: false,
  drone_id: "d",
  drone_name: "Drone",
  spec_label: "Range",
  claim_id: `claim-${n}`,
  language: "en",
  family: "range",
  value: "40 km",
  evidence: "40 km",
  source: "s",
  source_id: "p",
  post_text: null,
  answer: "yes",
  obviously_wrong: false,
  read_via: "original",
  drawn_at: new Date("2026-11-10T00:00:00Z"),
  audit_batch_id: DESIGN_ID,
  sampling_purpose: "formal_eval",
  unit_stratum: "en",
  ...over,
});

const unit = (u: string, over: Partial<AuditRow> = {}) =>
  row({ sample_unit_id: u, claim_id: `claim-${u}`, ...over });

describe("the formal evaluation in the audit status", () => {
  it("is not the gate until a design exists: the old draws only give an interim figure", () => {
    const s = summarizeAudit(
      Array.from({ length: 120 }, () => row({ sampling_purpose: "legacy" })),
    );
    expect(s.formal).toBeUndefined();
    expect(s.decision).toBe("continue");
    expect(s.interim?.decision).toBe("pass");
  });

  it("keeps the interim look away from the formal rows", () => {
    const rows = Array.from({ length: 120 }, (_, i) => unit(`u${i}`));
    const s = summarizeAudit(rows, undefined, design);
    expect(s.interim?.decision).toBe("continue");
  });

  it("stays open until every sampled claim has a valid answer", () => {
    const rows = [unit("u1"), unit("u2"), unit("u3"), unit("u4", { answer: null })];
    const s = summarizeAudit(rows, undefined, design);
    expect(s.decision).toBe("continue");
    expect(s.formal).toMatchObject({ valid: 3, units: 4, retryPending: 0 });
  });

  it("settles a census by its own error share once all four are answered", () => {
    const s = summarizeAudit(
      [unit("u1"), unit("u2"), unit("u3"), unit("u4", { answer: "no" })],
      undefined,
      design,
    );
    expect(s.formal).toMatchObject({ census: true, valid: 4, errors: 1, decision: "fail" });
    expect(s.decision).toBe("fail");
  });

  it("counts a 'cannot tell' as an error in the bound that decides", () => {
    const s = summarizeAudit(
      [unit("u1"), unit("u2"), unit("u3"), unit("u4", { answer: "cannot_tell" })],
      undefined,
      design,
    );
    expect(s.formal).toMatchObject({ errors: 1, cannotTell: 1 });
  });

  it("asks a unit again when a failed control voided its answer, and counts it once", () => {
    const at = (position: number, over: Partial<AuditRow> = {}) =>
      unit("u1", { batch_id: "formal-1", position, ...over });
    const first = [
      at(0),
      row({
        batch_id: "formal-1",
        position: CONTROL_WINDOW,
        role: "control",
        answer: "yes",
        control_kind: "altered",
        sample_unit_id: null,
      }),
      unit("u2", { batch_id: "formal-1", position: 50 }),
      unit("u3", { batch_id: "formal-1", position: 51 }),
      unit("u4", { batch_id: "formal-1", position: 52 }),
    ];
    const waiting = summarizeAudit(first, undefined, design);
    expect(waiting.formal).toMatchObject({ valid: 3, units: 4, retryPending: 1 });
    expect(waiting.decision).toBe("continue");

    // Shown again in a later batch: the same unit, never a fifth observation.
    const retried = [
      ...first,
      unit("u1", {
        batch_id: "formal-retry-1",
        position: 0,
        drawn_at: new Date("2026-11-11T00:00:00Z"),
        answer: null,
      }),
    ];
    const open = summarizeAudit(retried, undefined, design);
    expect(open.formal).toMatchObject({ valid: 3, retryPending: 0 });

    const answered = [
      ...first,
      unit("u1", {
        batch_id: "formal-retry-1",
        position: 0,
        drawn_at: new Date("2026-11-11T00:00:00Z"),
        answer: "yes",
      }),
    ];
    const done = summarizeAudit(answered, undefined, design);
    expect(done.formal).toMatchObject({ valid: 4, units: 4, errors: 0, decision: "pass" });
  });

  it("takes the reader from the draw's frozen snapshot, and keeps a later reading apart", () => {
    const s = summarizeAudit(
      [
        unit("u1", {
          answer: "yes",
          reader: "contradicted",
          reader_after_draw: [
            {
              verdict: "supported",
              evaluated_at: "2026-11-12T00:00:00Z",
              before_human_answer: false,
            },
          ],
        }),
        unit("u2", { answer: "no", reader: "supported" }),
        unit("u3", { answer: "yes", reader: null, reader_legacy: "unsupported" }),
      ],
      undefined,
      design,
    );
    expect(s.reader?.agreement.contradicted).toEqual({ yes: 1, no: 0 });
    expect(s.reader?.agreement.supported).toEqual({ yes: 0, no: 1 });
    expect(s.reader?.measured).toBe(2);
    expect(s.reader?.afterDraw).toMatchObject({ measured: 1, blind: 0 });
    expect(s.reader?.afterDraw?.agreement.supported).toEqual({ yes: 1, no: 0 });
    expect(s.reader?.legacy).toMatchObject({ measured: 1 });
    // The legacy reading never turns up in the at-draw figures.
    expect(s.reader?.agreement.legacyUnsupported).toEqual({ yes: 0, no: 0 });
  });
});
