import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listMigrations, pendingMigrations } from "@/shared/infra/postgres/migrate.server";

describe("startup migrations", () => {
  it("lists only .sql files, in name order", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
    for (const f of ["010_b.sql", "002_a.sql", "README.md", "004_x.sql", "004_procurements.sql"])
      fs.writeFileSync(path.join(dir, f), `-- ${f}`);
    expect(listMigrations(dir).map((m) => m.name)).toEqual([
      "002_a.sql",
      "004_procurements.sql",
      "004_x.sql",
      "010_b.sql",
    ]);
  });

  it("applies only what is not recorded", () => {
    const files = ["001.sql", "002.sql", "003.sql"].map((name) => ({ name, sql: "" }));
    expect(pendingMigrations(files, new Set(["001.sql", "003.sql"])).map((f) => f.name)).toEqual([
      "002.sql",
    ]);
  });

  it("finds the repo's migrations and every one is written to be re-run safely", () => {
    const all = listMigrations(path.resolve("migrations"));
    expect(all.length).toBeGreaterThanOrEqual(12);
    // Adoption on an existing database re-runs every file once: no bare CREATE TABLE/INDEX.
    for (const m of all)
      expect(m.sql, m.name).not.toMatch(
        /create\s+(?:unique\s+)?(?:table|index)\s+(?!if not exists)/i,
      );
  });

  it("is empty for a missing directory instead of throwing", () => {
    expect(listMigrations(path.join(os.tmpdir(), "does-not-exist-mig"))).toEqual([]);
  });
});
