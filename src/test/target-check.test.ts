import { describe, expect, it } from "vitest";
import { attributeTarget, targetVerdict } from "@/entities/drone/target-check";

const RANGER =
  "The Ranger R10-3DX is capable of detecting micro drones as far away as 3 km (1.86 miles), pedestrians beyond six kilometers and vehicles at over 12 kilometers";
const micro = { key: "detection_range_micro_drones", label: "Micro drone detection range" };

describe("a figure for one target, filed under another", () => {
  it("reads the target an attribute is about", () => {
    expect(attributeTarget(micro)).toBe("uav");
    expect(attributeTarget({ key: "detection_range", label: "Detection range" })).toBeUndefined();
    expect(attributeTarget({ key: "range_drone_vs_vehicle" })).toBeUndefined();
  });

  it("fails the vehicles' figure read as the micro-drone range", () => {
    const v = targetVerdict(micro, "12 kilometers", RANGER);
    expect(v).toMatchObject({ applicable: true, verdict: "fail" });
  });

  it("passes the figure whose clause names its target", () => {
    expect(targetVerdict(micro, "3 km", RANGER)).toMatchObject({ verdict: "pass" });
  });

  it("is silent when the clause names no target", () => {
    expect(
      targetVerdict(micro, "5 km", "The radar has a detection range of 5 km in clear weather"),
    ).toEqual({ applicable: false });
  });

  it("reads unmanned aerial vehicles as drones, not vehicles", () => {
    expect(
      targetVerdict(
        { key: "range_uav", label: "Range from UAV" },
        "10",
        "a range of up to 10 km when released from unmanned aerial vehicles",
      ),
    ).toMatchObject({ verdict: "pass" });
  });

  it("does not split a figure at its thousands comma", () => {
    expect(
      targetVerdict(
        { key: "detection_range_vehicles", label: "Vehicle detection range" },
        "1,500 m",
        "detects drones at 800 m and vehicles at 1,500 m",
      ),
    ).toMatchObject({ verdict: "pass" });
  });
});
