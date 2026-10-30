import { describe, expect, it } from "vitest";
import { notASystemName, runTwoTier, type PipelineDeps } from "@/shared/infra/ingest/pipeline";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { ProviderOutageError, type IntelExtractor } from "@/shared/contracts/ai";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";

const SRC = "test-source";

const repo = () => {
  const items: Drone[] = [];
  return {
    list: () => items,
    get: (id: string) => items.find((d) => d.id === id),
    remove: (id: string) => {
      const i = items.findIndex((d) => d.id === id);
      if (i >= 0) items.splice(i, 1);
    },
    search: () => items,
    upsert: (d: Drone) => {
      const i = items.findIndex((x) => x.id === d.id);
      if (i >= 0) items[i] = d;
      else items.push(d);
    },
  };
};

const failing = (msg: string): IntelExtractor => ({
  tier: 1,
  label: "failing",
  extract: async () => {
    throw new Error(msg);
  },
});

const ok = (e: Partial<Extraction>): IntelExtractor => ({
  tier: 1,
  label: "ok",
  extract: async () =>
    ({
      name: null,
      aliases: [],
      operators: [],
      specs: [],
      rfBands: [],
      systems: [],
      confidence: 0,
      rationale: "test",
      ...e,
    }) as Extraction,
});

function makeDeps(over: {
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  fallback?: IntelExtractor;
}) {
  const d = repo();
  const cands: Candidate[] = [];
  const deps: PipelineDeps & { cands: Candidate[] } = {
    drones: d,
    candidates: {
      list: () => cands,
      add: (c) => cands.push(c),
      update: () => {},
      remove: () => {},
    },
    tier1: over.tier1,
    tier2: over.tier2,
    ...(over.fallback ? { fallback: over.fallback } : {}),
    escalationThreshold: 0.6,
    autoMergeThreshold: 0.85,
    cands,
  };
  return deps;
}

describe("runTwoTier provider-outage fallback", () => {
  it("uses the heuristic engine when tier 1 throws, and marks the candidate degraded", async () => {
    const d = makeDeps({
      tier1: failing("provider down"),
      tier2: failing("provider down"),
      fallback: new HeuristicExtractor(1),
    });
    const res = await runTwoTier(
      "Russia launched an FPV drone with GPS jammers, cruising 120 km/h, range 40 km, 2 kg warhead at $300.",
      SRC,
      d,
    );
    expect(res.kind).toBe("queued");
    expect(res.candidate.tier).toBe(1);
    expect(res.candidate.extraction.rationale).toContain("heuristic");
    expect(d.cands).toHaveLength(1);
  });

  it("keeps the tier-1 result when tier 2 throws after escalation", async () => {
    const d = makeDeps({
      tier1: ok({
        name: "Zala-421",
        confidence: 0.4,
        systems: [{ name: "Zala-421" }],
      }),
      tier2: failing("Provider timeout"),
    });
    const res = await runTwoTier("Zala-421 loitering munition over Odesa.", SRC, d);
    expect(res.kind).toBe("queued");
    expect(res.candidate.tier).toBe(1);
    expect(res.candidate.extraction.name).toBe("Zala-421");
    expect(res.candidate.extraction.rationale).toContain("kept tier 1");
  });

  it("still hard-fails when no fallback engine is configured (test/legacy callers)", async () => {
    const d = makeDeps({
      tier1: failing("provider down"),
      tier2: failing("provider down"),
    });
    await expect(runTwoTier("text", SRC, d)).rejects.toThrow("provider down");
  });
});

describe("runTwoTier during a provider outage", () => {
  const outage = (): IntelExtractor => ({
    tier: 1,
    label: "outage",
    extract: async () => {
      throw new ProviderOutageError("All providers unavailable.");
    },
  });
  const text = "Russia launched an FPV drone with GPS jammers, range 40 km.";

  it("rethrows the outage for a queue processor, so the post stays pending", async () => {
    const d = makeDeps({ tier1: outage(), tier2: outage(), fallback: new HeuristicExtractor(1) });
    await expect(runTwoTier(text, SRC, { ...d, deferOnOutage: true })).rejects.toBeInstanceOf(
      ProviderOutageError,
    );
    expect(d.cands).toHaveLength(0);
  });

  it("rethrows when the owed deep pass hits the outage", async () => {
    const d = makeDeps({
      tier1: ok({ name: "Zala-421", confidence: 0.4, systems: [{ name: "Zala-421" }] }),
      tier2: outage(),
    });
    await expect(
      runTwoTier("Zala-421 loitering munition.", SRC, { ...d, deferOnOutage: true }),
    ).rejects.toBeInstanceOf(ProviderOutageError);
  });

  it("still degrades to the heuristic for an interactive paste", async () => {
    const d = makeDeps({ tier1: outage(), tier2: outage(), fallback: new HeuristicExtractor(1) });
    const res = await runTwoTier(text, SRC, d);
    expect(res.candidate.extraction.rationale).toContain("heuristic");
  });
});

