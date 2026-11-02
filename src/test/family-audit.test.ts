import { describe, expect, it } from "vitest";
import { familyProposals } from "@/entities/drone/family-audit";
import {
  legacyRelationsToMigrate,
  storedEdges,
  withDeclinedRelation,
  withDistinct,
} from "@/entities/drone/system-hierarchy";
import type { AliasClaim, Drone } from "@/entities/drone/types";

const AT = "2026-11-02T00:00:00.000Z";

const alias = (a: string, over: Partial<AliasClaim> = {}): AliasClaim => ({
  id: `alias-${a}`,
  alias: a,
  status: "verified",
  firstSeen: AT,
  ...over,
});

const drone = (id: string, name: string, over: Partial<Drone> = {}): Drone => ({
  id,
  name,
  aliases: (over.aliasClaims ?? []).filter((c) => c.status === "verified").map((c) => c.alias),
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

// The live catalogue's shape: a family carrying a designation, a variant's identity on another
// entry, and a second family entry under the Russian name with most of the same aliases.
const familyNames = ["Shahed", "Shahed drones", "Gerans", "Shahed strike drones", "Geran family"];
const geran = drone("geran", "Geran", {
  aliasClaims: [...familyNames.map((a) => alias(a)), alias("Shahed-136")],
});
const g2 = drone("geran-2", "Geran-2", { aliasClaims: [alias("Shahed-136")] });
const g3 = drone("geran-3", "Geran-3", { variantOfId: "geran" });
const g4 = drone("geran-4", "Geran-4");
const s131 = drone("shahed-131", "Shahed-131", { aliasClaims: [alias("Geran")] });
const dup = drone("shahed-ru", "Шахед", {
  aliasClaims: [...familyNames, "Geran"].map((a) => alias(a)),
  createdAt: "2026-10-30T00:00:00.000Z",
});
const catalog = [geran, g2, g3, g4, s131, dup];
const ids = (kind: string) =>
  familyProposals(catalog)
    .filter((p) => p.kind === kind)
    .map((p) => p.id);

describe("the family audit", () => {
  it("proposes the entry others are numbered after as a family", () => {
    expect(ids("family_class")).toContain("family_class:geran");
  });

  it("proposes linking each numbered variant not yet linked, and only those", () => {
    const links = ids("variant_link");
    expect(links.filter((id) => id.endsWith(":geran"))).toEqual([
      "variant_link:geran-2:geran",
      "variant_link:geran-4:geran",
    ]);
    // Geran-3 is linked already; Shahed-131 is numbered after the other spelling, Шахед.
    expect(links).toContain("variant_link:shahed-131:shahed-ru");
  });

  it("finds names filed in the wrong place", () => {
    const found = ids("alias_conflict");
    // A designation on the family, and the family's own name on another entry.
    expect(found).toContain("alias_conflict:geran:alias-Shahed-136");
    expect(found).toContain("alias_conflict:shahed-131:alias-Geran");
    // A variant's own export designation is where it belongs.
    expect(found).not.toContain("alias_conflict:geran-2:alias-Shahed-136");
  });

  it("proposes one merge for one family under two entries, keeping the older", () => {
    expect(ids("merge")).toEqual(["merge:geran:shahed-ru"]);
  });

  it("does not propose again what the analyst turned down", () => {
    const declined = withDeclinedRelation(g4, "geran", "variant_of", AT);
    const apart = [withDistinct(geran, "shahed-ru", AT), withDistinct(dup, "geran", AT)];
    const next = familyProposals([apart[0]!, g2, g3, declined, s131, apart[1]!]);
    expect(next.map((p) => p.id)).not.toContain("variant_link:geran-4:geran");
    expect(next.filter((p) => p.kind === "merge")).toEqual([]);
    expect(storedEdges(declined)).toEqual([]);
  });

  it("leaves an alias the analyst has ruled on alone", () => {
    const ruled = drone("shahed-131", "Shahed-131", {
      aliasClaims: [alias("Geran", { review: { verdict: "confirmed", at: AT, by: "analyst" } })],
    });
    expect(familyProposals([geran, ruled]).some((p) => p.id.includes("shahed-131"))).toBe(false);
  });
});

describe("copying the legacy links into typed relations", () => {
  it("files each link once, on the entry that depends on the other", () => {
    const parent = drone("geran", "Geran", { variantIds: ["geran-5"] });
    const child5 = drone("geran-5", "Geran-5");
    const a = drone("a", "A", { counterpartIds: ["b"] });
    const b = drone("b", "B", { counterpartIds: ["a"] });
    const m = legacyRelationsToMigrate([parent, child5, g3, a, b], AT);
    expect(m.get("geran-5")?.map((r) => `${r.kind}:${r.targetSystemId}`)).toEqual([
      "variant_of:geran",
    ]);
    expect(m.get("geran-3")?.map((r) => r.kind)).toEqual(["variant_of"]);
    expect(m.get("a")?.map((r) => r.kind)).toEqual(["counterpart_to"]);
    expect(m.has("b")).toBe(false);
  });

  it("never gives an entry a second family, nor restates a typed claim", () => {
    const child = drone("c", "C", {
      variantOfId: "p1",
      relations: [
        { id: "x", targetSystemId: "p1", kind: "variant_of", status: "rejected", date: AT },
      ],
    });
    const p2 = drone("p2", "P2", { variantIds: ["c"] });
    const p1 = drone("p1", "P1");
    expect(legacyRelationsToMigrate([child, p1, p2], AT).has("c")).toBe(false);
  });
});
