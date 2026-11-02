import { describe, expect, it } from "vitest";
import { activityPeriod, toActivity, withActivity } from "@/entities/drone/activity";
import {
  firstCounterparts,
  legacyRelationsToMigrate,
  resolveRelations,
  withRelationReview,
} from "@/entities/drone/system-hierarchy";
import { buildSystemEvidenceDigest } from "@/shared/infra/system-evidence-digest";
import type { Drone, SystemRelationClaim } from "@/entities/drone/types";

const AT = "2026-10-20T00:00:00.000Z";

const drone = (id: string, over: Partial<Drone> = {}): Drone => ({
  id,
  name: id,
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs: [],
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const claim = (
  to: string,
  kind: SystemRelationClaim["kind"],
  over: Partial<SystemRelationClaim> = {},
): SystemRelationClaim => ({
  id: `rel-${to}-${kind}`,
  targetSystemId: to,
  kind,
  status: "candidate",
  date: AT,
  ...over,
});

describe("activity: one figure, two readers", () => {
  const ctx = { source: "Outlet · u", date: AT };
  it("is one record when one reader left out the unit", () => {
    const h = toActivity(
      {
        key: "launch_count",
        label: "Launches",
        value: "2,800",
        evidence: "launched 2,800 drones in August",
      },
      ctx,
    )!;
    const ai = toActivity(
      {
        key: "launch_count",
        label: "Launches",
        value: "more than 2,800",
        raw: "more than 2,800",
        evidence: "launched more than 2,800 in August",
      },
      ctx,
    )!;
    const merged = withActivity([h], [ai]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.unit).toBe("drones");
  });

  it("stays two when the units or months differ", () => {
    const drones = toActivity(
      { key: "launch_count", label: "Launches", value: "24", evidence: "launched 24 drones" },
      ctx,
    )!;
    const missiles = toActivity(
      { key: "launch_count", label: "Launches", value: "24", evidence: "launched 24 missiles" },
      ctx,
    )!;
    expect(withActivity([drones], [missiles])).toHaveLength(2);
  });

  it("reads 'since May 2024' as the start of a running total", () => {
    expect(
      activityPeriod("Since May 2024, Russia launched 2,800 drones", AT, "2,800").period,
    ).toEqual({
      from: "2024-05-01",
      label: "since May 2024",
    });
  });
});

describe("the briefing digest", () => {
  it("does not change an entry's fingerprint when it has no activity", () => {
    const d = drone("a");
    const digest = buildSystemEvidenceDigest(d) as unknown as Record<string, unknown>;
    expect("activity" in digest).toBe(false);
  });
});

describe("relations: review findings", () => {
  it("lets an entry's own family pointer win over a parent's stale list", () => {
    const p2 = drone("p2", { variantIds: ["c"] });
    const p1 = drone("p1");
    const c = drone("c", { variantOfId: "p1" });
    expect(
      legacyRelationsToMigrate([p2, p1, c], AT)
        .get("c")
        ?.map((r) => r.targetSystemId),
    ).toEqual(["p1"]);
  });

  it("hides a counterpart rejected on one side though the other still lists it", () => {
    const a = drone("a", { counterpartIds: ["b"], relations: [claim("b", "counterpart_to")] });
    const b = drone("b", { counterpartIds: ["a"] });
    const rejected = withRelationReview(a, "rel-b-counterpart_to", "rejected", AT)!;
    expect(resolveRelations(rejected, [rejected, b])).toEqual([]);
    expect(resolveRelations(b, [rejected, b])).toEqual([]);
    expect(firstCounterparts([rejected, b]).size).toBe(0);
  });

  it("restores a family link the rejection removed when the rejection is taken back", () => {
    const c = drone("c", { variantOfId: "p", relations: [claim("p", "variant_of")] });
    const rejected = withRelationReview(c, "rel-p-variant_of", "rejected", AT)!;
    expect(rejected.variantOfId).toBeUndefined();
    expect(withRelationReview(rejected, "rel-p-variant_of", null, AT)!.variantOfId).toBe("p");
  });

  it("indexes each entry's first counterpart in one pass, from either side", () => {
    const a = drone("a", { counterpartIds: ["b"] });
    const b = drone("b");
    const idx = firstCounterparts([a, b]);
    expect(idx.get("a")?.id).toBe("b");
    expect(idx.get("b")?.id).toBe("a");
  });
});
