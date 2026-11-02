import { describe, expect, it } from "vitest";
import {
  legacyRelationsToMigrate,
  withDeclinedRelation,
  compileEffectiveSpecs,
  familyRoot,
  lineage,
  relationProblem,
  resolveRelations,
  retargetRelations,
  storedEdges,
  withRelation,
  withRelationReview,
  withoutRelationsTo,
} from "@/entities/drone/system-hierarchy";
import { linkSystems, unlinkSystems } from "@/shared/infra/catalog-operations";
import type { Drone, SystemRelationClaim } from "@/entities/drone/types";
import type { DroneRepository } from "@/shared/contracts/repository";

const AT = "2026-11-01T00:00:00.000Z";

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

const rel = (
  targetSystemId: string,
  kind: SystemRelationClaim["kind"],
  over: Partial<SystemRelationClaim> = {},
): SystemRelationClaim => ({
  id: `rel-${targetSystemId}-${kind}`,
  targetSystemId,
  kind,
  status: "verified",
  date: AT,
  ...over,
});

/** An in-memory repository with the two methods the operations use. */
const repo = (entries: Drone[]) => {
  const byId = new Map(entries.map((d) => [d.id, d]));
  return {
    byId,
    drones: {
      get: (id: string) => byId.get(id),
      list: () => [...byId.values()],
      upsert: (d: Drone) => void byId.set(d.id, d),
    } as unknown as DroneRepository,
  };
};

describe("reading relations", () => {
  it("reads typed relations and legacy links as one set, each once", () => {
    const d = drone("geran-3", {
      variantOfId: "geran",
      counterpartIds: ["lancet"],
      relations: [rel("geran", "variant_of")],
    });
    expect(storedEdges(d).map((e) => `${e.kind}:${e.to}`)).toEqual([
      "variant_of:geran",
      "counterpart_to:lancet",
    ]);
  });

  it("does not revive a legacy link the analyst rejected as a typed relation", () => {
    const d = drone("shahed-131", {
      variantOfId: "geran-2",
      relations: [
        rel("geran-2", "variant_of", {
          status: "candidate",
          review: { verdict: "rejected", by: "analyst", at: AT },
        }),
      ],
    });
    expect(storedEdges(d)).toEqual([]);
  });

  it("shows each relation from the other end through its inverse", () => {
    const geran = drone("geran", { systemClass: "family" });
    const g3 = drone("geran-3", { relations: [rel("geran", "variant_of")] });
    const lancet = drone("lancet", { counterpartIds: ["geran"] });
    const views = resolveRelations(geran, [geran, g3, lancet]);
    expect(views.map((v) => `${v.displayKind}:${v.target.id}:${v.direction}`)).toEqual([
      "has_variant:geran-3:incoming",
      "counterpart_to:lancet:symmetric",
    ]);
  });

  it("lists a counterpart once even when both sides state it", () => {
    const a = drone("a", { counterpartIds: ["b"] });
    const b = drone("b", { counterpartIds: ["a"] });
    expect(resolveRelations(a, [a, b])).toHaveLength(1);
  });

  it("reads a parent's legacy variant list, and drops links to entries that are gone", () => {
    const parent = drone("geran", { variantIds: ["geran-5", "deleted"] });
    const g5 = drone("geran-5");
    expect(resolveRelations(parent, [parent, g5]).map((v) => v.target.id)).toEqual(["geran-5"]);
  });
});

describe("families and lineage", () => {
  const geran = drone("geran", { systemClass: "family" });
  const g2 = drone("geran-2", { relations: [rel("geran", "variant_of")] });
  const s131 = drone("shahed-131", { relations: [rel("geran-2", "derived_from")] });

  it("walks up to the family", () => {
    const all = [geran, g2, s131];
    expect(lineage(s131, all).map((d) => d.id)).toEqual(["geran-2", "geran"]);
    expect(familyRoot(s131, all).id).toBe("geran");
    expect(familyRoot(geran, all).id).toBe("geran");
  });

  it("stops at a cycle instead of walking forever", () => {
    const a = drone("a", { variantOfId: "b" });
    const b = drone("b", { variantOfId: "a" });
    expect(lineage(a, [a, b]).map((d) => d.id)).toEqual(["b"]);
  });
});

