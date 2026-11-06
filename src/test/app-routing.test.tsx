import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("serves the procurement page", () => {
    const router = createRouter({ routeTree });

    const matches = router.matchRoutes("/procurement");

    expect(matches.at(-1)?.routeId).toBe("/procurement");
  });

  it("serves the autonomy page", () => {
    const router = createRouter({ routeTree });

    const matches = router.matchRoutes("/autonomy");

    expect(matches.at(-1)?.routeId).toBe("/autonomy");
  });

  it("serves the families review", () => {
    const router = createRouter({ routeTree });

    const matches = router.matchRoutes("/families");

    expect(matches.at(-1)?.routeId).toBe("/families");
  });

  it("serves the audit page", () => {
    const router = createRouter({ routeTree });

    const matches = router.matchRoutes("/audit");

    expect(matches.at(-1)?.routeId).toBe("/audit");
  });
});
