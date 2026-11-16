import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySnapshot, setActiveRuleSnapshot } from "@/shared/contracts/rules";
import { recordAutonomyEvent } from "@/shared/infra/autonomy/ledger.server";
import { setServerServices } from "@/shared/infra/server-services.server";
import { resetRuleRegistry } from "@/shared/infra/heuristics/rule-registry.server";
import { getOrRefreshRuleSnapshot } from "@/shared/infra/heuristics/rule-registry.server";
import { activateRule } from "@/shared/infra/evaluation/rule-sandbox-activation.server";
import { getAutonomyStatus } from "@/shared/infra/evaluation/rule-sandbox-autonomy.server";
import {
  quarantine,
  rejectRule,
  shadowRule,
} from "@/shared/infra/evaluation/rule-sandbox-lifecycle.server";
import { listRules } from "@/shared/infra/evaluation/rule-sandbox-list.server";
import { proposeRule } from "@/shared/infra/evaluation/rule-sandbox-propose.server";
import { startProbation } from "@/shared/infra/evaluation/rule-sandbox-probation.server";
import { sandboxRule } from "@/shared/infra/evaluation/rule-sandbox-sandbox.server";
import { fakeRulesRepo, fakeServices } from "./fake-rules-repo";

// The ledger is another port; here it only has to be observable.
vi.mock("@/shared/infra/autonomy/ledger.server", () => ({
  recordAutonomyEvent: vi.fn(),
}));

const DAY = 86_400_000;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("RULE_PROBATION", "on");
  // A quarantine replays its posts; the replay has its own tests.
  vi.stubEnv("RULE_REPLAY", "off");
  resetRuleRegistry();
});

