import { describe, expect, it } from "vitest";
import { payloadSpecs, sensorSpecs } from "@/entities/drone/observations";
import type { Drone, SpecAttribute } from "@/entities/drone/types";

const spec = (key: string, label: string, semantic?: string): SpecAttribute => ({
  key,
  label,
  ...(semantic ? { semantic } : {}),
  discoveredBy: "ai",
  claims: [],
});

const drone = (specs: SpecAttribute[]): Drone => ({
  id: "geran-5",
  name: "Geran-5",
  aliases: [],
  domain: "Air",
  origin: "RU",
  operators: [],
  propulsion: "Unknown",
  summary: "",
  specs,
  rf: [],
  components: [],
  evolution: [],
  counterpartIds: [],
  createdAt: "",
  updatedAt: "",
});

describe("the payload and sensor facts of an entry", () => {
  it("finds the payload and sensor figures among the specs", () => {
    const d = drone([
      spec("payload_capacity", "Payload capacity", "payload.capacity"),
      spec("warhead", "Warhead", "payload.warhead"),
      spec("range", "Range", "range.max"),
      spec("cameras", "Onboard cameras"),
      spec("weight_launch", "Launch weight", "weight.launch"),
    ]);
    expect(payloadSpecs(d).map((s) => s.key)).toEqual(["payload_capacity", "warhead"]);
    // "Onboard cameras" resolves to sensor.camera.count by its key and label.
    expect(sensorSpecs(d).map((s) => s.key)).toEqual(["cameras"]);
  });

  it("reads a spec with no semantic of its own from its key and label", () => {
    const d = drone([
      spec("payload_mass", "Payload mass"),
      spec("cameras", "Onboard cameras"),
      spec("warhead_weight", "Warhead weight", "payload.warhead"),
    ]);
    expect(payloadSpecs(d).map((s) => s.key)).toEqual(["payload_mass", "warhead_weight"]);
    expect(sensorSpecs(d).map((s) => s.key)).toEqual(["cameras"]);
  });

  it("leaves a system with neither empty", () => {
    const d = drone([spec("range", "Range", "range.max"), spec("speed", "Speed", "speed.max")]);
    expect(payloadSpecs(d)).toEqual([]);
    expect(sensorSpecs(d)).toEqual([]);
  });
});
