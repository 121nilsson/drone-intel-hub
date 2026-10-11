import type { RawDispatch } from "@/entities/dispatch/types";
import { consensus } from "@/entities/drone/consensus";
import type { Drone, EvolutionEvent, SpecAttribute, SpecClaim } from "@/entities/drone/types";

/**
 * What the 7-day briefing is built from: the week's REPORTING, not the week's catalog edits.
 *
 * The earlier briefing summarised catalog changes, so a Wikipedia reference import ("dozens of
 * newly imported systems") outweighed everything that was actually reported. Here reference data
 * is left out everywhere - imported entries, their history, and claims sourced to Wikipedia or
 * Wikidata - and the summary context is assembled from processed posts: which systems were
 * reported and by how many outlets, which systems appeared for the first time, which new spec
 * claims arrived and whether they are disputed, plus a few report excerpts so the summary can
 * speak about events and not just counts.
 *
 * Pure, so it is tested without a page and the context string is reproducible: the shared summary
 * cache is keyed by its fingerprint.
 */

export const WEEK_MS = 7 * 86_400_000;

export interface ReportedSystem {
  drone: Drone;
  posts: number;
  outlets: string[];
}

export interface NewClaim {
  drone: Drone;
  spec: SpecAttribute;
  claim: SpecClaim;
  disputed: boolean;
}

export interface Headline {
  id: string;
  date: string;
  outlet: string;
  url: string;
  excerpt: string;
  systems: Drone[];
}

export interface BriefingData {
  reports: number;
  outlets: number;
  reported: ReportedSystem[];
  newSystems: Drone[];
  newClaims: NewClaim[];
  drift: (EvolutionEvent & { drone: Drone })[];
  headlines: Headline[];
  context: string;
}

const REFERENCE_SOURCE = /wikipedia\.org|wikidata\.org/i;

/** History written by the reference import ("Imported from Wikipedia (...)"). */
export function isImportEvent(e: EvolutionEvent): boolean {
  return (
    /^Imported from (?:Wikipedia|Wikidata)/.test(e.description) || REFERENCE_SOURCE.test(e.source)
  );
}

/** An entry the reference import created, rather than one promoted from reporting. */
export function isImported(d: Drone): boolean {
  return !!d.evolution[0] && isImportEvent(d.evolution[0]);
}

function isReferenceClaim(c: SpecClaim): boolean {
  return c.extractionEngine === "reference" || REFERENCE_SOURCE.test(c.source);
}

/** When a post was reported, falling back to when it was collected. */
function postDate(d: RawDispatch): string {
  return d.publishedAt ?? d.processedAt ?? d.createdAt;
}

const flat = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function buildBriefing(
  drones: readonly Drone[],
  dispatches: readonly RawDispatch[],
  now = Date.now(),
): BriefingData {
  const recent = (iso: string | undefined) => !!iso && now - Date.parse(iso) < WEEK_MS;
  const byId = new Map(drones.map((d) => [d.id, d]));

  const posts = dispatches
    .filter((d) => d.status === "processed" && recent(postDate(d)))
    .sort((a, b) => postDate(b).localeCompare(postDate(a)));
  const linked = posts.filter((d) => d.droneIds?.some((id) => byId.has(id)));

  const tally = new Map<string, { posts: number; outlets: Set<string> }>();
  for (const post of linked) {
    for (const id of new Set(post.droneIds)) {
      if (!byId.has(id)) continue;
      const t = tally.get(id) ?? { posts: 0, outlets: new Set<string>() };
      t.posts++;
      t.outlets.add(post.sourceName);
      tally.set(id, t);
    }
  }
  const reported = [...tally.entries()]
    .map(([id, t]) => ({ drone: byId.get(id)!, posts: t.posts, outlets: [...t.outlets] }))
    .sort((a, b) => b.outlets.length - a.outlets.length || b.posts - a.posts);

  const newSystems = drones.filter((d) => recent(d.createdAt) && !isImported(d));

  const newClaims: NewClaim[] = [];
  for (const drone of drones) {
    for (const spec of drone.specs) {
      // Only figures: "Dimensions: smaller" or "Range: Long-range" is a model paraphrasing the
      // report, not a specification, and would crowd the real numbers out of the summary.
      const fresh = spec.claims.filter(
        (c) => recent(c.date) && !isReferenceClaim(c) && /\d/.test(String(c.value)),
      );
      if (!fresh.length) continue;
      const disputed = consensus(spec).disputed;
      for (const claim of fresh) newClaims.push({ drone, spec, claim, disputed });
    }
  }
  newClaims.sort((a, b) => b.claim.date.localeCompare(a.claim.date));

  const drift = drones
    .flatMap((d) =>
      d.evolution
        .filter((e) => recent(e.date) && !isImportEvent(e))
        .map((e) => ({ ...e, drone: d })),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const headlines: Headline[] = linked.slice(0, 12).map((post) => ({
    id: post.id,
    date: postDate(post),
    outlet: post.sourceName,
    url: post.url,
    excerpt: flat(post.text, 220),
    systems: [...new Set(post.droneIds)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
  }));

  const outlets = new Set(posts.map((p) => p.sourceName)).size;
  const context = [
    `Window: last 7 days. ${posts.length} drone-related reports from ${outlets} outlets; ${linked.length} named a catalogued system.`,
    `Most reported systems: ${
      reported
        .slice(0, 12)
        .map((r) => `${r.drone.name} (${r.posts} reports, ${r.outlets.length} outlets)`)
        .join("; ") || "none"
    }.`,
    `Systems seen in reporting for the first time: ${
      newSystems.map((d) => `${d.name} (${d.domain}, ${d.origin})`).join("; ") || "none"
    }.`,
    `New specification claims: ${
      newClaims
        .slice(0, 25)
        .map(
          (n) =>
            `${n.drone.name} ${n.spec.label}: ${String(n.claim.value)} (${n.claim.source.split(" · ")[0]})${n.disputed ? " - disputed" : ""}`,
        )
        .join("; ") || "none"
    }.`,
    `Report excerpts:\n${
      headlines
        .map(
          (h) =>
            `- ${h.date.slice(0, 10)} ${h.outlet} [${h.systems.map((s) => s.name).join(", ")}]: ${h.excerpt}`,
        )
        .join("\n") || "none"
    }`,
  ].join("\n");

  return {
    reports: posts.length,
    outlets,
    reported,
    newSystems,
    newClaims,
    drift,
    headlines,
    context,
  };
}
