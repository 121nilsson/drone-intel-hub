import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  recordAutonomyEvent: vi.fn(async (_event: unknown) => {}),
  db: vi.fn(() => {
    throw new Error("the database must not be touched");
  }),
  dbConfigured: vi.fn(() => true),
}));

vi.mock("@/shared/infra/autonomy/ledger.server", () => ({
  recordAutonomyEvent: hoisted.recordAutonomyEvent,
}));
vi.mock("@/shared/infra/postgres/db.server", () => ({
  db: hoisted.db,
  dbConfigured: hoisted.dbConfigured,
}));

import type { AssertionFrame } from "@/entities/drone/assertion-frame";
import { recordAssertionFrameCheck } from "@/shared/infra/autonomy/assertion-frames.server";
import { AUTONOMY_EVENT_KINDS, HEARTBEAT_EVENT_KINDS } from "@/shared/contracts/verification";
import { RELATIONSHIP_FIXTURES } from "@/test/fixtures/relationship-fixtures";

/** The fields of the ledger row this writer fills, as the test reads them back. */
interface LedgerEvent {
  action: string;
  actor: string;
  actorKind: string;
  targetCollection: string;
  targetId: string;
  category?: string | null;
  verdict?: string | null;
  reason?: string | null;
  checks: Array<{ sourceId: string | null; frameId: string; evidence: string; reasons: string[] }>;
  reversible: boolean;
  correlationId?: string | null;
}

/** The ledger row written by the nth call to the mocked recorder. */
function eventAt(i = 0): LedgerEvent {
  return hoisted.recordAutonomyEvent.mock.calls[i]![0] as LedgerEvent;
}

/** Frames from the bars-patriot fixture: both should pass the validator. */
function passingFrames(): AssertionFrame[] {
  const f = RELATIONSHIP_FIXTURES.find((x) => x.id === "bars-patriot")!;
  return f.expectedFrames.map((e, i) => ({
    ...e,
    frameId: `bars-patriot#${i}`,
    sourceHash: "hash-1",
    sourceId: "src-1|ext-1",
    validationStatus: "pass",
  }));
}

/** A frame that attributes a value to the subject while a target system competes for it. */
function failingFrame(): AssertionFrame {
  const participants = [
    {
      participantId: "p1",
      entityType: "system" as const,
      rawName: "Bars",
      role: "subject" as const,
      resolution: "unresolved" as const,
    },
    {
      participantId: "p2",
      entityType: "system" as const,
      rawName: "Patriot",
      role: "target" as const,
      resolution: "unresolved" as const,
    },
  ];
  return {
    frameId: "bad#0",
    sourceId: "src-1|ext-1",
    sourceHash: "hash-1",
    evidence: "Bars intercepts at 50 km against Patriot",
    sentenceIndex: 0,
    predicate: "intercepts",
    participants,
    subjectEntityId: "p1",
    targetEntityId: "p2",
    measurement: { ownerParticipantId: "p1", rawKey: "patriot.range_km", rawValue: 50 },
    validationStatus: "pass",
  };
}

beforeEach(() => {
  hoisted.recordAutonomyEvent.mockClear();
  hoisted.db.mockClear();
});

describe("assertion frame check ledger writer", () => {
  it("writes exactly one event per post, however many frames it has", async () => {
    await recordAssertionFrameCheck({
      sourceId: "src-1|ext-1",
      sourceHash: "hash-1",
      frames: passingFrames(),
    });
    expect(hoisted.recordAutonomyEvent).toHaveBeenCalledTimes(1);
  });

  it("still writes one event for a post with no frames, and calls it uncertain", async () => {
    await recordAssertionFrameCheck({ sourceHash: "hash-2", frames: [] });
    expect(hoisted.recordAutonomyEvent).toHaveBeenCalledTimes(1);
    expect(eventAt().category).toBe("uncertain");
    expect(eventAt().targetId).toBe("hash-2");
  });

  it("carries sourceId, frameId and evidence in checks", async () => {
    await recordAssertionFrameCheck({
      sourceId: "src-1|ext-1",
      sourceHash: "hash-1",
      frames: passingFrames(),
    });
    const { checks } = eventAt();
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({
      sourceId: "src-1|ext-1",
      frameId: "bars-patriot#0",
      evidence: "Ukrainian Bars interceptors countered Russian Shahed strikes",
    });
    expect(checks[1]!.frameId).toBe("bars-patriot#1");
  });

  it("uses the worst frame status as the category and names the first failure", async () => {
    await recordAssertionFrameCheck({
      sourceId: "src-1|ext-1",
      sourceHash: "hash-1",
      frames: [...passingFrames(), failingFrame()],
    });
    const event = eventAt();
    expect(event.category).toBe("fail");
    expect(event.verdict).toBe("2 pass, 0 uncertain, 1 fail");
    expect(event.reason).toContain("catalogue collision");
    expect(event).toMatchObject({
      action: "assertion_frame_check",
      actor: "assertion-frames",
      actorKind: "verifier",
      targetCollection: "dispatches",
      targetId: "src-1|ext-1",
      reversible: false,
    });
  });

  it("falls back to the source hash as the target when there is no source id", async () => {
    await recordAssertionFrameCheck({ sourceHash: "hash-9", frames: passingFrames() });
    expect(eventAt().targetId).toBe("hash-9");
  });

  it("uses a kind that is in the event catalogue and not a heartbeat", () => {
    expect(AUTONOMY_EVENT_KINDS).toContain("assertion_frame_check");
    expect(HEARTBEAT_EVENT_KINDS).not.toContain("assertion_frame_check");
  });

  it("never touches the database, so no claim or repository is read or written", async () => {
    await recordAssertionFrameCheck({
      sourceId: "src-1|ext-1",
      sourceHash: "hash-1",
      frames: [...passingFrames(), failingFrame()],
    });
    expect(hoisted.db).not.toHaveBeenCalled();
  });
});
