import { beforeEach, describe, expect, it } from "vitest";
import { termId } from "@/entities/normalization/taxonomy";
import { LocalDroneRepository, LocalTaxonomyCandidateRepository, LocalTaxonomyRepository } from "@/shared/infra/local-repository";
import { LocalStorageStore } from "@/shared/infra/local-store";
import type { Drone } from "@/entities/drone/types";

beforeEach(() => localStorage.clear());

describe("taxonomy store", () => {
  it("seeds terms when the store is empty and lets a stored alias replace the seed", async () => {
    const store = new LocalStorageStore();
    const first = new LocalTaxonomyRepository();
    await first.attach(store);
    expect(first.terms("propulsion").some((t) => t.canonicalId === "piston")).toBe(true);

    const piston = first.terms("propulsion").find((t) => t.canonicalId === "piston")!;
    first.upsertTerm({ ...piston, aliases: [...piston.aliases, "moped motor"], origin: "db" });

    const second = new LocalTaxonomyRepository();
    await second.attach(store);
    expect(second.terms("propulsion").find((t) => t.id === termId("propulsion", "piston"))?.aliases).toContain("moped motor");
    expect(second.terms("propulsion").some((t) => t.canonicalId === "electric")).toBe(true);
  });

  it("counts a repeated source once", async () => {
    const repo = new LocalTaxonomyCandidateRepository();
    await repo.attach(new LocalStorageStore());
    repo.record("pulsejet", "propulsion", { source: "Telegram" });
    repo.record("pulsejet", "propulsion", { source: "Telegram" });
    const again = repo.record("pulsejet", "propulsion", { source: "Janes" });
    expect(again.occurrences).toBe(2);
    expect(repo.list()).toHaveLength(1);
  });
});

describe("catalog facets on normalized values", () => {
  it("finds a mislabeled L-band link by the frequency, and splits tracked electric", () => {
    const repo = new LocalDroneRepository();
    const drone: Drone = {
      id: "mislabeled",
      name: "Mislabeled",
      aliases: [],
      domain: "Air",
      origin: "RU",
      operators: ["RU"],
      propulsion: "Electric",
      installation: "Tracked",
      summary: "",
      specs: [],
      rf: [{ role: "video", band: "L", freqMHz: [868, 915] }],
      components: [],
      evolution: [],
      counterpartIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    repo.upsert(drone);
    expect(repo.search("", { ieeeBands: ["UHF"] }).some((d) => d.id === "mislabeled")).toBe(true);
    expect(repo.search("", { ieeeBands: ["L"] }).some((d) => d.id === "mislabeled")).toBe(false);
    expect(repo.search("", { propulsionIds: ["electric"], installationIds: ["tracked"] }).some((d) => d.id === "mislabeled")).toBe(true);
    expect(repo.search("", { bands: ["L"] }).some((d) => d.id === "mislabeled")).toBe(true);
  });
});