describe("what may be stored", () => {
  const geran = drone("geran");
  const g2 = drone("geran-2", { relations: [rel("geran", "variant_of")] });
  const all = [geran, g2];

  it("refuses a link to itself, a duplicate, a display-only kind and a variant cycle", () => {
    expect(relationProblem(geran, geran, "variant_of", all)).toMatch(/itself/);
    expect(relationProblem(g2, geran, "variant_of", all)).toMatch(/already exists/);
    expect(relationProblem(g2, geran, "has_variant", all)).toMatch(/not a stored/);
    expect(relationProblem(geran, g2, "variant_of", all)).toMatch(/descends/);
    expect(relationProblem(geran, g2, "counterpart_to", all)).toBeUndefined();
  });

  it("stores one counterpart, not one per side", () => {
    const a = drone("a", { counterpartIds: ["b"] });
    const b = drone("b");
    expect(relationProblem(b, a, "counterpart_to", [a, b])).toMatch(/already exists/);
  });
});

describe("changing relations", () => {
  it("stores a link as the analyst's and keeps the legacy fields in step", () => {
    const geran = drone("geran");
    const g3 = withRelation(drone("geran-3"), geran, "variant_of", [geran], AT);
    expect(g3.relations?.[0]).toMatchObject({
      kind: "variant_of",
      status: "verified",
      review: { verdict: "confirmed" },
    });
    expect(g3.variantOfId).toBe("geran");
  });

  it("unlinks on both sides, legacy fields included, so the repair cannot bring it back", () => {
    const r = repo([
      drone("a", {
        counterpartIds: ["b"],
        variantOfId: "b",
        relations: [rel("b", "counterpart_to")],
      }),
      drone("b", { counterpartIds: ["a"], variantIds: ["a"] }),
    ]);
    unlinkSystems("a", "b", r);
    expect(storedEdges(r.byId.get("a")!)).toEqual([]);
    expect(r.byId.get("a")!.variantOfId).toBeUndefined();
    expect(r.byId.get("b")!.counterpartIds).toEqual([]);
    expect(r.byId.get("b")!.variantIds).toEqual([]);
  });

  it("refuses to store what relationProblem refuses", () => {
    const r = repo([drone("a"), drone("b", { relations: [rel("a", "variant_of")] })]);
    expect(linkSystems("a", "b", "variant_of", r)).toBeUndefined();
    expect(linkSystems("a", "b", "carried_by", r)?.relations?.[0]?.kind).toBe("carried_by");
  });

  it("points relations at the entry that remains after a merge, never at itself", () => {
    const d = drone("g3", { relations: [rel("old", "variant_of"), rel("keep", "variant_of")] });
    expect(retargetRelations(d, "old", "keep").relations?.map((x) => x.targetSystemId)).toEqual([
      "keep",
    ]);
    const self = drone("keep", { relations: [rel("old", "counterpart_to")] });
    expect(retargetRelations(self, "old", "keep").relations).toEqual([]);
  });

  it("records the analyst's verdict on a suggested relation, and takes it back", () => {
    const d = drone("g3", { relations: [rel("geran", "variant_of", { status: "candidate" })] });
    const confirmed = withRelationReview(d, "rel-geran-variant_of", "confirmed", AT)!;
    expect(storedEdges(confirmed)).toHaveLength(1);
    expect(storedEdges(withRelationReview(confirmed, "rel-geran-variant_of", null, AT)!)).toEqual(
      [],
    );
    expect(withoutRelationsTo(confirmed, "geran", AT).relations).toEqual([]);
  });
});

