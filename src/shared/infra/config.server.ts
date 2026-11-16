/**
 * Storage-related environment, read in one place. Code that needs to know whether a database is
 * configured asks the `StorageBackend` (storage/backend.server.ts); only the adapters that open a
 * connection read a URL, and they read it here.
 */
export interface StorageEnv {
  databaseUrl: string | undefined;
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  migrationsDir: string | undefined;
}

/** Read at call time, not import time: tests and the migration job set these after import. */
export function storageEnv(): StorageEnv {
  return {
    databaseUrl: process.env["DATABASE_URL"] || undefined,
    supabaseUrl: process.env["SUPABASE_URL"] || undefined,
    supabaseServiceRoleKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] || undefined,
    migrationsDir: process.env["MIGRATIONS_DIR"] || undefined,
  };
}
