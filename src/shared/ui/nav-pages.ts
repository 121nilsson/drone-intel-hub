export interface NavPage {
  to: string;
  label: string;
  hint: string;
}

/**
 * Twelve pages in four groups by the job they serve: reading the intel, the catalogue built from
 * it, and the engine that reads it. A flat row of twelve wrapped at laptop widths and gave the
 * daily pages and the maintenance pages the same weight.
 */
export const NAV_GROUPS: readonly {
  label: string;
  pages: readonly NavPage[];
  also?: readonly string[];
}[] = [
  {
    label: "Intel",
    pages: [
      { to: "/", label: "Briefing", hint: "What changed, summarised" },
      { to: "/dispatches", label: "Feed", hint: "Every collected post" },
      { to: "/intake", label: "Queue", hint: "Candidates waiting for a decision" },
      { to: "/sources", label: "Sources", hint: "Monitored channels and sites" },
    ],
  },
  {
    label: "Catalog",
    // A dossier is a catalog page reached by its own route.
    also: ["/systems"],
    pages: [
      { to: "/catalog", label: "Systems", hint: "Search and filter the catalog" },
      { to: "/procurement", label: "Procurement", hint: "Contracts and production deals" },
      { to: "/counterparts", label: "Counterparts", hint: "Compare two systems" },
      { to: "/spectrum", label: "Spectrum", hint: "RF links, jammers and radars" },
    ],
  },
  {
    label: "Engine",
    pages: [
      { to: "/specs", label: "Spec engine", hint: "Attributes across the catalog" },
      { to: "/taxonomy", label: "Taxonomy", hint: "Map unknown terms" },
      { to: "/evaluation", label: "Evaluation", hint: "Measure and teach the heuristic" },
    ],
  },
];

export const SETTINGS: NavPage = {
  to: "/settings",
  label: "Settings",
  hint: "Models, thresholds, display",
};

/** Every page once, for search. */
export const NAV_PAGES: readonly NavPage[] = [...NAV_GROUPS.flatMap((g) => g.pages), SETTINGS];
