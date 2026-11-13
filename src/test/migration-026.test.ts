import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Migration 026 against the schema it extends. The migration cannot run in the unit tests (they
 * have no PostgreSQL), so what broke the first draft of this design - a foreign key of the wrong
 * type, a column that already existed, a cascade that erased history - is pinned in the text.
 */
const sql = readFileSync(
  resolve(__dirname, "../../migrations/026_claim_governance_and_audit.sql"),
  "utf8",
);
const base = readFileSync(
  resolve(__dirname, "../../migrations/019_verification_audit.sql"),
  "utf8",
);
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("migration 026", () => {
  it("references verification_audit by the type its id really has", () => {
    expect(base).toMatch(/id\s+text primary key/);
    expect(code).toMatch(/audit_id\s+text not null references verification_audit \(id\)/);
    expect(code).not.toMatch(/audit_id\s+(int|integer|uuid)\b/);
  });

  it("does not re-add the batch_id column 019 already created, and keeps it text", () => {
    expect(base).toMatch(/batch_id\s+text not null/);
    expect(code).not.toMatch(/add column (if not exists )?batch_id/);
    expect(code).toMatch(/legacy_batch_id text unique/);
  });

  it("stores the draw seed in the type the existing column has", () => {
    expect(base).toMatch(/draw_seed\s+bigint/);
    expect(code).toMatch(/seed\s+bigint/);
    expect(code).not.toMatch(/seed\s+(int|integer)\b/);
  });

  it("never cascades a delete into history, and refuses to change or truncate the reader's rows", () => {
    expect(code).not.toMatch(/on delete cascade/);
    expect(code).not.toMatch(/on delete set null/);
    expect(code.match(/on delete restrict/g)?.length).toBeGreaterThanOrEqual(4);
    expect(code).toMatch(/before update or delete on verification_audit_reader/);
    expect(code).toMatch(/before truncate on verification_audit_reader/);
    expect(code).toMatch(/raise exception/);
  });

  it("allows one at_draw reading per audit item, in the database", () => {
    expect(code).toMatch(
      /create unique index if not exists verification_audit_reader_at_draw_uidx\s+on verification_audit_reader \(audit_id\) where phase = 'at_draw'/,
    );
  });

  it("allows a legacy batch without a population size, and does not invent one", () => {
    expect(code).toMatch(/population_size integer,/);
    expect(code).not.toMatch(/population_size integer not null/);
  });

  it("keeps the four-state verdict next to the legacy one", () => {
    for (const v of ["supported", "contradicted", "not_found", "uncertain", "legacy_unsupported"])
      expect(code).toContain(`'${v}'`);
    expect(code).toMatch(/verifier_controls_verdict_check[\s\S]*'unsupported'/);
  });

  it("is written to be run twice: every create, add and backfill is guarded", () => {
    expect(code).not.toMatch(/create table (?!if not exists)/);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/);
    expect(code.match(/add column (?!if not exists)/g)).toBeNull();
    expect(code).toMatch(/drop trigger if exists/);
    expect(code).toMatch(/create or replace function/);
    expect(code).toMatch(/where a\.sampling_purpose is null/);
  });

  it("stores when the model read the claim apart from when the snapshot was written", () => {
    expect(code).toMatch(/evaluated_at\s+timestamptz not null,/);
    expect(code).toMatch(/recorded_at\s+timestamptz not null default clock_timestamp\(\)/);
  });
});
