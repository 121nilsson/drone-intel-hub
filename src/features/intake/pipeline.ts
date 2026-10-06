import type { Candidate, Drone } from "@/entities/drone/types";
import type { IntelExtractor } from "@/shared/contracts/ai";
import type { CandidateRepository, DroneRepository } from "@/shared/contracts/repository";
import { mergeSpecs } from "@/features/dynamic-specs/spec-engine";
import { counterpartIdsFor, linkCounterparts } from "@/entities/drone/relations";

export interface PipelineDeps {
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  drones: DroneRepository;
  candidates: CandidateRepository;
  escalationThreshold: number;
  autoMergeThreshold: number;
}

export type PipelineResult =
  | { kind: "auto-merged"; droneId: string; candidate: Candidate }
  | { kind: "queued"; candidate: Candidate };

export async function runTwoTier(
  raw: string,
  source: string,
  d: PipelineDeps,
): Promise<PipelineResult> {
  const catalog = d.drones.list();
  let tier: 1 | 2 = 1;
  let extraction = await d.tier1.extract(raw, catalog);
  if (extraction.confidence < d.escalationThreshold || !extraction.matchId) {
    tier = 2;
    extraction = await d.tier2.extract(raw, catalog);
  }
  const candidate: Candidate = {
    id: crypto.randomUUID(),
    raw,
    source,
    createdAt: new Date().toISOString(),
    tier,
    extraction,
    status: "pending",
  };
  if (extraction.matchId && extraction.confidence >= d.autoMergeThreshold) {
    const target = d.drones.get(extraction.matchId)!;
    const merged = mergeSpecs(target, extraction.specs, source);
    d.drones.upsert(merged);
    // The extraction already reports systems[] and variantOf; persist those as catalog
    // relations so counterpart links come from ingest instead of being hand-maintained.
    for (const changed of linkCounterparts(
      merged,
      counterpartIdsFor(extraction, catalog, target.id),
      catalog,
    )) {
      d.drones.upsert(changed);
    }
    candidate.status = "merged";
    candidate.resolvedInto = target.id;
    d.candidates.add(candidate);
    return { kind: "auto-merged", droneId: target.id, candidate };
  }
  d.candidates.add(candidate);
  return { kind: "queued", candidate };
}

export function promote(
  c: Candidate,
  d: Pick<PipelineDeps, "drones" | "candidates">,
  nameOverride?: string,
): Drone {
  const e = c.extraction;
  const name =
    nameOverride?.trim() ||
    e.name ||
    `Uncataloged ${e.domain ?? "system"} ${c.id.slice(0, 4).toUpperCase()}`;
  const now = new Date().toISOString();
  const base: Drone = {
    id:
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
      "-" +
      c.id.slice(0, 4),
    name,
    aliases: e.aliases,
    domain: e.domain ?? "Multi",
    origin: e.origin ?? "??",
    operators: e.operators,
    propulsion: e.propulsion ?? "Unknown",
    summary: c.raw.slice(0, 200),
    specs: [],
    rf: e.rfBands.map((b) => ({ role: "uplink" as const, band: b })),
    components: [],
    evolution: [
      { date: now, kind: "other", description: "Promoted from intake queue", source: c.source },
    ],
    counterpartIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const drone = mergeSpecs(base, e.specs, c.source);
  d.drones.upsert(drone);
  // A promoted system often arrives alongside ones already catalogued ("Shahed-136 seen
  // with Geran-2"), so seed its relations from the same systems[] the auto-merge path uses.
  const catalog = d.drones.list();
  const changed = linkCounterparts(drone, counterpartIdsFor(e, catalog, drone.id), catalog);
  for (const c2 of changed) d.drones.upsert(c2);
  d.candidates.update(c.id, { status: "promoted", resolvedInto: drone.id });
  // Return the linked version so callers don't hold a stale copy without counterpartIds.
  return changed.find((x) => x.id === drone.id) ?? drone;
}

export function mergeInto(
  c: Candidate,
  droneId: string,
  d: Pick<PipelineDeps, "drones" | "candidates">,
) {
  const target = d.drones.get(droneId);
  if (!target) return;
  const merged = mergeSpecs(target, c.extraction.specs, c.source);
  merged.evolution = [
    ...merged.evolution,
    {
      date: new Date().toISOString(),
      kind: "other",
      description: `Merged intake: ${c.extraction.rationale}`,
      source: c.source,
    },
  ];
  d.drones.upsert(merged);
  d.candidates.update(c.id, { status: "merged", resolvedInto: droneId });
}
