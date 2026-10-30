import { describe, expect, it } from "vitest";
import { aliasFold } from "@/entities/drone/alias-policy";
import {
  addManualAlias,
  aliasView,
  approveAlias,
  buildConflictMap,
  intakeAliasClaims,
  migrateAliasList,
  moveAliasTo,
  rejectAlias,
  undoAliasMove,
  unsetAliasVerdict,
  adoptAliasList,
} from "@/entities/drone/alias-claims";
import type { Drone } from "@/entities/drone/types";

const NOW = "2026-10-27T00:00:00.000Z";

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
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("migrateAliasList", () => {
  it("turns the legacy list into verified legacy claims and keeps answering to it", () => {
    const migrated = migrateAliasList(
      drone("bars-b3ed", { name: "Bars", aliases: ["Ukrainian Bars", "БАРС"] }),
      NOW,
    );
    expect(migrated.aliasClaims).toHaveLength(2);
    for (const c of migrated.aliasClaims!) {
      expect(c.status).toBe("verified");
      expect(c.kind).toBe("legacy");
      expect(c.review).toBeUndefined();
    }
    expect(aliasView(migrated)).toEqual(["Ukrainian Bars", "БАРС"]);
  });

  it("collapses declension forms and mixed-script lookalikes to one claim per fold", () => {
    // The live geran list carried 8 inflected "Шахе*" forms plus the Latin-a lookalike.
    const migrated = migrateAliasList(
      drone("geran-2x1a", {
        name: "Geran-2",
        aliases: ["Шахед", "Шахедів", "Шахедах", "Шелахах", "Шелахaх", "Герані"],
      }),
      NOW,
    );
    expect(migrated.aliasClaims!.map((c) => c.alias)).toEqual(["Шахед", "Шелахах", "Герані"]);
    // Shortest forms win ties, later same-fold entries drop out.
    expect(aliasView(migrated)).toEqual(["Шахед", "Шелахах", "Герані"]);
  });

  it("materialises an empty claim list when every alias falls out of the policy", () => {
    // The live leleka-100 / volnorez entries carried nothing but their own Cyrillic name; the
    // first migration materialised claims only when at least one claim survived, so they kept
    // being re-converted on every pass instead of joining the claim system.
    const migrated = migrateAliasList(
      drone("leleka-100", {
        name: "Leleka-100",
        cyrillic: "Лелека-100",
        aliases: ["Лелека-100", "interceptor drones"],
      }),
      NOW,
    );
    expect(migrated.aliasClaims).toEqual([]);
    expect(migrated.aliases).toEqual([]);
  });

  it("stays idempotent and leaves entries without aliases alone", () => {
    const migrated = migrateAliasList(
      drone("bars-b3ed", { name: "Bars", aliases: ["Ukrainian Bars"] }),
      NOW,
    );
    expect(migrateAliasList(migrated)).toBe(migrated);
    expect(migrateAliasList(drone("y1", { aliases: [] })).aliasClaims).toBeUndefined();
  });
});

describe("adoptAliasList", () => {
  it("materialises a rewritten list on a claim-less entry exactly as the migration would", () => {
    const adopted = adoptAliasList(
      drone("agm-183a", { name: "AGM-183A", aliases: ["ARRW", "drone"] }),
      NOW,
    );
    // Only the distinctive alias becomes a claim; the generic phrase falls to the policy.
    expect(adopted.aliasClaims!.map((c) => c.alias)).toEqual(["ARRW"]);
    expect(adopted.aliasClaims![0]).toMatchObject({ status: "verified", kind: "legacy" });
    expect(adopted.aliases).toEqual(["ARRW"]);
  });

  it("re-derives the view of a governed entry and never claims its list silently", () => {
    const governed = migrateAliasList(
      drone("bars-b3ed", { name: "Bars", aliases: ["Ukrainian Bars"] }),
      NOW,
    );
    const drifted = {
      ...governed,
      aliases: ["Ukrainian Bars", "Bars interceptor drones", "interceptor drones"],
    };
    const adopted = adoptAliasList(drifted, NOW);
    // Claims are untouched - the class phrase is dropped from the view because no claim holds it,
    // not re-entered as truth. Whoever wants it must capture it through intake as a candidate.
    expect(adopted.aliasClaims).toBe(governed.aliasClaims);
    expect(adopted.aliases).toEqual(["Ukrainian Bars"]);
  });
});