describe("runTwoTier with a multi-system report", () => {
  const multi = ok({
    name: "Zala-421",
    confidence: 0.4,
    systems: [{ name: "Zala-421" }, { name: "Orlan-10" }],
    systemExtractions: [
      { name: "Zala-421", confidence: 0.5, specs: [], rfBands: [], rationale: "Zala clause." },
      { name: "Orlan-10", confidence: 0.1, specs: [], rfBands: [], rationale: "Orlan clause." },
    ],
  });

  it("keeps the degraded-tier note on every per-system candidate", async () => {
    const d = makeDeps({ tier1: multi, tier2: failing("Provider timeout") });
    const res = await runTwoTier("Zala-421 and Orlan-10 over Odesa.", SRC, d);
    // Each slice has its own rationale, which used to replace the parent's note entirely.
    expect(res.candidate.extraction.rationale).toContain("Zala clause.");
    expect(res.candidate.extraction.rationale).toContain("tier-2 AI unavailable");
    expect(res.relatedCandidates?.[0]?.extraction.rationale).toContain("tier-2 AI unavailable");
  });

  it("auto-discards a related slice below the discard threshold", async () => {
    const d = makeDeps({ tier1: multi, tier2: multi });
    const res = await runTwoTier("Zala-421 and Orlan-10 over Odesa.", SRC, {
      ...d,
      autoDiscardThreshold: 0.25,
    });
    expect(res.kind).toBe("queued");
    const orlan = res.relatedCandidates?.find((c) => c.extraction.name === "Orlan-10");
    expect(orlan?.status).toBe("discarded");
    expect(orlan?.resolvedBy).toBe("auto");
  });
});

describe("auto-promotion guard", () => {
  it("recognises organisations, units and the outlet as non-systems", () => {
    const src = "Ukrinform (War) · https://www.ukrinform.net/x";
    expect(notASystemName("Ukrinform", src)).toBe(true);
    expect(notASystemName("77th Separate Airmobile Nadniprianska Brigade", src)).toBe(true);
    expect(notASystemName("unmanned systems battalion", src)).toBe(true);
    expect(notASystemName("Ukrainian Air Assault Forces Command", src)).toBe(true);
    expect(notASystemName("Azov military grouping", src)).toBe(true);
    expect(notASystemName("Lancet-3", src)).toBe(false);
    expect(notASystemName("Baba Yaga", src)).toBe(false);
  });

  it("queues a confident organisation instead of promoting it", async () => {
    const d = makeDeps({
      tier1: ok({ name: "Ukrinform", confidence: 0.95, systems: [{ name: "Ukrinform" }] }),
      tier2: ok({}),
    });
    const res = await runTwoTier(
      "Ukrinform reports a convoy was destroyed.",
      "Ukrinform (War) · https://u.example",
      {
        ...d,
        autoPromoteThreshold: 0.9,
      },
    );
    expect(res.kind).toBe("queued");
    expect(d.drones.list()).toEqual([]);
  });

  it("persists resolvedBy on an auto-promoted related system", async () => {
    const updates: Record<string, unknown>[] = [];
    const d = makeDeps({
      tier1: ok({
        name: "Geran-5",
        confidence: 0.95,
        systems: [{ name: "Geran-5" }, { name: "STING S" }],
        systemExtractions: [
          { name: "Geran-5", confidence: 0.95, specs: [], rfBands: [] },
          { name: "STING S", confidence: 0.95, specs: [], rfBands: [] },
        ],
      }),
      tier2: ok({}),
    });
    d.candidates.update = (_id, patch) => void updates.push(patch);
    await runTwoTier("Geran-5 intercepted by a STING S.", SRC, { ...d, autoPromoteThreshold: 0.9 });
    expect(updates.filter((u) => u["resolvedBy"] === "auto")).toHaveLength(2);
  });
});
