import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROBATION_AFTER_DAYS,
  probationDue,
  type ProbationDecision,
} from "@/shared/infra/evaluation/autonomy";
import { recordAutonomyEvent } from "@/shared/infra/autonomy/ledger.server";
import { startProbation } from "@/shared/infra/evaluation/rule-sandbox-probation.server";

// Keep the database out of it: the switch-off path must return before any query.
vi.mock("@/shared/infra/postgres/db.server", () => ({
  dbConfigured: () => true,
  db: () => {
    throw new Error("database touched while probation is switched off");
  },
}));
vi.mock("@/shared/infra/autonomy/ledger.server", () => ({
  recordAutonomyEvent: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const DAY = 86_400_000;
const now = new Date("2026-11-11T12:00:00Z");
const quarantinedDaysAgo = (
  days: number,
  actor: ProbationDecision["actor"] = "circuit_breaker",
) => [
  {
    decision: "quarantined" as const,
    actor,
    decidedAt: new Date(now.getTime() - days * DAY).toISOString(),
  },
];
const generated = { kind: "add_cue", origin: "autonomous_sandbox", status: "quarantined" };

describe("rule probation eligibility", () => {
  it("returns a generated rule to shadow once it has been quarantined for seven days", () => {
    expect(probationDue(generated, quarantinedDaysAgo(PROBATION_AFTER_DAYS), now)).toBe(true);
  });

  it("keeps a rule quarantined for six days in quarantine", () => {
    expect(probationDue(generated, quarantinedDaysAgo(6), now)).toBe(false);
  });

  it("never puts an alias or a stopword on probation, however long it has waited", () => {
    for (const kind of ["add_alias", "add_stopword"]) {
      expect(probationDue({ ...generated, kind }, quarantinedDaysAgo(30), now)).toBe(false);
    }
  });

  it("allows the medium and low risk kinds", () => {
    for (const kind of ["add_cue", "context_filter", "add_unit_scale"]) {
      expect(probationDue({ ...generated, kind }, quarantinedDaysAgo(30), now)).toBe(true);
    }
  });

  it("does not give a second chance to a rule quarantined a second time", () => {
    const twice = [
      ...quarantinedDaysAgo(30),
      {
        decision: "shadowed" as const,
        actor: "autonomous" as const,
        decidedAt: "2026-10-20T00:00:00Z",
      },
      ...quarantinedDaysAgo(10),
    ];
    expect(probationDue(generated, twice, now)).toBe(false);
  });

  it("does not put back a rule an analyst quarantined", () => {
    expect(probationDue(generated, quarantinedDaysAgo(30, "analyst"), now)).toBe(false);
  });

  it("does not touch a rule that was not generated", () => {
    for (const origin of ["analyst", "bootstrap"]) {
      expect(probationDue({ ...generated, origin }, quarantinedDaysAgo(30), now)).toBe(false);
    }
  });

  it("does not touch a rule whose status is not quarantined", () => {
    for (const status of ["shadow", "active", "rejected", "candidate_passed"]) {
      expect(probationDue({ ...generated, status }, quarantinedDaysAgo(30), now)).toBe(false);
    }
  });

  it("does nothing with no quarantine on record", () => {
    expect(probationDue(generated, [], now)).toBe(false);
  });
});

describe("rule probation switch", () => {
  it("does nothing and writes no ledger event when switched off", async () => {
    vi.stubEnv("RULE_PROBATION", "off");
    expect(await startProbation()).toEqual([]);
    expect(recordAutonomyEvent).not.toHaveBeenCalled();
  });
});
