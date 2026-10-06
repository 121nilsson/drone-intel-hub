// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

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
      // Auto-ingest every 15 min; the task itself enforces a 1 min floor via sync_state.
      "*/15 * * * *": "sources:sync",
    },
  } as never,
});
