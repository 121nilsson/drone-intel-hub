import { describe, expect, it } from "vitest";
import { normalizeExtraction } from "@/entities/normalization/apply";
import { HeuristicExtractor } from "@/shared/infra/heuristic-ai";
import { comparableSpecs } from "@/shared/infra/evaluation/evaluation";

/**
 * Readings the evaluation showed the heuristic missing or misreading, each from a live report.
 */
const heuristic = new HeuristicExtractor(1);
const read = async (text: string) =>
  comparableSpecs(normalizeExtraction(await heuristic.extract(text, [])).extraction);
const bySemantic = async (text: string, semantic: string) =>
  (await read(text)).filter((n) => n.semantic === semantic).map((n) => Math.round(n.canonical!));

describe("top speed", () => {
  it("reads a stated top speed in any unit the report used", async () => {
    expect(await bySemantic("Max Speed55kt", "speed.max")).toEqual([102]);
    expect(await bySemantic("The drone can fly up to 150 mph.", "speed.max")).toEqual([241]);
    expect(await bySemantic("Ракета имеет скорость до 2,5 Махов.", "speed.max")).toEqual([3063]);
    expect(await bySemantic("максимальная скорость до 2,5 Махов", "speed.max")).toEqual([3063]);
    expect(
      await bySemantic("Дрон може розвивати максимальну швидкість до 700 км/год.", "speed.max"),
    ).toEqual([700]);
  });

  it("does not also file the top speed as a cruise speed", async () => {
    const specs = await read("It has a maximum speed of 700 km/h.");
    expect(specs.map((s) => s.semantic)).toEqual(["speed.max"]);
  });
});

describe("cruise and plain speed", () => {
  it("files a cruise speed only when the report says cruise", async () => {
    expect(await bySemantic("The drone cruises at 180 km/h.", "speed.cruise")).toEqual([180]);
    expect(await bySemantic("крейсерська швидкість 150 км/год", "speed.cruise")).toEqual([150]);
  });

  it("files a speed the report does not qualify as a stated speed, not as cruise", async () => {
    const text = "The Geran-2 reached 185 km/h over the city.";
    expect(await bySemantic(text, "speed.stated")).toEqual([185]);
    expect(await bySemantic(text, "speed.cruise")).toEqual([]);
  });
});

describe("counted equipment", () => {
  it("does not read an array's elements as antennas", async () => {
    const text = "Russian drones carried Chinese-sourced modules with 16 antenna elements.";
    expect(await bySemantic(text, "sensor.antenna.count")).toEqual([]);
    expect(
      await bySemantic("The jammer has 12 antennas on the turret.", "sensor.antenna.count"),
    ).toEqual([12]);
  });

  it("does not read the tail of a thousands figure as a count", async () => {
    expect(
      await bySemantic("The network had 10,000 cameras installed.", "sensor.camera.count"),
    ).toEqual([]);
  });
});
