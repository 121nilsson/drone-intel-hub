import { describe, expect, it, vi } from "vitest";
import {
  CONTRADICTION_CONFIDENCE,
  adjudicateContradictions,
  needsCheck,
} from "@/features/intake/contradictions";
import { consensus } from "@/entities/drone/consensus";
import { openAIContradictionAdjudicator } from "@/shared/infra/openai-compatible-ai";
import { ProviderOutageError, type ContradictionAdjudicator } from "@/shared/contracts/ai";
import type { Drone, SpecAttribute } from "@/entities/drone/types";
import type { DroneRepository } from "@/shared/contracts/repository";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A spec whose claims are parsed points in km, so consensus() can measure the disagreement. */
const spec = (
  key: string,
  values: { value: number; source: string; date?: string }[],
  over: Partial<SpecAttribute> = {},
): SpecAttribute => ({
  key,
  label: "Range",
  unit: "km",
  semantic: "range.max",
  discoveredBy: "ai",
  claims: values.map((c) => ({
    value: c.value,
    source: c.source,
    date: c.date ?? iso(NOW - 86_400_000),
    normalized: {
      raw: `${c.value} km`,
      canonicalValue: c.value,
      canonicalUnit: "km",
      confidence: 1,
    },
  })),
  ...over,
});

const drone = (id: string, specs: SpecAttribute[]): Drone => ({
  id,
  name: "Lancet-3",
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs,
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: iso(NOW - 30 * 86_400_000),
  updatedAt: iso(NOW - 30 * 86_400_000),
});

/** Three outlets, two of them agreeing, one far off: the shape consensus() disputes. */
const disputed = () =>
  spec("range", [
    { value: 40, source: "Militarnyi" },
    { value: 40, source: "TWZ" },
    { value: 90, source: "Rybar" },
  ]);

function repo(drones: Drone[]) {
  const ds = [...drones];
  const drones_ = {
    list: () => ds,
    get: (id: string) => ds.find((d) => d.id === id),
    upsert: (d: Drone) => {
      const i = ds.findIndex((x) => x.id === d.id);
      if (i >= 0) ds[i] = d;
      else ds.push(d);
    },
    remove: () => {},
    search: () => ds,
  };
  return { repo: drones_ as DroneRepository, all: () => ds };
}

const verdict =
  (supported: number, confidence = 0.9, reason?: string): ContradictionAdjudicator =>
  async () => ({ supported, confidence, ...(reason ? { reason } : {}) });

describe("needsCheck", () => {
  it("asks about a disputed spec that has never been checked", () => {
    const s = disputed();
    expect(consensus(s).disputed).toBe(true);
    expect(needsCheck(s)).toBe(true);
  });

  it("leaves a spec alone whose sources agree", () => {
    const s = spec("range", [
      { value: 40, source: "Militarnyi" },
      { value: 40, source: "TWZ" },
    ]);
    expect(consensus(s).disputed).toBe(false);
    expect(needsCheck(s)).toBe(false);
  });

  it("re-opens the question only when a claim arrived since the last check", () => {
    // Three claims so the disagreement is real: with two, consensus() itself would not call it
    // disputed (40 against 90 puts the median at 90, a 56% spread).
    const settled = spec("range", [
      { value: 40, source: "Militarnyi" },
      { value: 40, source: "TWZ" },
      { value: 90, source: "Rybar" },
    ]);
    const asked = { ...settled, contradictionCheckedAt: iso(NOW - 86_400_000) };
    expect(needsCheck(asked)).toBe(false);
    const newer = {
      ...asked,
      claims: asked.claims.map((c, i) => (i === 2 ? { ...c, date: iso(NOW - 3_600_000) } : c)),
    };
    expect(needsCheck(newer)).toBe(true);
  });
});

