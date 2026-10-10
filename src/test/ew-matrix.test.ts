import { describe, expect, it } from "vitest";
import { assessLink, ewEmitters } from "@/entities/normalization/ew-matrix";
import type { Drone } from "@/entities/drone/types";

const jam = [{ label: "Trench jammer", freqMHz: [700, 1000] as [number, number] }];

describe("EW matrix", () => {
  it("fiber links are immune", () => {
    expect(assessLink({ role: "tether", band: "fiber spool" }, jam, false).verdict).toBe(
      "fiber_immune",
    );
  });
  it("full coverage is jammed", () => {
    expect(
      assessLink({ role: "uplink", band: "UHF", freqMHz: [720, 750] }, jam, false).verdict,
    ).toBe("jammed");
  });
  it("partial coverage is contested", () => {
    expect(
      assessLink({ role: "uplink", band: "UHF", freqMHz: [900, 1300] }, jam, false).verdict,
    ).toBe("contested");
  });
  it("anti-jam GNSS is contested not jammed", () => {
    const j = [{ label: "GNSS jammer", freqMHz: [1550, 1610] as [number, number] }];
    expect(assessLink({ role: "gnss", band: "L1", freqMHz: [1575, 1576] }, j, true).verdict).toBe(
      "contested",
    );
  });
  it("out of band is safe", () => {
    expect(
      assessLink({ role: "video", band: "5.8", freqMHz: [5650, 5950] }, jam, false).verdict,
    ).toBe("safe");
  });
  it("finds jammer emitters but not anti-jam receivers", () => {
    const d = {
      rf: [
        { role: "unknown", band: "Onboard jammer", freqMHz: [800, 950] },
        { role: "antijam", band: "Kometa-M CRPA" },
      ],
      payloads: [],
    } as unknown as Drone;
    expect(ewEmitters(d)).toHaveLength(1);
  });
});
