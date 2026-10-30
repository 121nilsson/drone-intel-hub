import { describe, expect, it } from "vitest";
import { humanizeBriefItem, parseModelJson, stripPointerNotation } from "@/shared/infra/model-json";

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

describe("stripPointerNotation", () => {
  it("removes the digest references a model copies as a citation parenthetical", () => {
    expect(
      stripPointerNotation(
        "Wikipedia infobox: wingspan 2.5 m (specifications.wingspan.claims[0].value)",
      ),
    ).toBe("Wikipedia infobox: wingspan 2.5 m");
    expect(
      stripPointerNotation("System record: ID gerbera, name Gerbera (system.id, system.name)"),
    ).toBe("System record: ID gerbera, name Gerbera");
  });

  it("leaves ordinary sentences that merely end in a parenthetical aside", () => {
    expect(stripPointerNotation("First flights reported (spring 2026) by two outlets")).toBe(
      "First flights reported (spring 2026) by two outlets",
    );
  });
});

describe("humanizeBriefItem", () => {
  it("keeps readable fact sentences", () => {
    expect(humanizeBriefItem("Euromaidan Press (2026-10-11) reports a 10 kg warhead")).toBe(
      "Euromaidan Press (2026-10-11) reports a 10 kg warhead",
    );
    expect(humanizeBriefItem("Wikipedia infobox gives a 2.5 m wingspan")).toBe(
      "Wikipedia infobox gives a 2.5 m wingspan",
    );
  });

  it("drops notation: pure paths, pointer-only remnants, and the record restatement", () => {
    expect(humanizeBriefItem("specifications.wingspan.claims[0].value")).toBeUndefined();
    expect(humanizeBriefItem("system.id, system.name, system.domain")).toBeUndefined();
    // "Record:" restates the entry's identity, not a fact about the system.
    expect(humanizeBriefItem("System record: ID gerbera, name Gerbera, origin RU")).toBeUndefined();
    expect(humanizeBriefItem("(specifications.wingspan.claims[0].value)")).toBeUndefined();
  });
});
