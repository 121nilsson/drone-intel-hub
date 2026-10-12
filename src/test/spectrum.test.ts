import { describe, expect, it } from "vitest";
import { SEED_DRONES } from "@/entities/drone/seed";
import {
  linkExposure,
  radarSystems,
  segmentStatus,
  spectrumEntries,
} from "@/entities/normalization/spectrum-bands";

const entries = spectrumEntries(SEED_DRONES);

describe("spectrum engine", () => {
  it("classifies jammers and radars", () => {
    expect(entries.some((e) => e.system === "Volnorez" && e.kind === "jammer")).toBe(true);
    expect(radarSystems(entries)).toEqual(expect.arrayContaining(["Tor-M2", "Saab Giraffe 1X"]));
  });
  it("puts Giraffe 1X in X-band", () => {
    const x = segmentStatus(entries).find((s) => s.segment.id === "x")!;
    expect(x.radars.map((r) => r.system)).toContain("Saab Giraffe 1X");
  });
  it("Geran-2 GNSS is jammed by EDM4S", () => {
    const g = SEED_DRONES.find((d) => d.id === "geran-2")!;
    const gnss = linkExposure(g, entries).find((e) => e.link.role === "gnss")!;
    expect(gnss.exposure).toBe("jammed");
    expect(gnss.by).toContain("EDM4S SkyWiper");
  });
});
