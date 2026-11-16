import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AGENTS.md: nothing that learns reads the audit seed set, and an audit answer measures the
 * verifier without ever steering it. Since the ports sit on serverServices(), a learner would be
 * one property away from the seed rows with no import to notice, so this pins who may touch them:
 * `seedAudit` only in the seed measurement, and the audit repo only in verification.
 */
const SRC = path.resolve(import.meta.dirname, "..");

function* files(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.tsx?$/.test(e.name)) yield p;
  }
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

/** Code that learns or decides, or that sits beside it: none of it may read the audit tables. */
const LEARNERS = [
  "shared/infra/evaluation/",
  "shared/infra/heuristics/",
  "shared/infra/ingest/",
  "shared/infra/proposals/",
  "shared/infra/catalog/",
  "entities/",
  "features/",
];
const SEED_MEASUREMENT = "shared/infra/evaluation/seed-agreement.server.ts";

describe("the audit seed set stays out of the learning loops", () => {
  const sources = [...files(SRC)]
    .filter((p) => !rel(p).startsWith("test/"))
    .map((p) => ({ file: rel(p), text: fs.readFileSync(p, "utf8") }));

  it("reads the seed rows only in the seed measurement", () => {
    const users = sources
      .filter((s) => /\.seedAudit\b|seedAuditRows\(/.test(s.text))
      .map((s) => s.file)
      .filter(
        (f) =>
          f !== SEED_MEASUREMENT &&
          !f.startsWith("shared/contracts/") &&
          !f.startsWith("shared/infra/postgres/") &&
          !f.startsWith("shared/infra/null-repos/") &&
          f !== "shared/infra/server-services.server.ts",
      );
    expect(users).toEqual([]);
  });

  it("keeps the audit repo out of every learner", () => {
    const users = sources
      .filter((s) => LEARNERS.some((l) => s.file.startsWith(l)))
      .filter((s) => s.file !== SEED_MEASUREMENT)
      .filter((s) => /serverServices\(\)\.audit\b|\.seedAudit\b|AuditRepo\b/.test(s.text))
      .map((s) => s.file);
    expect(users).toEqual([]);
  });

  it("finds the seed measurement, so the checks above are not vacuous", () => {
    const measurement = sources.find((s) => s.file === SEED_MEASUREMENT);
    expect(measurement?.text).toMatch(/seedAudit\.seedAuditRows\(/);
  });
});
