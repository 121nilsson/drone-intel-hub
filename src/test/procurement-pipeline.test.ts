import { describe, expect, it, vi } from "vitest";
import type { Candidate, Drone, Extraction } from "@/entities/drone/types";
import type { Procurement } from "@/entities/procurement/types";
import type { CandidateRepository, DroneRepository } from "@/shared/contracts/repository";
import type { IntelExtractor } from "@/shared/contracts/ai";
import { runTwoTier, type PipelineDeps } from "@/shared/infra/ingest/pipeline";

const SRC = "Defense News · https://example.test/deal";

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  name: "Akash",
  aliases: [],
  operators: [],
  manufacturer: "Akash Dynamics",
  origin: "IN",
  specs: [],
  rfBands: [],
  systems: [{ name: "Akash", matchId: "akash" }],
  matchId: "akash",
  confidence: 0.95,
  rationale: "test",
  ...over,
});

const extractor = (e: Extraction): IntelExtractor => ({
  tier: 1,
  label: "fixed",
  extract: async () => e,
});

function harness(e: Extraction, extracted: Procurement | null = null) {
  const drones: Drone[] = [];
  const candidates: Candidate[] = [];
  const procurements: Procurement[] = [];
  const droneRepo: DroneRepository = {
    list: () => drones,
    get: (id) => drones.find((d) => d.id === id),
    upsert: (drone) => {
      const i = drones.findIndex((d) => d.id === drone.id);
      if (i >= 0) drones[i] = drone;
      else drones.push(drone);
    },
    remove: () => {},
    search: () => drones,
  };
  const candidateRepo: CandidateRepository = {
    list: () => candidates,
    add: (candidate) => {
      candidates.push(candidate);
    },
    update: (id, patch) => {
      const i = candidates.findIndex((c) => c.id === id);
      if (i >= 0) candidates[i] = { ...candidates[i]!, ...patch };
    },
    remove: () => {},
  };
  const enrich = vi.fn(async (): Promise<Procurement | null> => extracted);
  const deps: PipelineDeps = {
    drones: droneRepo,
    candidates: candidateRepo,
    procurements: {
      list: () => procurements,
      add: (p) => {
        procurements.push(p);
      },
      update: () => {},
    },
    procurementExtractor: enrich,
    tier1: extractor(e),
    tier2: extractor(e),
    escalationThreshold: 0.5,
    autoMergeThreshold: 0.99,
  };
  return { deps, procurements, enrich };
}

describe("procurement routing in the pipeline", () => {
  it("stores one enriched contract and removes the deal figure from drone specs", async () => {
    const financial = extraction({
      specs: [
        {
          key: "contract_value",
          label: "Contract value",
          value: "$2 billion",
          evidence: "worth $2 billion",
        },
        { key: "range", label: "Range", value: 30, unit: "km", evidence: "range of 30 km" },
      ],
    });
    const { deps, procurements, enrich } = harness(financial, {
      id: "model-id",
      company: "Akash Dynamics",
      country: "IN",
      amount: "$1 billion",
      currency: "USD",
      customer: "Indian MoD",
      program: "Emergency Procurement",
      product: "Akash",
      announcedAt: "2026-09-20",
      notes: "model note",
      source: SRC,
      createdAt: "2026-10-01T00:00:00.000Z",
    });

    const result = await runTwoTier(
      "The drone has a range of 30 km. The contract is worth $2 billion.",
      SRC,
      deps,
      { dispatchId: "dispatch-1" },
    );

    expect(result.candidate.extraction.specs.map((s) => s.key)).toEqual(["range"]);
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(procurements).toHaveLength(1);
    expect(procurements[0]).toMatchObject({
      company: "Akash Dynamics",
      country: "IN",
      amount: "$2 billion",
      currency: "USD",
      customer: "Indian MoD",
      program: "Emergency Procurement",
      announcedAt: "2026-09-20T00:00:00.000Z",
      source: SRC,
      sourceId: "dispatch-1",
      systemIds: ["akash"],
      systemNames: ["Akash"],
    });
  });

  it("does not spend a metadata call on a post without a deal", async () => {
    const { deps, procurements, enrich } = harness(
      extraction({
        specs: [{ key: "range", label: "Range", value: 30, unit: "km", evidence: "30 km" }],
      }),
    );

    await runTwoTier("The drone has a range of 30 km.", SRC, deps);

    expect(enrich).not.toHaveBeenCalled();
    expect(procurements).toHaveLength(0);
  });
});
