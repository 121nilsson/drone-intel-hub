import { describe, expect, it } from "vitest";
import { claimsByRule } from "@/entities/drone/claim-lineage";
import { mergeSpecs } from "@/entities/drone/spec-engine";
import {
  verificationByPromptVersion,
  verificationCoverage,
} from "@/entities/drone/verification-coverage";
import type { ClaimVerification, Drone, ExtractedSpec, SpecClaim } from "@/entities/drone/types";

const empty = (id: string): Drone => ({ id, name: id, aliases: [], specs: [] }) as unknown as Drone;

const spec = (over: Partial<ExtractedSpec> = {}): ExtractedSpec => ({
  key: "range",
  label: "Range",
  value: 120,
  unit: "km",
  evidence: "a reach of 120 km",
  ...over,
});

const verified = { state: "verified", checks: [] } as unknown as ClaimVerification;

const claim = (over: Partial<SpecClaim>): SpecClaim =>
  ({
    id: crypto.randomUUID(),
    value: 1,
    source: "Outlet",
    date: "2026-01-01",
    ...over,
  }) as SpecClaim;

describe("claim lineage", () => {
  it("stamps the ref's lineage and the spec's rule ids on each claim", () => {
    const drone = mergeSpecs(empty("d1"), [spec({ ruleIds: ["cue-reach"] })], "Outlet", {
      lineage: { promptVersion: "drone-osint-v8", pipelineVersion: "drone-osint-v8/2" },
    });
    expect(drone.specs[0]!.claims[0]!.lineage).toEqual({
      promptVersion: "drone-osint-v8",
      pipelineVersion: "drone-osint-v8/2",
      ruleIds: ["cue-reach"],
    });
  });

  it("writes no lineage key for a claim built without any", () => {
    const drone = mergeSpecs(empty("d1"), [spec()], "Outlet");
    expect(drone.specs[0]!.claims[0]).not.toHaveProperty("lineage");
  });

  it("keeps lineage with no rule ids when the spec was not shaped by a rule", () => {
    const drone = mergeSpecs(empty("d1"), [spec()], "Outlet", {
      lineage: { rulesVersion: 0 },
    });
    expect(drone.specs[0]!.claims[0]!.lineage).toEqual({ rulesVersion: 0 });
  });

  it("finds only the claims a rule shaped", () => {
    let drone = mergeSpecs(empty("d1"), [spec({ ruleIds: ["cue-reach"] })], "Outlet");
    drone = mergeSpecs(
      drone,
      [spec({ key: "speed", label: "Speed", value: 80, unit: "km/h", evidence: "80 km/h" })],
      "Outlet",
    );
    const hits = claimsByRule([drone], "cue-reach");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ droneId: "d1", specKey: "range" });
    expect(claimsByRule([drone], "missing")).toEqual([]);
  });

  it("counts machine claims by prompt version, with claims lacking one as unknown", () => {
    const drone = {
      ...empty("d1"),
      specs: [
        {
          key: "range",
          label: "Range",
          discoveredBy: "ai",
          claims: [
            claim({ lineage: { promptVersion: "v8" }, verification: verified }),
            claim({
              lineage: { promptVersion: "v8" },
              verification: { state: "rejected", checks: [] } as unknown as ClaimVerification,
            }),
            claim({}),
            claim({ source: "Analyst", extractionEngine: "analyst", verification: verified }),
          ],
        },
      ],
    } as unknown as Drone;
    const rows = verificationByPromptVersion([drone]);
    expect(rows).toEqual([
      { promptVersion: "v8", verified: 1, uncertain: 0, rejected: 1, unverified: 0, total: 2 },
      { promptVersion: "unknown", verified: 0, uncertain: 0, rejected: 0, unverified: 1, total: 1 },
    ]);
    expect(verificationCoverage([drone]).analyst).toBe(1);
  });
});