describe("review findings", () => {
  it("leaves an existing link standing while a suggestion for it is pending", () => {
    const d = drone("d", {
      variantOfId: "a",
      relations: [rel("a", "variant_of", { status: "candidate" })],
    });
    expect(storedEdges(d).map((e) => e.to)).toEqual(["a"]);
  });

  it("refuses a second family instead of replacing the first", () => {
    const a = drone("a");
    const b = drone("b");
    const d = drone("d", { variantOfId: "a" });
    expect(relationProblem(d, b, "variant_of", [a, b, d])).toMatch(/already a variant/);
  });

  it("keeps the legacy mirror in step with a review", () => {
    const d = drone("d", { relations: [rel("a", "variant_of", { status: "candidate" })] });
    const yes = withRelationReview(d, "rel-a-variant_of", "confirmed", AT)!;
    expect(yes.variantOfId).toBe("a");
    expect(
      withRelationReview(yes, "rel-a-variant_of", "rejected", AT)!.variantOfId,
    ).toBeUndefined();
  });
});

describe("an unlink stays unlinked", () => {
  it("survives the pipeline writing the legacy link again, and the repair", () => {
    const r = repo([drone("a", { counterpartIds: ["b"] }), drone("b", { counterpartIds: ["a"] })]);
    unlinkSystems("a", "b", r);
    // A later report names both: the pipeline puts the legacy link back on both sides.
    const a = { ...r.byId.get("a")!, counterpartIds: ["b"] };
    const b = { ...r.byId.get("b")!, counterpartIds: ["a"] };
    expect(storedEdges(a)).toEqual([]);
    expect(storedEdges(b)).toEqual([]);
    expect(legacyRelationsToMigrate([a, b], AT).size).toBe(0);
  });

  it("hides a turned-down variant though the parent still lists it", () => {
    const parent = drone("p", { variantIds: ["c"] });
    const child = withDeclinedRelation(drone("c"), "p", "variant_of", AT);
    expect(resolveRelations(parent, [parent, child])).toEqual([]);
    expect(lineage(child, [parent, child])).toEqual([]);
  });

  it("takes back only the link its own confirmation wrote", () => {
    const fresh = drone("c", { relations: [rel("p", "variant_of", { status: "candidate" })] });
    const confirmed = withRelationReview(fresh, "rel-p-variant_of", "confirmed", AT)!;
    expect(
      withRelationReview(confirmed, "rel-p-variant_of", null, AT)!.variantOfId,
    ).toBeUndefined();
    const older = drone("c", {
      variantOfId: "p",
      relations: [rel("p", "variant_of", { status: "candidate" })],
    });
    const again = withRelationReview(older, "rel-p-variant_of", "confirmed", AT)!;
    expect(withRelationReview(again, "rel-p-variant_of", null, AT)!.variantOfId).toBe("p");
  });
});

describe("inherited specs in a comparison", () => {
  it("labels the parent's figures as the parent's and never touches the stored ones", () => {
    const parentSpec = {
      key: "range",
      label: "Range",
      unit: "km",
      discoveredBy: "ai" as const,
      claims: [{ value: 2000, source: "s", date: AT }],
    };
    const parent = drone("geran-2", { specs: [parentSpec] });
    const child = drone("geran-3", {
      specs: [
        {
          key: "speed_max",
          label: "Max speed",
          unit: "km/h",
          discoveredBy: "ai",
          claims: [{ value: 600, source: "s", date: AT }],
        },
      ],
    });
    const view = compileEffectiveSpecs(child, parent);
    expect(view.map((v) => `${v.spec.key}:${v.source}`)).toEqual([
      "speed_max:own",
      "range:inherited",
    ]);
    expect(view[1]!.inheritedFrom).toEqual({ id: "geran-2", name: "geran-2" });
    view[1]!.spec.claims.push({ value: 1, source: "x", date: AT });
    expect(parent.specs[0]!.claims).toHaveLength(1);
  });
});
