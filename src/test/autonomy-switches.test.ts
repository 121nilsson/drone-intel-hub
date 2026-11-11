import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTONOMY_SWITCHES,
  AUTONOMY_SWITCH_NAMES,
  autonomySwitchEnabled,
} from "@/shared/infra/autonomy/switches.server";
import { SCHEDULED_TASKS } from "@/shared/contracts/scheduled-tasks";

afterEach(() => vi.unstubAllEnvs());

describe("autonomy switch reading", () => {
  it("is on when the variable is unset", () => {
    delete process.env["AUTOCORRECT"];
    expect(autonomySwitchEnabled("autocorrect")).toBe(true);
  });

  it("is on when the variable is empty or only spaces", () => {
    vi.stubEnv("AUTOCORRECT", "");
    expect(autonomySwitchEnabled("autocorrect")).toBe(true);
    vi.stubEnv("AUTOCORRECT", "   ");
    expect(autonomySwitchEnabled("autocorrect")).toBe(true);
  });

  it("is off for off in any case", () => {
    for (const value of ["off", "OFF", "Off", "oFf"]) {
      vi.stubEnv("RULES_AUTOPROMOTE", value);
      expect(autonomySwitchEnabled("rules_autopromote")).toBe(false);
    }
  });

  it("ignores surrounding spaces around off", () => {
    vi.stubEnv("AI_VERIFIER", " off ");
    expect(autonomySwitchEnabled("ai_verifier")).toBe(false);
    vi.stubEnv("AI_VERIFIER", "\toff\n");
    expect(autonomySwitchEnabled("ai_verifier")).toBe(false);
  });

  it("is on for on in any case", () => {
    for (const value of ["on", "ON", " on "]) {
      vi.stubEnv("AUTOCORRECT", value);
      expect(autonomySwitchEnabled("autocorrect")).toBe(true);
    }
  });

  it("treats an unrecognised value as on, as the loops always did", () => {
    vi.stubEnv("RULES_AUTOPROMOTE", "no");
    expect(autonomySwitchEnabled("rules_autopromote")).toBe(true);
    vi.stubEnv("RULES_AUTOPROMOTE", "offf");
    expect(autonomySwitchEnabled("rules_autopromote")).toBe(true);
  });

  it("reads AI_VERIFIER case-insensitively (a deliberate change from the old exact match)", () => {
    vi.stubEnv("AI_VERIFIER", "OFF");
    expect(autonomySwitchEnabled("ai_verifier")).toBe(false);
  });

  it("reads each switch from its own variable", () => {
    vi.stubEnv("RULES_AUTOPROMOTE", "off");
    vi.stubEnv("AUTOCORRECT", "on");
    vi.stubEnv("AI_VERIFIER", "on");
    expect(autonomySwitchEnabled("rules_autopromote")).toBe(false);
    expect(autonomySwitchEnabled("autocorrect")).toBe(true);
    expect(autonomySwitchEnabled("ai_verifier")).toBe(true);
  });
});

describe("autonomy switch definitions", () => {
  it("defines every switch with its variable, default on and a description", () => {
    expect([...AUTONOMY_SWITCH_NAMES].sort()).toEqual([
      "ai_verifier",
      "autocorrect",
      "rule_probation",
      "rule_replay",
      "rules_autopromote",
    ]);
    for (const name of AUTONOMY_SWITCH_NAMES) {
      const s = AUTONOMY_SWITCHES[name];
      expect(s.env).toMatch(/^[A-Z_]+$/);
      expect(s.default).toBe(true);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("gives each switch its own variable", () => {
    const envs = AUTONOMY_SWITCH_NAMES.map((n) => AUTONOMY_SWITCHES[n].env);
    expect(new Set(envs).size).toBe(envs.length);
  });
});

describe("scheduled jobs and their switches", () => {
  it("points every switched job at a defined switch", () => {
    const switched = SCHEDULED_TASKS.filter((t) => t.switch !== undefined);
    expect(switched.map((t) => t.name).sort()).toEqual([
      "evaluation:rules",
      "evaluation:shadow",
      "sources:sync",
      "verification:ai",
      "verification:controls",
    ]);
    for (const t of switched)
      expect(AUTONOMY_SWITCH_NAMES).toContain(t.switch as (typeof AUTONOMY_SWITCH_NAMES)[number]);
  });

  it("leaves jobs without an autonomous step unswitched", () => {
    const names = SCHEDULED_TASKS.filter((t) => t.switch === undefined).map((t) => t.name);
    expect(names).toContain("verification:run");
    expect(names).toContain("evaluation:health");
  });
});
