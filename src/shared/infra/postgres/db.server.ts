import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

let client: Sql | undefined;

/** True when the server has a PostgreSQL connection configured. */
export function dbConfigured() {
  return !!process.env["DATABASE_URL"];
}

/**
 * Shared connection pool. Server-only: must never reach the browser bundle.
 * postgres.js is used as a tagged template, so callers take the client first:
 * `const db = db(); await db\`select 1\`;`
 */
export function db(): Sql {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL not set");
  client ??= postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
  return client;
}
