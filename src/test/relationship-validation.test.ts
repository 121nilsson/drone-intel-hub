import { describe, expect, it } from "vitest";
import type {
  AssertionEntity,
  AssertionFrame,
  EntityRole,
  EntityType,
} from "@/entities/drone/assertion-frame";
import { validateFrame, validateFrames } from "@/entities/drone/assertion-validation";
import {
  RELATIONSHIP_FIXTURES,
  type RelationshipFixture,
} from "@/test/fixtures/relationship-fixtures";

const PHASES = ["phase4", "phase5", "phase6"];
const ROLES: ReadonlySet<EntityRole> = new Set<EntityRole>([
  "subject",
  "target",
  "carrier",
  "subsystem",
  "actor",
  "programme_context",
  "location",
  "referenced",
  "launcher",
  "payload",
]);
const TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  "system",
  "organization",
  "programme",
  "location",
  "component",
  "unknown",
]);

const real = RELATIONSHIP_FIXTURES.filter((f) => f.status !== "pending_source");
const placeholders = RELATIONSHIP_FIXTURES.filter((f) => f.status === "pending_source");

/** A frame from a fixture's expectation, with the run-time fields filled in for the validator. */
function frameFrom(f: RelationshipFixture, index: number): AssertionFrame {
  const expected = f.expectedFrames[index]!;
  return {
    ...expected,
    frameId: `${f.id}#${index}`,
    sourceHash: "fixture",
    validationStatus: "pass",
  };
}

/** A minimal frame for the handcrafted bad cases; the fields the case does not touch are fixed. */
function handFrame(
  participants: AssertionEntity[],
  rest: Partial<AssertionFrame> & Pick<AssertionFrame, "subjectEntityId">,
): AssertionFrame {
  return {
    frameId: "hand#0",
    sourceHash: "hand",
    evidence: "hand-written evidence",
    sentenceIndex: 0,
    predicate: "hand_predicate",
    participants,
    validationStatus: "pass",
    ...rest,
  };
}

const entity = (
  participantId: string,
  role: EntityRole,
  entityType: EntityType,
  rawName = participantId,
): AssertionEntity => ({
  participantId,
  entityType,
  rawName,
  role,
  resolution: "unresolved",
});

describe("relationship fixtures: schema and references", () => {
  it("holds fifteen slots with unique ids: four with a source text, eleven pending one", () => {
    const ids = RELATIONSHIP_FIXTURES.map((f) => f.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids).size).toBe(15);
  });

  it.each(RELATIONSHIP_FIXTURES.map((f) => [f.id, f] as const))(
    "%s satisfies the schema",
    (_id, f) => {
      expect(f.id).toMatch(/^[a-z0-9-]+$/);
      expect(f.title.trim()).not.toBe("");
      expect(PHASES).toContain(f.activeFrom);

      const participantIds = f.participants.map((p) => p.participantId);
      expect(new Set(participantIds).size).toBe(participantIds.length);
      for (const p of f.participants) {
        expect(ROLES.has(p.role)).toBe(true);
        expect(TYPES.has(p.entityType)).toBe(true);
      }
    },
  );

  it.each(RELATIONSHIP_FIXTURES.map((f) => [f.id, f] as const))(
    "%s resolves every participant reference",
    (_id, f) => {
      const ids = new Set(f.participants.map((p) => p.participantId));
      for (const frame of f.expectedFrames) {
        expect(ids.has(frame.subjectEntityId)).toBe(true);
        if (frame.targetEntityId !== undefined) expect(ids.has(frame.targetEntityId)).toBe(true);
        if (frame.contextEntityId !== undefined) expect(ids.has(frame.contextEntityId)).toBe(true);
        if (frame.measurement) expect(ids.has(frame.measurement.ownerParticipantId)).toBe(true);
      }
      for (const claim of f.expectedClaims) {
        if (claim.ownerParticipantId !== undefined) {
          expect(ids.has(claim.ownerParticipantId)).toBe(true);
        }
      }
    },
  );
});

describe("relationship fixtures: specified cases", () => {
  it.each(real.map((f) => [f.id, f] as const))("%s lists what must not be produced", (_id, f) => {
    expect(f.mustNotProduce.length).toBeGreaterThan(0);
  });

  it.each(real.map((f) => [f.id, f] as const))(
    "%s quotes its frame evidence verbatim from the source",
    (_id, f) => {
      for (const frame of f.expectedFrames) {
        expect(f.sourceText).toContain(frame.evidence);
      }
    },
  );

  it("the pending slots are exactly rca-05 to rca-15: not verified, and covering no failure class yet", () => {
    expect(placeholders.map((f) => f.id)).toEqual([
      "rca-05",
      "rca-06",
      "rca-07",
      "rca-08",
      "rca-09",
      "rca-10",
      "rca-11",
      "rca-12",
      "rca-13",
      "rca-14",
      "rca-15",
    ]);
    // Only the four fixtures with a real source text count as coverage; a pending slot is not a
    // passing regression, and this count keeps anyone from letting fifteen read as fifteen covered.
    expect(real).toHaveLength(4);
    expect(placeholders).toHaveLength(11);
    for (const f of placeholders) {
      expect(f.sourceText).toBe("");
      expect(f.expectedFrames).toHaveLength(0);
      expect(f.expectedClaims).toHaveLength(0);
    }
  });
});