afterEach(() => {
  setServerServices(null);
  setActiveRuleSnapshot(emptySnapshot());
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const use = (answers: Parameters<typeof fakeRulesRepo>[0] = {}) => {
  const fake = fakeRulesRepo(answers);
  setServerServices(fakeServices(fake.repo));
  return fake;
};

describe("rule lifecycle over the RulesRepo port", () => {
  it("sends a passed rule to shadow and records the decision only when it moved", async () => {
    const moved = use({ startShadow: true });
    expect(await shadowRule("r1")).toEqual({ ok: true });
    expect(moved.names()).toEqual(["startShadow", "recordDecision"]);
    expect(moved.callsOf("recordDecision")[0]!.args).toEqual(["r1", "shadowed", "analyst", null]);

    const unmoved = use({ startShadow: false });
    expect(await shadowRule("r1")).toEqual({ ok: false });
    expect(unmoved.names()).toEqual(["startShadow"]);
  });

  it("rejects a candidate without a version bump", async () => {
    const fake = use({ rejectOrQuarantine: "rejected" });
    expect(await rejectRule("r1")).toEqual({ ok: true });
    expect(fake.names()).toEqual(["rejectOrQuarantine", "recordDecision"]);
    expect(fake.callsOf("recordDecision")[0]!.args.slice(0, 3)).toEqual([
      "r1",
      "rejected",
      "analyst",
    ]);
  });

  it("quarantines an active rule: decision, then a version bump", async () => {
    const fake = use({ rejectOrQuarantine: "quarantined" });
    expect(await rejectRule("r1")).toEqual({ ok: true });
    expect(fake.names().slice(0, 3)).toEqual([
      "rejectOrQuarantine",
      "recordDecision",
      "appendVersion",
    ]);
    expect(fake.callsOf("appendVersion")[0]!.args).toEqual(["quarantine r1"]);
  });

  it("changes nothing when the rule is no longer open", async () => {
    const fake = use({ rejectOrQuarantine: null });
    expect(await rejectRule("r1")).toEqual({ ok: false });
    expect(fake.names()).toEqual(["rejectOrQuarantine"]);
  });

  it("the circuit breaker quarantines only rules that were still active, then bumps once", async () => {
    const fake = use({ quarantineActive: (id: string) => id !== "b" });
    await quarantine(["a", "b", "c"], "f1 drop");
    const decisions = fake.callsOf("recordDecision").map((c) => c.args);
    expect(decisions).toEqual([
      ["a", "quarantined", "circuit_breaker", "f1 drop"],
      ["c", "quarantined", "circuit_breaker", "f1 drop"],
    ]);
    expect(fake.callsOf("appendVersion")).toHaveLength(1);
    expect(fake.callsOf("appendVersion")[0]!.args).toEqual(["circuit breaker: a, b, c"]);
  });

  it("does not bump the version when the breaker is given no rules", async () => {
    const fake = use();
    await quarantine([], "none");
    expect(fake.names()).toEqual([]);
  });
});

describe("activation lock over the port", () => {
  it("runs the activation inside the repository's lock", async () => {
    const fake = use({ findRule: null });
    const res = await activateRule("r1");
    expect(res).toEqual({ ok: false, reason: "rule not found" });
    expect(fake.names()[0]).toBe("withActivationLock");
    expect(fake.names()).toContain("findRule");
  });

  it("returns the lock's refusal without touching the rule", async () => {
    const fake = use({
      withActivationLock: { ok: false, reason: "another activation is still running - try again" },
    });
    expect(await activateRule("r1")).toEqual({
      ok: false,
      reason: "another activation is still running - try again",
    });
    expect(fake.names()).toEqual(["withActivationLock"]);
  });
});

describe("sandbox verdicts over the port", () => {
  it("records the evaluation and rejects a candidate rule that changes nothing", async () => {
    const fake = use({
      findRule: {
        id: "r1",
        kind: "add_stopword",
        language: "all",
        payload: { word: "zzyzx" },
        status: "candidate",
        origin: "analyst",
      },
      rulesVersion: 4,
      settleCandidate: true,
    });
    const res = await sandboxRule("r1", "fast", { drones: [], control: [], fixtures: [] });
    expect(res.ok).toBe(true);
    expect(res.result?.passed).toBe(false);
    const [evaluation] = fake.callsOf("recordEvaluation").map((c) => c.args[0]);
    expect(evaluation).toMatchObject({
      ruleId: "r1",
      passed: false,
      corpusSize: 0,
      brokenFixtures: [],
      mode: "fast",
      rulesVersion: 4,
    });
    expect(fake.callsOf("settleCandidate")[0]!.args).toEqual(["r1", "rejected", null]);
    expect(fake.callsOf("recordDecision")[0]!.args.slice(0, 3)).toEqual([
      "r1",
      "rejected",
      "sandbox",
    ]);
  });

  it("writes no decision when another process already moved the rule", async () => {
    const fake = use({
      findRule: {
        id: "r1",
        kind: "add_stopword",
        language: "all",
        payload: { word: "zzyzx" },
        status: "shadow",
        origin: "analyst",
      },
      settleCandidate: false,
    });
    await sandboxRule("r1", "fast", { drones: [], control: [], fixtures: [] });
    expect(fake.callsOf("recordDecision")).toHaveLength(0);
  });

  it("reports an unknown rule", async () => {
    use({ findRule: null });
    expect(await sandboxRule("nope")).toEqual({ ok: false, reason: "rule not found" });
  });
});

describe("proposing a rule over the port", () => {
  it("stores a valid rule as a candidate with its defaults", async () => {
    const fake = use();
    const res = await proposeRule({ kind: "add_stopword", payload: { word: "zzyzx" } });
    expect(res.ok).toBe(true);
    expect(fake.callsOf("insertCandidate")[0]!.args[0]).toMatchObject({
      id: res.id,
      kind: "add_stopword",
      language: "all",
      payload: { word: "zzyzx" },
      origin: "analyst",
      targetKey: "system_name",
      rationale: null,
      evidence: null,
    });
  });

  it("stores nothing for an unknown kind or a payload that does not compile", async () => {
    const fake = use();
    expect((await proposeRule({ kind: "nope" as never, payload: {} })).ok).toBe(false);
    expect(await proposeRule({ kind: "add_stopword", payload: {} })).toEqual({
      ok: false,
      reason: "payload does not compile",
    });
    expect(fake.names()).toEqual([]);
  });
});

describe("reading rules over the port", () => {
  it("lists rules with the latest evaluation, timestamps as ISO strings", async () => {
    use({
      ruleListRows: [
        {
          id: "r1",
          kind: "add_cue",
          language: "en",
          payload: null,
          status: "active",
          origin: "analyst",
          targetKey: null,
          rationale: null,
          evidence: null,
          createdAt: new Date("2026-01-02T03:04:05Z"),
          promotedAt: null,
          shadowMetrics: null,
          evalReport: { passed: true },
          evalAt: new Date("2026-01-03T00:00:00Z"),
          evalVersion: 7,
        },
      ],
    });
    const [rule] = await listRules(5);
    expect(rule).toMatchObject({
      id: "r1",
      payload: {},
      createdAt: "2026-01-02T03:04:05.000Z",
      promotedAt: null,
      shadow: null,
      lastEvaluation: { passed: true, evaluatedAt: "2026-01-03T00:00:00.000Z", rulesVersion: 7 },
    });
  });

  it("builds the autonomy status from the decision log", async () => {
    use({
      decisions: [],
      autoActivatedLast24h: 2,
      recentDecisions: [
        {
          ruleId: "r1",
          decision: "auto_activated",
          actor: "autonomous",
          note: null,
          decidedAt: new Date("2026-02-01T00:00:00Z"),
        },
      ],
    });
    const status = await getAutonomyStatus();
    expect(status?.autoActivatedLast24h).toBe(2);
    expect(status?.recent).toEqual([
      {
        ruleId: "r1",
        decision: "auto_activated",
        actor: "autonomous",
        note: null,
        at: "2026-02-01T00:00:00.000Z",
      },
    ]);
  });

  it("refreshes the live rule snapshot through the port and keeps it when the port fails", async () => {
    use({
      rulesVersion: 3,
      activeRules: [
        { id: "s1", kind: "add_stopword", language: "all", payload: { word: "zzyzx" } },
      ],
    });
    const snapshot = await getOrRefreshRuleSnapshot({ force: true });
    expect(snapshot.version).toBe(3);
    expect(snapshot.stopwords.has("zzyzx")).toBe(true);

    use({
      rulesVersion: () => {
        throw new Error("connection lost");
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = await getOrRefreshRuleSnapshot({ force: true });
    expect(kept.version).toBe(3);
  });
});

describe("probation over the port", () => {
  const quarantined = (id: string, kind = "add_cue") => ({
    id,
    kind,
    targetKey: "range",
    status: "quarantined",
    origin: "autonomous_sandbox",
  });
  const breakerQuarantine = (ruleId: string, daysAgo: number) => ({
    ruleId,
    decision: "quarantined",
    actor: "circuit_breaker",
    decidedAt: new Date(Date.now() - daysAgo * DAY),
  });

  it("returns a rule quarantined for a week to shadow, bumps the version and writes the event", async () => {
    const fake = use({
      quarantinedGenerated: [
        quarantined("old"),
        quarantined("young"),
        quarantined("al", "add_alias"),
      ],
      decisionHistory: [
        breakerQuarantine("old", 8),
        breakerQuarantine("young", 2),
        breakerQuarantine("al", 30),
      ],
      returnToShadow: true,
    });
    expect(await startProbation()).toEqual(["old"]);
    expect(fake.names()).toEqual([
      "quarantinedGenerated",
      "decisionHistory",
      "returnToShadow",
      "appendVersion",
      // The bump then refreshes the live snapshot through the same port.
      "rulesVersion",
    ]);
    expect(fake.callsOf("decisionHistory")[0]!.args[0]).toEqual(["old", "young", "al"]);
    expect(fake.callsOf("appendVersion")[0]!.args).toEqual(["probation old"]);
    expect(recordAutonomyEvent).toHaveBeenCalledTimes(1);
    expect(recordAutonomyEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rule_probation_started",
        targetId: "old",
        category: "add_cue:range",
      }),
    );
  });

  it("skips a rule that was no longer quarantined when its transaction ran", async () => {
    const fake = use({
      quarantinedGenerated: [quarantined("old")],
      decisionHistory: [breakerQuarantine("old", 8)],
      returnToShadow: false,
    });
    expect(await startProbation()).toEqual([]);
    expect(fake.callsOf("appendVersion")).toHaveLength(0);
    expect(recordAutonomyEvent).not.toHaveBeenCalled();
  });

  it("keeps going when one rule fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    use({
      quarantinedGenerated: [quarantined("a"), quarantined("b")],
      decisionHistory: [breakerQuarantine("a", 8), breakerQuarantine("b", 8)],
      returnToShadow: (id: string) => {
        if (id === "a") throw new Error("deadlock");
        return true;
      },
    });
    expect(await startProbation()).toEqual(["b"]);
  });
});
