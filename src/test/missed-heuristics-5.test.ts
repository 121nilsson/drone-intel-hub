import { describe, expect, it } from "vitest";
import { extractClassSpecs } from "@/shared/infra/heuristics";

function specs(raw: string) {
  const out: Array<{ key: string; value: number | string; unit: string | undefined }> = [];
  extractClassSpecs(raw, (key, _l, value, unit) => out.push({ key, value, unit }));
  return out;
}

describe("USV extractor", () => {
  it("reads speed in knots, including Ukrainian", () => {
    expect(specs("The unmanned boat reaches a speed of up to 42 knots")).toContainEqual({
      key: "speed",
      value: 42,
      unit: "kn",
    });
    expect(specs("розвиває швидкість до 45 вузлів")).toContainEqual({
      key: "speed",
      value: 45,
      unit: "kn",
    });
  });

  it("reads range in nautical miles, including Ukrainian", () => {
    expect(specs("a range of 700 nautical miles")).toContainEqual({
      key: "range",
      value: 700,
      unit: "nmi",
    });
    expect(specs("дальність ходу — 700 морських миль")).toContainEqual({
      key: "range",
      value: 700,
      unit: "nmi",
    });
  });

  it("reads hull draft, including Ukrainian", () => {
    expect(specs("with a draft of 0.8 m")).toContainEqual({
      key: "draft",
      value: 0.8,
      unit: "m",
    });
    expect(specs("осадка 0,8 м")).toContainEqual({ key: "draft", value: 0.8, unit: "m" });
  });

  it("counts endurance in days, once per claim", () => {
    expect(specs("it has an endurance of 3 days").filter((x) => x.key === "endurance")).toEqual([
      { key: "endurance", value: 3, unit: "d" },
    ]);
    expect(specs("автономність — до 3 діб")).toContainEqual({
      key: "endurance",
      value: 3,
      unit: "d",
    });
  });

  it("does not read the military draft or a radar envelope as own figures", () => {
    expect(
      specs("the military draft covers 200,000 men").filter((x) => x.key === "draft"),
    ).toHaveLength(0);
    expect(
      specs("detection range up to 15 nautical miles").filter((x) => x.key === "range"),
    ).toHaveLength(0);
  });
});