describe("adjudicateContradictions", () => {
  it("marks the supported claim and the outliers, keeping every claim whole", async () => {
    const { repo: drones, all } = repo([drone("lancet-3", [disputed()])]);
    const rep = await adjudicateContradictions(drones, {
      now: NOW,
      adjudicate: verdict(0, 0.9, "stated plainly about this system"),
    });
    expect(rep).toMatchObject({ checked: 1, outliers: 2 });

    const claims = all()[0]!.specs[0]!.claims;
    // Nothing removed or rewritten: provenance stays whole, the verdict rides along.
    expect(claims.map((c) => c.value)).toEqual([40, 40, 90]);
    expect(claims.map((c) => c.adjudication?.verdict)).toEqual(["supported", "outlier", "outlier"]);
    expect(claims[0]!.adjudication?.reason).toBe("stated plainly about this system");
    expect(all()[0]!.specs[0]!.contradictionCheckedAt).toBe(iso(NOW));
  });

  it("marks nothing when the model cannot tell the reports apart", async () => {
    const { repo: drones, all } = repo([drone("lancet-3", [disputed()])]);
    const rep = await adjudicateContradictions(drones, {
      now: NOW,
      adjudicate: verdict(-1, 0.9),
    });
    expect(rep).toMatchObject({ checked: 1, outliers: 0 });
    // The call was spent, so the one-shot marker applies: an undecidable disagreement is not
    // re-asked on every run.
    expect(all()[0]!.specs[0]!.claims.every((c) => !c.adjudication)).toBe(true);
    expect(all()[0]!.specs[0]!.contradictionCheckedAt).toBe(iso(NOW));
  });

  it("records nothing below the confidence bar", async () => {
    const { repo: drones, all } = repo([drone("lancet-3", [disputed()])]);
    const rep = await adjudicateContradictions(drones, {
      now: NOW,
      adjudicate: verdict(0, CONTRADICTION_CONFIDENCE - 0.01),
    });
    expect(rep.outliers).toBe(0);
    expect(all()[0]!.specs[0]!.claims.every((c) => !c.adjudication)).toBe(true);
  });

  it("stops at a provider outage without marking anything", async () => {
    const { repo: drones, all } = repo([drone("lancet-3", [disputed()])]);
    const rep = await adjudicateContradictions(drones, {
      now: NOW,
      adjudicate: async () => {
        throw new ProviderOutageError("All providers unavailable.");
      },
    });
    expect(rep.stopReason).toContain("unavailable");
    expect(rep.checked).toBe(0);
    expect(all()[0]!.specs[0]!.contradictionCheckedAt).toBeUndefined();
  });

  it("respects the per-run cap across the catalog", async () => {
    const { repo: drones } = repo([
      drone("a", [disputed()]),
      drone("b", [disputed()]),
      drone("c", [disputed()]),
    ]);
    const rep = await adjudicateContradictions(drones, {
      now: NOW,
      adjudicate: verdict(0),
      max: 2,
    });
    expect(rep.checked).toBe(2);
  });

  it("does nothing without an adjudicator, so a run without AI costs nothing", async () => {
    const { repo: drones, all } = repo([drone("lancet-3", [disputed()])]);
    const rep = await adjudicateContradictions(drones, { now: NOW });
    expect(rep.checked).toBe(0);
    expect(all()[0]!.specs[0]!.contradictionCheckedAt).toBeUndefined();
  });
});

describe("openAIContradictionAdjudicator", () => {
  const cfg = {
    baseUrl: "https://api.test/v1",
    apiKey: "k",
    tier1Model: "m1",
    tier2Model: "m2",
    translateModel: "mt",
    escalationThreshold: 0.5,
    autoMergeThreshold: 0.85,
    autoPromoteThreshold: 0.9,
    autoDiscardThreshold: 0.25,
    heuristicFirst: true,
  };

  it("parses the model's pick out of the reply", async () => {
    const chat = vi.fn(async () => ({
      ok: true as const,
      content: JSON.stringify({ supported: 1, confidence: 0.82, reason: "range, not radius" }),
    }));
    const adjudicate = openAIContradictionAdjudicator(cfg, chat);
    const v = await adjudicate({
      drone: drone("lancet-3", []),
      specLabel: "Range (km)",
      claims: [{ value: "40 km", source: "Militarnyi" }],
    });
    expect(v).toEqual({ supported: 1, confidence: 0.82, reason: "range, not radius" });
  });

  it("rejects a reply that is not a verdict", async () => {
    const chat = vi.fn(async () => ({ ok: true as const, content: "no json here" }));
    const adjudicate = openAIContradictionAdjudicator(cfg, chat);
    await expect(
      adjudicate({ drone: drone("lancet-3", []), specLabel: "Range (km)", claims: [] }),
    ).rejects.toThrow("Invalid contradiction JSON");
  });
});