describe("intakeAliasClaims", () => {
  it("captures a suggestion as a candidate and never enters the alias view", () => {
    const base = migrateAliasList(
      drone("bars-b3ed", { name: "Bars", aliases: ["Ukrainian Bars"] }),
      NOW,
    );
    const d = intakeAliasClaims(base, ["F7 Litavr", "Bars interceptor drones"], {
      at: NOW,
      source: "Test · https://example.com/a",
    });
    const candidates = d.aliasClaims!.filter((c) => c.status === "candidate");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.alias).toBe("F7 Litavr");
    expect(candidates[0]!.source).toBe("Test · https://example.com/a");
    expect(candidates[0]!.kind).toBeUndefined();
    expect(aliasView(d)).toEqual(["Ukrainian Bars"]);
  });

  it("a repeated suggestion in any inflection is a no-op: the first claim stands", () => {
    const base = intakeAliasClaims(drone("bars-b3ed", { name: "Bars" }), ["F7 Litavr"], {
      at: NOW,
    });
    const again = intakeAliasClaims(base, ["F7 Litavrs", "F7 Litavr"], { at: NOW });
    expect(again.aliasClaims).toHaveLength(1);
    expect(again.aliasClaims![0]!.source).toBeUndefined();
  });

  it("never claims its own name or Cyrillic identity, in any of their spellings", () => {
    const d = intakeAliasClaims(
      drone("geran-2x1a", { name: "Geran-2", cyrillic: "Герань-2" }),
      ["Geran-2", "Герань-2", "Geran2"],
      { at: NOW },
    );
    expect(d.aliasClaims).toBeUndefined();
  });

  it("flags a suggestion that is another entry's canonical identity", () => {
    const held = [
      drone("shahed-136a", { name: "Shahed-136", aliases: [] }),
      drone("shahed-238a", { name: "Shahed-238", aliases: [] }),
    ];
    const conflicts = buildConflictMap(held, "geran-2x1a");
    const d = intakeAliasClaims(drone("geran-2x1a", { name: "Geran-2" }), ["Shahed-136", "Bars"], {
      at: NOW,
      conflicts,
    });
    const shahed = d.aliasClaims!.find((c) => c.alias === "Shahed-136")!;
    const bars = d.aliasClaims!.find((c) => c.alias === "Bars")!;
    expect(shahed.conflictWithDroneIds).toEqual(["shahed-136a"]);
    expect(bars.conflictWithDroneIds).toBeUndefined();
  });
});

describe("alias verdicts", () => {
  it("approval files the candidate into the view; unsetting takes it back out", () => {
    const captured = intakeAliasClaims(drone("bars-b3ed", { name: "Bars" }), ["F7 Litavr"], {
      at: NOW,
    });
    const claimId = captured.aliasClaims![0]!.id;
    expect(captured.aliases).toEqual([]);
    const approved = approveAlias(captured, claimId, NOW)!;
    expect(aliasView(approved)).toEqual(["F7 Litavr"]);
    expect(approved.aliasClaims![0]!.status).toBe("verified");
    expect(approved.aliasClaims![0]!.review).toMatchObject({ verdict: "confirmed", by: "analyst" });
    const unsettled = unsetAliasVerdict(approved, claimId, NOW)!;
    expect(aliasView(unsettled)).toEqual([]);
    expect(unsettled.aliasClaims![0]!.status).toBe("candidate");
  });

  it("a rejected legacy alias returns to verified on undo, a candidate to candidate", () => {
    const base = migrateAliasList(
      drone("bars-b3ed", { name: "Bars", aliases: ["Ukrainian Bars"] }),
      NOW,
    );
    const claimId = base.aliasClaims![0]!.id;
    const rejected = rejectAlias(base, claimId, NOW)!;
    expect(aliasView(rejected)).toEqual([]);
    const undone = unsetAliasVerdict(rejected, claimId, NOW)!;
    expect(aliasView(undone)).toEqual(["Ukrainian Bars"]);
    expect(undone.aliasClaims![0]!.status).toBe("verified");
  });
});

