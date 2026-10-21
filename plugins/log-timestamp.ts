import { definePlugin } from "nitro";
import { stampLogLines } from "../src/lib/log-timestamp";

/**
 * Timestamped log lines, from the first line the server writes.
 *
 * The plugin runs at startup, before the migrations and the scheduled jobs, so the migration and
 * the first sync carry a time too. It is a nitro plugin rather than an import in the app code
 * because the app's own entry is loaded with the first request, long after the server has
 * already logged that it is up.
 */
export default definePlugin(() => {
  stampLogLines();
});
