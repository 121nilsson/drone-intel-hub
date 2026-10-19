import { definePlugin } from "nitro";
import { ensureMigrated } from "../src/shared/infra/postgres/migrate.server";

/**
 * Schema migrations at server start. Plugins must be synchronous, so the run starts here and
 * every request waits on the same promise: nothing reads a half-migrated database, and a failed
 * migration (logged, never thrown) still lets the app serve on the schema it has.
 */
export default definePlugin((nitroApp) => {
  void ensureMigrated();
  nitroApp.hooks.hook("request", async () => {
    await ensureMigrated();
  });
});