describe("addManualAlias", () => {
  it("registers an analyst alias as verified immediately and upgrades an earlier suggestion", () => {
    const captured = intakeAliasClaims(drone("bars-b3ed", { name: "Bars" }), ["F7 Litavr"], {
      at: NOW,
    });
    const added = addManualAlias(captured, "F7 Litavr", NOW)!;
    expect(added.aliasClaims).toHaveLength(1);
    expect(added.aliasClaims![0]!.status).toBe("verified");
    expect(added.aliasClaims![0]!.review).toMatchObject({ verdict: "confirmed", by: "analyst" });
    expect(aliasView(added)).toEqual(["F7 Litavr"]);
  });

  it("never accepts its own canonical names or a class phrase", () => {
    expect(addManualAlias(drone("bars", { name: "Bars" }), "Bars", NOW)).toBeUndefined();
    expect(
      addManualAlias(drone("bars", { name: "Bars" }), "interceptor drones", NOW),
    ).toBeUndefined();
  });
});

describe("moveAliasTo / undoAliasMove", () => {
  it("files the alias under the right system and takes it out of the wrong one", () => {
    const source = migrateAliasList(drone("bars-b3ed", { name: "Bars", aliases: ["Osa-AK"] }), NOW);
    const target = drone("osa-x2", { name: "Osa" });
    expect(aliasFold("Osa-AK")).not.toBe(aliasFold("Osa"));
    const claimId = source.aliasClaims![0]!.id;
    const moved = moveAliasTo(source, claimId, target, NOW)!;
    expect(aliasView(moved.source)).toEqual([]);
    expect(moved.source.aliasClaims![0]!.status).toBe("rejected");
    expect(moved.source.aliasClaims![0]!.review?.movedToDroneId).toBe("osa-x2");
    expect(aliasView(moved.target)).toEqual(["Osa-AK"]);
    const moveId = moved.source.aliasClaims![0]!.review?.moveId;
    expect(moved.target.aliasClaims![0]!.review).toMatchObject({
      movedFromDroneId: "bars-b3ed",
      moveId,
    });

    const undone = undoAliasMove(moved.source, claimId, moved.target, NOW)!;
    expect(aliasView(undone.source)).toEqual(["Osa-AK"]);
    expect(undone.source.aliasClaims![0]!.review).toBeUndefined();
    expect(aliasView(undone.target)).toEqual([]);
    expect(undone.target.aliasClaims![0]!.status).toBe("candidate");
  });

  it("upgrades the target's own not-yet-approved spelling instead of duplicating it", () => {
    const source = migrateAliasList(drone("bars-b3ed", { name: "Bars", aliases: ["Osa-AK"] }), NOW);
    const target: Drone = {
      ...drone("osa-x2", { name: "Osa" }),
      aliasClaims: [
        {
          id: `alias-${aliasFold("Osa-AK")}`,
          alias: "Osa AK",
          status: "candidate",
          firstSeen: NOW,
        },
      ],
    };
    const moved = moveAliasTo(source, source.aliasClaims![0]!.id, target, NOW)!;
    expect(moved.target.aliasClaims).toHaveLength(1);
    expect(moved.target.aliasClaims![0]!.alias).toBe("Osa AK");
    expect(moved.target.aliasClaims![0]!.status).toBe("verified");
    expect(aliasView(moved.target)).toEqual(["Osa AK"]);
  });

  it("moving to a target that already answers to the name only drops the source claim", () => {
    const source = migrateAliasList(
      drone("shahed-238a", { name: "Shahed-238", aliases: ["Shahed-136"] }),
      NOW,
    );
    const target = drone("shahed-136a", { name: "Shahed-136" });
    const moved = moveAliasTo(source, source.aliasClaims![0]!.id, target, NOW)!;
    expect(moved.target).toBe(target);
    expect(aliasView(moved.source)).toEqual([]);
    expect(moved.source.aliasClaims![0]!.review?.moveId).toBeDefined();
    const undone = undoAliasMove(moved.source, source.aliasClaims![0]!.id, moved.target, NOW)!;
    expect(aliasView(undone.source)).toEqual(["Shahed-136"]);
    expect(aliasView(undone.target)).toEqual([]);
  });
});
