import { describe, expect, it } from "vitest";
import { SEED_DRONES } from "@/entities/drone/seed";
import type { Drone } from "@/entities/drone/types";
import {
  linkExposure,
  radarSystems,
  segmentStatus,
  spectrumEntries,
} from "@/entities/normalization/spectrum-bands";

const entries = spectrumEntries(SEED_DRONES);

/**
 * A radar drone for the classification cases. Built here rather than taken from SEED_DRONES:
 * the Saab Giraffe 1X entry (an 8.5-10 GHz AESA) was retired from the seed as a duplicate of the
 * import-created giraffe-1x entry, and a seed-shaped fixture would make the engine's own tests
 * depend on what the seed happens to contain.
 */
const radarDrone = (): Drone =>
  ({
    id: "giraffe-1x",
    name: "Giraffe 1X",
    aliases: [],
    domain: "Land",
    origin: "SE",
    operators: [],
    propulsion: "Unknown",
    summary: "",
    specs: [],
    rf: [{ role: "unknown", band: "X-band radar (AESA)", freqMHz: [8500, 10000], notes: "radar" }],
    components: [],
    evolution: [],
    counterpartIds: [],
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
  }) as Drone;

describe("spectrum engine", () => {
  it("classifies jammers and radars", () => {
    expect(entries.some((e) => e.system === "Volnorez" && e.kind === "jammer")).toBe(true);
    expect(radarSystems(entries)).toEqual(expect.arrayContaining(["Tor-M2"]));
  });
  it("puts Giraffe 1X in X-band", () => {
    const x = segmentStatus(spectrumEntries([radarDrone()])).find((s) => s.segment.id === "x")!;
    expect(x.radars.map((r) => r.system)).toContain("Giraffe 1X");
  });
  it("Geran-2 GNSS is jammed by EDM4S", () => {
    const g = SEED_DRONES.find((d) => d.id === "geran-2")!;
    const gnss = linkExposure(g, entries).find((e) => e.link.role === "gnss")!;
    expect(gnss.exposure).toBe("jammed");
    expect(gnss.by).toContain("EDM4S SkyWiper");
  });
});
