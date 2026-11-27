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
      ["--report", "--out"],
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
  });
});
