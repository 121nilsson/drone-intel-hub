import postgres from "postgres";
import { storageEnv } from "@/shared/infra/config.server";

export type Sql = ReturnType<typeof postgres>;

let client: Sql | undefined;

/** True when the server has a PostgreSQL connection configured. */
export function dbConfigured() {
  return !!storageEnv().databaseUrl;
}

/**
 * Shared connection pool. Server-only: must never reach the browser bundle, and only the adapters
 * under shared/infra/postgres may call it (lint: no-raw-db-import).
 * postgres.js is used as a tagged template, so callers take the client first:
 * `const db = db(); await db\`select 1\`;`
 */
export function db(): Sql {
  const url = storageEnv().databaseUrl;
  if (!url) throw new Error("DATABASE_URL not set");
  client ??= postgres(url, { max: 5, prepare: false, idle_timeout: 20 });
  return client;
}
