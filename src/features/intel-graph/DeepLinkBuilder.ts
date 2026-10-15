import type { DeepLink } from "./intel-graph.contracts";

/** Build a deep link to the Counterparts page comparing two systems */
export function buildCounterpartLink(a: string, b: string, hash = ""): DeepLink {
  return {
    route: "/counterparts",
    search: { a, b },
    hash,
  };
}

/** Build a deep link to a System Dossier */
export function buildDossierLink(id: string, hash = ""): DeepLink {
  return {
    route: `/systems/${id}`,
    hash,
  };
}

/** Build a deep link to the Spec Engine filtered to a drone and spec */
export function buildSpecsLink(droneId: string, specKey: string): DeepLink {
  return {
    route: "/specs",
    search: { drone: droneId, q: specKey },
    hash: `#spec-${specKey}`,
  };
}

/** Build a deep link to the Feed filtered to a dispatch or search */
export function buildDispatchLink(dispatchId?: string, searchQuery?: string): DeepLink {
  const search =
    dispatchId ? { q: dispatchId } : (searchQuery ? { q: searchQuery } : undefined);
  return search ? { route: "/dispatches", search } : { route: "/dispatches" };
}

/** Build a deep link to the Spectrum page with a system focused */
export function buildSpectrumLink(focusId: string): DeepLink {
  return {
    route: "/spectrum",
    search: { focus: focusId },
  };
}

/** Build a deep link to the Catalog filtered */
export function buildCatalogLink(filters?: Record<string, string>): DeepLink {
  return filters ? { route: "/catalog", search: filters } : { route: "/catalog" };
}

/** Build a deep link to the Briefing */
export function buildBriefingLink(): DeepLink {
  return {
    route: "/",
  };
}

/** Build a deep link to the Intake/Queue page with a draft */
export function buildIntakeLink(draft?: string, source?: string): DeepLink {
  const search = Object.fromEntries(
    Object.entries({ draft, source }).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
  return Object.keys(search).length ? { route: "/intake", search } : { route: "/intake" };
}

/** Build a deep link to the Sources page */
export function buildSourcesLink(): DeepLink {
  return {
    route: "/sources",
  };
}

/** Build a deep link to the Taxonomy page */
export function buildTaxonomyLink(): DeepLink {
  return {
    route: "/taxonomy",
  };
}

/** Build a deep link to the Settings page */
export function buildSettingsLink(): DeepLink {
  return {
    route: "/settings",
  };
}

/** Section hashes for dossier */
export const DOSSIER_SECTIONS = {
  specs: "#specs",
  aliases: "#aliases",
  rf: "#rf",
  supply: "#supply",
  payloads: "#payloads",
  sensors: "#sensors",
  variants: "#variants",
  counterparts: "#counterparts",
  timeline: "#timeline",
} as const;

/** Section hashes for counterparts */
export const COUNTERPART_SECTIONS = {
  ew: "#ew",
  kinetic: "#kinetic",
  overlap: "#overlap",
  specs: "#specs",
} as const;

/** Convert a DeepLink to a full URL string (for external sharing) */
export function deepLinkToUrl(baseUrl: string, link: DeepLink): string {
  const url = new URL(link.route, baseUrl);

  if (link.search) {
    for (const [key, value] of Object.entries(link.search)) {
      url.searchParams.set(key, value);
    }
  }

  if (link.hash) {
    url.hash = link.hash;
  }

  return url.toString();
}

/** Parse a URL back into a DeepLink (for client-side routing) */
export function parseDeepLink(url: string, baseUrl: string): DeepLink | null {
  try {
    const parsed = new URL(url, baseUrl);
    const pathname = parsed.pathname;

    // Extract route and search
    const route = pathname;
    const search: Record<string, string> = {};
    for (const [key, value] of parsed.searchParams) {
      search[key] = value;
    }
    const hash = parsed.hash || undefined;
    const hasSearch = Object.keys(search).length > 0;

    return hasSearch && hash
      ? { route, search, hash }
      : hasSearch
        ? { route, search }
        : hash
          ? { route, hash }
          : { route };
  } catch {
    return null;
  }
}

/** Generate a shareable URL for a specific intelligence finding */
export function buildShareableIntelUrl(
  baseUrl: string,
  sourceId: string,
  targetId: string,
  edgeType: string,
): string {
  // For now, link to the counterpart comparison if both are drones
  // Could be extended for other edge types
  return deepLinkToUrl(baseUrl, buildCounterpartLink(sourceId, targetId));
}
