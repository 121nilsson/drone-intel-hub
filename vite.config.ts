// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import { SCHEDULED_TASKS } from "./src/shared/contracts/scheduled-tasks";

/** Nitro's `scheduledTasks`: one entry per cron, listing every job that shares it. */
function scheduleByCron(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of SCHEDULED_TASKS) (out[t.cron] ??= []).push(t.name);
  return out;
}

// Populate process.env with variables from .env and .env.local for server functions in dev mode
const env = loadEnv(process.env["NODE_ENV"] || "development", process.cwd(), "");
for (const [key, val] of Object.entries(env)) {
  if (process.env[key] === undefined) {
    process.env[key] = val;
  }
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    // The wrapper's `nitro` type only documents preset/output/cloudflare, but at runtime it
    // spreads the whole object into `nitro()` (see @lovable.dev/vite-tanstack-config
    // dist/index.js:1770). The cast passes tasks config through without patching their types.
    experimental: { tasks: true },
    // Nitro scans `tasks/` only within its scanDirs, which default to the serverDir rather
    // than the project root, so the root-level tasks/ directory has to be listed here.
    scanDirs: ["."],
    // The schedule lives in shared/contracts/scheduled-tasks.ts, with what each job does; the
    // evaluation page reads the same list to show each job's status and next run.
    scheduledTasks: scheduleByCron(),
  } as never,
});
