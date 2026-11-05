import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RawDispatch } from "@/entities/dispatch/types";
import { outletRecords, outletWeights } from "@/entities/source/outlet-record";

/**
 * One document stored as a JSON string (see migrations/022) read back with every field undefined,
 * and the first `.replace` on one of them stopped the whole sync tick, every tick, until someone
 * read the log. A malformed document is skipped; it never takes ingestion down with it.
 */
const dispatch = (over: Partial<RawDispatch>) =>
  ({ id: "s|1", sourceName: "Ukrinform (War)", status: "processed", ...over }) as RawDispatch;

describe("an archive with a malformed document", () => {
  it("still gives per-outlet records for the rest", () => {
    const broken = '{"id":"s|2"}' as unknown as RawDispatch; // a string where a document belongs
    const records = outletRecords([dispatch({}), broken, dispatch({ id: "s|3" })]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: "Ukrinform (War)", stored: 2 });
    expect(outletWeights([broken]).size).toBe(0);
  });

  it("skips a dispatch that lost its source name", () => {
    const nameless = dispatch({ sourceName: undefined as unknown as string });
    expect(outletRecords([nameless, dispatch({})])).toHaveLength(1);
  });
});

describe("writing JSON to a jsonb column", () => {
  it("never passes JSON.stringify output as a parameter, which postgres.js encodes a second time", () => {
    // `$1::jsonb` with a string stored a JSON string holding the document; tx.json() stores the
    // document. The rename script did the first, which is where migration 022 came from.
    const script = readFileSync(
      resolve(__dirname, "../../scripts/rename-legacy-system-ids.ts"),
      "utf8",
    );
    expect(script).not.toMatch(/JSON\.stringify\(data\)\s*,\s*row\.id/);
    expect(script).toMatch(/tx\.json\(data/);
  });

  it("is repaired by an idempotent migration that only touches string values starting with a brace", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../migrations/022_repair_double_encoded_documents.sql"),
      "utf8",
    );
    for (const table of ["candidates", "dispatches", "drones", "procurements"])
      expect(sql).toContain(`update ${table} set data = (data #>> '{}')::jsonb`);
    expect(sql.match(/jsonb_typeof\(data\) = 'string'/g)).toHaveLength(4);
    expect(sql.match(/left\(data #>> '\{\}', 1\) = '\{'/g)).toHaveLength(4);
  });
});