describe("assertion validation on fixture frames", () => {
  it("passes the bars-patriot frames", () => {
    const f = RELATIONSHIP_FIXTURES.find((x) => x.id === "bars-patriot")!;
    for (let i = 0; i < f.expectedFrames.length; i++) {
      expect(validateFrame(frameFrom(f, i))).toEqual({ status: "pass", reasons: [] });
    }
  });

  it("passes the locust-coyote frame", () => {
    const f = RELATIONSHIP_FIXTURES.find((x) => x.id === "locust-coyote")!;
    expect(validateFrame(frameFrom(f, 0))).toEqual({ status: "pass", reasons: [] });
  });

  it("returns new objects with the status filled in, and leaves the input untouched", () => {
    const f = RELATIONSHIP_FIXTURES.find((x) => x.id === "bars-patriot")!;
    const input = [frameFrom(f, 0), frameFrom(f, 1)];
    const out = validateFrames(input);
    expect(out.every((x) => x.validationStatus === "pass")).toBe(true);
    expect(out[0]).not.toBe(input[0]);
    expect(input.every((x) => x.reasons === undefined)).toBe(true);
  });
});

describe("assertion validation rejects bad frames", () => {
  it("does not fault a subject-owned figure just because another system is a target in the frame", () => {
    const participants = [
      { ...entity("p1", "subject", "system", "Bars"), resolvedId: "drone-bars" },
      { ...entity("p2", "target", "system", "Shahed"), resolvedId: "drone-shahed-136" },
    ];
    const v = validateFrame(
      handFrame(participants, {
        subjectEntityId: "p1",
        targetEntityId: "p2",
        measurement: { ownerParticipantId: "p1", rawKey: "range_km", rawValue: 50 },
      }),
    );
    expect(v).toEqual({ status: "pass", reasons: [] });
  });

  it("fails a Patriot value attributed to Bars as subject", () => {
    const participants = [
      { ...entity("p1", "subject", "system", "Bars"), resolvedId: "drone-bars" },
      { ...entity("p2", "target", "system", "Patriot"), resolvedId: "system-patriot" },
    ];
    const v = validateFrame(
      handFrame(participants, {
        subjectEntityId: "p1",
        targetEntityId: "p2",
        measurement: { ownerParticipantId: "p1", rawKey: "patriot.range_km", rawValue: 50 },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.reasons.join(" ")).toContain("catalogue collision");
  });

  it("fails a programme context used as the subject", () => {
    const participants = [
      entity("p1", "programme_context", "programme", "LOCUST"),
      entity("p2", "target", "system", "Coyote"),
    ];
    const v = validateFrame(
      handFrame(participants, { subjectEntityId: "p1", targetEntityId: "p2" }),
    );
    expect(v.status).toBe("fail");
    expect(v.reasons.join(" ")).toContain("programme");
  });

  it("fails a measurement whose owner is not a participant", () => {
    const participants = [entity("p1", "subject", "system", "Coyote")];
    const v = validateFrame(
      handFrame(participants, {
        subjectEntityId: "p1",
        measurement: { ownerParticipantId: "p9", rawKey: "x", rawValue: 1 },
      }),
    );
    expect(v.status).toBe("fail");
    expect(v.reasons.join(" ")).toContain("does not reference a participant");
  });

  it("fails a context participant that is a system", () => {
    const participants = [
      entity("p1", "subject", "system", "Coyote"),
      entity("p2", "programme_context", "system", "Bars"),
    ];
    const v = validateFrame(
      handFrame(participants, { subjectEntityId: "p1", contextEntityId: "p2" }),
    );
    expect(v.status).toBe("fail");
    expect(v.reasons.join(" ")).toContain("is a system");
  });

  it("lets a component that is itself the subject own its own figure", () => {
    const participants = [entity("p1", "launcher", "component", "40-tube launcher")];
    const v = validateFrame(
      handFrame(participants, {
        subjectEntityId: "p1",
        measurement: { ownerParticipantId: "p1", rawKey: "launcher.tube_count", rawValue: 40 },
      }),
    );
    expect(v.status).toBe("pass");
  });

  it("does not take one catalogue entry named twice for another owner", () => {
    const participants = [
      { ...entity("p1", "subject", "system", "Shahed-136"), resolvedId: "drone-shahed-136" },
      { ...entity("p2", "referenced", "system", "Shahed"), resolvedId: "drone-shahed-136" },
    ];
    const v = validateFrame(
      handFrame(participants, {
        subjectEntityId: "p1",
        measurement: { ownerParticipantId: "p1", rawKey: "shahed_136.range_km", rawValue: 50 },
      }),
    );
    expect(v.status).toBe("pass");
  });

  it("is uncertain, not pass, when the subject matches more than one catalogue entry", () => {
    const participants = [
      { ...entity("p1", "subject", "system", "Shahed"), resolution: "ambiguous" as const },
    ];
    const v = validateFrame(handFrame(participants, { subjectEntityId: "p1" }));
    expect(v.status).toBe("uncertain");
  });
});

describe("assertion validation: phase activations still to come", () => {
  it.todo("phase5: 4g stays a load factor and 500 g converts to 0.5 kg (load-factor-vs-mass)");
  it.todo("phase5: 50 units/month and 300 deployed stay separate claims (production-vs-inventory)");
  it.todo("phase5: lbs to kg keeps the source unit (rca-05)");
  it.todo(
    "phase6: interval, zero median, syndicated duplicate, bounds and qualifiers (rca-06 to rca-10)",
  );
});
