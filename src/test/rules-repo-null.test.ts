import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serverServices, setServerServices } from "@/shared/infra/server-services.server";
import { nullRulesRepo } from "@/shared/infra/null-repos/rules";
import {
  resetRuleRegistry,
  getOrRefreshRuleSnapshot,
} from "@/shared/infra/heuristics/rule-registry.server";
import {
  activateRule,
  getAutonomyStatus,
  listRules,
  mineAndSandbox,
  proposeRule,
  rejectRule,
  replayRule,
  runShadow,
  sandboxRule,
  shadowRule,
  startProbation,
  superviseActiveRules,
} from "@/shared/infra/evaluation/rule-sandbox.server";

// These are the results the rule loops gave when dbConfigured() was false, now produced with no
// DATABASE_URL and the real composition root: the null adapter and the sql capability.
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("RULE_PROBATION", "on");
  vi.stubEnv("RULE_REPLAY", "on");
  setServerServices(null);
  resetRuleRegistry();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rules without a SQL database", () => {
  it("is served the null adapter and no SQL capability", () => {
    const services = serverServices();
    expect(services.rules).toBe(nullRulesRepo);
    expect(services.backend.capabilities.sql).toBe(false);
  });

  it("returns the old no-database results from every entry point", async () => {
    expect(await activateRule("r1")).toEqual({ ok: false, reason: "no database configured" });
    expect(await shadowRule("r1")).toEqual({ ok: false });
    expect(await rejectRule("r1")).toEqual({ ok: false });
    expect(await listRules()).toEqual([]);
    expect(await getAutonomyStatus()).toBeNull();
    expect(await proposeRule({ kind: "add_stopword", payload: { word: "zzyzx" } })).toEqual({
      ok: false,
      reason: "no database configured",
    });
    expect(await sandboxRule("r1")).toEqual({ ok: false, reason: "no database configured" });
    expect(await startProbation()).toEqual([]);
    expect(await replayRule("r1")).toEqual({
      claims: 0,
      requeued: [],
      skipped: "switched off or no database",
    });
    const none = { mined: 0, proposed: 0, sandboxed: 0, passed: 0, parserDefects: 0 };
    expect(await mineAndSandbox()).toEqual({
      ran: false,
      reason: "no database configured",
      ...none,
    });
    expect(await runShadow()).toEqual({
      ran: false,
      reason: "no database configured",
      rules: 0,
      evaluated: 0,
      promoted: [],
    });
    expect(await superviseActiveRules()).toEqual({
      ran: false,
      reason: "no database configured",
      breaker: { checked: 0, tripped: false, reasons: [] },
      audited: 0,
      quarantined: [],
    });
  });

  it("leaves the live rule snapshot alone: the registry refresh finds no database", async () => {
    const snapshot = await getOrRefreshRuleSnapshot({ force: true });
    expect(snapshot.version).toBe(0);
  });
});

describe("the null adapter itself", () => {
  it("reads nothing, moves nothing and refuses the activation lock", async () => {
    expect(await nullRulesRepo.findRule("r1")).toBeNull();
    expect(await nullRulesRepo.activeRules()).toEqual([]);
    expect(await nullRulesRepo.rulesVersion()).toBe(0);
    expect(await nullRulesRepo.shadowRules()).toEqual([]);
    expect(await nullRulesRepo.candidateSample(10)).toEqual([]);
    expect(await nullRulesRepo.settleCandidate("r1", "rejected", null)).toBe(false);
    expect(await nullRulesRepo.rejectOrQuarantine("r1")).toBeNull();
    expect(await nullRulesRepo.returnToShadow("r1", {})).toBe(false);
    expect(await nullRulesRepo.withActivationLock(async () => "ran")).toEqual({
      ok: false,
      reason: "no database configured",
    });
  });
});
