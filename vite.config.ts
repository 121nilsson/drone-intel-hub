// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

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
    scheduledTasks: {
      // Auto-ingest every 10 minutes. The task enforces a 9 min floor via sync_state so ticks
      // cannot overlap, and each run stops starting AI work after an 8 min window.
      "*/10 * * * *": "sources:sync",
    },
  } as never,
});
