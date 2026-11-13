import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Migration 027: the relations 026 left to the application, now held by the database. */
const sql = readFileSync(resolve(__dirname, "../../migrations/027_audit_integrity.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("migration 027", () => {
  it("ties a presentation to the unit of its own batch and claim", () => {
    expect(code).toMatch(/unique \(id, audit_batch_id, claim_id\)/);
    expect(code).toMatch(
      /foreign key \(sample_unit_id, audit_batch_id, claim_id\)\s+references audit_sample_units \(id, audit_batch_id, claim_id\) on delete restrict/,
    );
    expect(code).toMatch(/sample_unit_id is null or audit_batch_id is not null/);
  });

  it("does not let a formal audit row lose its sample unit, nor a new draw its population", () => {
    expect(code).toMatch(
      /sampling_purpose = 'formal_eval' and role = 'audit'\) or sample_unit_id is not null/,
    );
    expect(code).toMatch(/purpose = 'legacy' or population_size is not null/);
  });

  it("makes a retry repeat the same unit and claim", () => {
    expect(code).toMatch(/before insert or update of retry_of_audit_id, sample_unit_id, claim_id/);
    expect(code).toMatch(/previous\.sample_unit_id is distinct from new\.sample_unit_id/);
  });

  it("logs a changed answer and keeps that log append-only with two separate triggers", () => {
    expect(code).toMatch(/after update of answer, obviously_wrong on verification_audit/);
    expect(code).toMatch(/before update or delete on verification_audit_answer_log\s+for each row/);
    expect(code).toMatch(/before truncate on verification_audit_answer_log\s+for each statement/);
    expect(code).not.toMatch(/on delete cascade/);
  });

  it("is guarded to run twice", () => {
    expect(code).not.toMatch(/create table (?!if not exists)/);
    expect(code).not.toMatch(/create (unique )?index (?!if not exists)/);
    expect(code.match(/pg_constraint where conname/g)?.length).toBeGreaterThanOrEqual(5);
    expect(code).toMatch(/drop trigger if exists/);
  });
});
