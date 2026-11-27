import { describe, expect, it } from "vitest";
import { readFlags } from "@/entities/normalization/semantic-eval/cli-args";

const DEFAULTS = { "--in": "in.jsonl", "--seed": "s", "--report-out": "r.md" } as const;

describe("readFlags: the shared value-flag rule (T3)", () => {
  it("takes defaults for absent flags and values for present ones, wherever they stand", () => {
    expect(readFlags([], DEFAULTS)).toEqual({ ok: true, values: DEFAULTS });
    expect(readFlags(["--apply", "--seed", "x", "--report"], DEFAULTS)).toEqual({
      ok: true,
      values: { ...DEFAULTS, "--seed": "x" },
    });
    expect(readFlags(["--in", "a.jsonl", "--report-out", "b.md"], DEFAULTS)).toEqual({
      ok: true,
      values: { "--in": "a.jsonl", "--seed": "s", "--report-out": "b.md" },
    });
  });

  it("rejects a present flag without a value, with an empty value, or with a flag in its place", () => {
    for (const args of [
      ["--in"],
      ["--in", ""],
      ["--in", "--apply"],
      ["--seed", "x", "--in", "--report-out", "b.md"],
      ["--report-out"],
    ]) {
      const r = readFlags(args, DEFAULTS);
      expect(r.ok, JSON.stringify(args)).toBe(false);
    }
    expect(readFlags(["--in", "--apply"], DEFAULTS)).toEqual({
      ok: false,
      reason: "--in needs a value",
    });
  });

  it("accepts a value that starts with a single dash (only `--` marks a flag)", () => {
    expect(readFlags(["--seed", "-1"], DEFAULTS)).toEqual({
      ok: true,
      values: { ...DEFAULTS, "--seed": "-1" },
    });
  });

  it("does not confuse a flag with another that it is a prefix of", () => {
    expect(readFlags(["--report-out", "b.md"], { "--report": "x" })).toEqual({
      ok: true,
      values: { "--report": "x" },
    });
  });
});
