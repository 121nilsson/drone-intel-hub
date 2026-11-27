import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPLAY_REPORT_PATH,
  replayReportTarget,
} from "@/entities/normalization/semantic-eval/replay";

describe("replay report target of evaluate-semantic-registry (R6)", () => {
  it("regenerates the committed report in plain replay mode", () => {
    expect(replayReportTarget([])).toEqual({ kind: "file", path: DEFAULT_REPLAY_REPORT_PATH });
  });

  it("never writes the committed report under --report without an explicit target", () => {
    for (const args of [
      ["--report"],
      ["--report", "--origins", "fixture", "--data-dir", "x", "--report-out", "y.md"],
    ]) {
      expect(replayReportTarget(args), args.join(" ")).toEqual({ kind: "skip" });
    }
  });

  it("writes where --out says, or to stdout, in either mode", () => {
    expect(replayReportTarget(["--report", "--out", "tmp/r.md"])).toEqual({
      kind: "file",
      path: "tmp/r.md",
    });
    expect(replayReportTarget(["--out", "tmp/r.md"])).toEqual({ kind: "file", path: "tmp/r.md" });
    expect(replayReportTarget(["--report", "--stdout"])).toEqual({ kind: "stdout" });
    // An explicit target works with flags before and after it.
    expect(replayReportTarget(["--report", "--out", "tmp/r.md", "--origins", "fixture"])).toEqual({
      kind: "file",
      path: "tmp/r.md",
    });
  });

  it("rejects --out without a path instead of taking the next flag as a file name (Q4)", () => {
    for (const args of [
      ["--report", "--out", "--origins", "fixture"],
      ["--out", "--report"],
      ["--report", "--out"],
      ["--out"],
      ["--out", ""],
    ]) {
      expect(replayReportTarget(args), JSON.stringify(args)).toEqual({
        kind: "invalid",
        reason: "--out needs a file path",
      });
    }
  });

  it("rejects --out together with --stdout", () => {
    expect(replayReportTarget(["--out", "a.md", "--stdout"])).toEqual({
      kind: "invalid",
      reason: "--out and --stdout exclude each other",
    });
  });
});
