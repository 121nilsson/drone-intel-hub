import { describe, expect, it } from "vitest";
import { parseModelJson } from "@/shared/infra/model-json";

describe("parseModelJson", () => {
  it("parses a plain object", () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips a think block and a code fence", () => {
    expect(parseModelJson('<think>maybe {"a":0}</think>\n```json\n{"a":1}\n```')).toEqual({
      a: 1,
    });
  });

  it("unwraps a double-encoded object", () => {
    expect(parseModelJson(JSON.stringify('{"a":1}'))).toEqual({ a: 1 });
  });

  it("finds the object inside surrounding prose", () => {
    expect(parseModelJson('Here is the result: {"a":1}. Hope that helps.')).toEqual({ a: 1 });
  });

  it("returns undefined for no object, an array, or nothing", () => {
    expect(parseModelJson("I cannot help with that.")).toBeUndefined();
    expect(parseModelJson("[1,2]")).toBeUndefined();
    expect(parseModelJson("")).toBeUndefined();
  });
});
