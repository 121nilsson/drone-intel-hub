import fs from "node:fs";
import path from "node:path";
import { db, dbConfigured } from "./db.server";

/**
 * Applies /migrations at server start. docker-compose mounts the same files into
 * docker-entrypoint-initdb.d, but Postgres runs those only on an empty volume, so every later
 * migration used to need a manual psql run against the existing database.
 *
 * Every file is idempotent by repo convention, which is what makes adoption safe: on a database
 * that predates schema_migrations, all files run once more and are then recorded. One known
 * side effect of that first run: the last statement of 007 turns bellingcat-news autoSync off
 * again if an operator had turned it back on.
 */

export interface MigrationFile {
  name: string;
  sql: string;
}

/** Shared by every process starting at once (web, worker): only one applies, the rest wait. */
const LOCK_KEY = 7_301_001;

export function migrationsDir(): string {
  return process.env["MIGRATIONS_DIR"] ?? path.resolve(process.cwd(), "migrations");
}

export function listMigrations(dir = migrationsDir()): MigrationFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}

/** Files not yet recorded, in name order. Pure. */
export function pendingMigrations(files: readonly MigrationFile[], applied: ReadonlySet<string>) {
  return files.filter((f) => !applied.has(f.name));
}

export interface MigrationResult {
  ran: boolean;
  reason: string;
  applied: string[];
}

/**
 * Apply pending migrations in one transaction, so a failing file leaves the schema exactly as
 * it was rather than half-migrated. Never throws: a failure is logged and reported, and the app
 * keeps serving on the schema it has.
 */
export async function runMigrations(dir = migrationsDir()): Promise<MigrationResult> {
  if (!dbConfigured()) return { ran: false, reason: "no database configured", applied: [] };
  const files = listMigrations(dir);
  if (!files.length) return { ran: false, reason: `no migrations in ${dir}`, applied: [] };
  try {
    const applied: string[] = [];
    await db().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
      await tx`create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )`;
      const done = new Set(
        (await tx`select name from schema_migrations`).map((r) => r["name"] as string),
      );
      for (const f of pendingMigrations(files, done)) {
        // Simple protocol: a file holds several statements and DO blocks.
        await tx.unsafe(f.sql).simple();
        await tx`insert into schema_migrations (name) values (${f.name})`;
        applied.push(f.name);
      }
    });
    return { ran: true, reason: applied.length ? "applied" : "up to date", applied };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[migrate] failed, schema left unchanged:", reason);
    return { ran: false, reason, applied: [] };
  }
}

let ready: Promise<MigrationResult> | undefined;
/** Memoized: the startup plugin starts it, request handling and tasks await the same run. */
export function ensureMigrated(): Promise<MigrationResult> {
  ready ??= runMigrations().then((r) => {
    if (r.applied.length) console.log(`[migrate] applied ${r.applied.join(", ")}`);
    else console.log(`[migrate] ${r.reason}`);
    return r;
  });
  return ready;
}
