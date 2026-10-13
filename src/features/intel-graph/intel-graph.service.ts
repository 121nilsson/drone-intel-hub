import type { Drone, SpecAttribute, RFLink } from "@/entities/drone/types";
import type { Dispatch } from "@/entities/dispatch/types";
import {
  intersectBands,
  linkIsFiber,
  effectiveIeeeBands,
  effectiveNatoBands,
} from "@/entities/normalization/rf";
import {
  ewMatrix,
  kineticEnvelope,
  type ThreatVerdict,
  type KineticVerdict,
} from "@/entities/normalization/ew-matrix";
import {
  type GraphEdge,
  type GraphEdgeType,
  type DeepLink,
  type RelatedIntel,
  EDGE_TYPE_WEIGHTS,
  EDGE_TYPE_LABELS,
} from "./intel-graph.contracts";

/** Compute all related intelligence for a source entity */
export function computeRelatedIntel(
  sourceId: string,
  drones: Drone[],
  dispatches: Dispatch[],
  _specs: SpecAttribute[], // reserved for future spec-key queries
): RelatedIntel {
  const edges: GraphEdge[] = [];

  // Find the source drone if it's a drone ID
  const sourceDrone = drones.find((d) => d.id === sourceId);

  if (sourceDrone) {
    // 1. Explicit counterparts
    edges.push(...computeCounterpartEdges(sourceDrone, drones));

    // 2. RF overlap (computed)
    edges.push(...computeRfOverlapEdges(sourceDrone, drones));

    // 3. EW interactions (jammers/radars)
    edges.push(...computeEwEdges(sourceDrone, drones));

    // 4. Shared components (supply chain)
    edges.push(...computeComponentEdges(sourceDrone, drones));

    // 5. Shared operators
    edges.push(...computeOperatorEdges(sourceDrone, drones));

    // 6. Variant lineage (parent/variants)
    edges.push(...computeLineageEdges(sourceDrone, drones));

    // 7. Spec disputes
    edges.push(...computeSpecDisputeEdges(sourceDrone));

    // 8. Shared reference (Wikipedia/Wikidata)
    edges.push(...computeReferenceEdges(sourceDrone, drones));
  }

  // 9. Event correlation (if source is a dispatch)
  const sourceDispatch = dispatches.find((d) => d.id === sourceId);
  if (sourceDispatch) {
    edges.push(...computeEventCorrelationEdges(sourceDispatch, dispatches));
  }

  // Deduplicate and rank
  const ranked = rankAndDedupe(edges);

  return {
    sourceId,
    edges: ranked,
    computedAt: Date.now(),
  };
}

/** 1. Explicit counterpart links */
function computeCounterpartEdges(source: Drone, drones: Drone[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const cid of source.counterpartIds) {
    const target = drones.find((d) => d.id === cid);
    if (!target) continue;

    edges.push({
      type: "counterpart",
      targetId: target.id,
      targetLabel: target.name,
      strength: 1.0,
      evidence: ["Explicit counterpart link"],
      deepLink: makeCounterpartDeepLink(source.id, target.id),
    });
  }

  return edges;
}

/** 2. RF frequency overlap */
function computeRfOverlapEdges(source: Drone, drones: Drone[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const target of drones) {
    if (target.id === source.id) continue;

    const overlaps = findRfOverlaps(source, target);
    if (overlaps.length === 0) continue;

    // Aggregate strength by max overlap percentage
    const maxOverlap = Math.max(...overlaps.map((o) => o.overlapPct));

    edges.push({
      type: "rf-overlap",
      targetId: target.id,
      targetLabel: target.name,
      strength: maxOverlap,
      evidence: overlaps.map(
        (o) =>
          `${o.sourceRole}/${o.targetRole} · ${o.overlapStart}–${o.overlapEnd} MHz (${Math.round(o.overlapPct * 100)}% overlap)`,
      ),
      deepLink: makeCounterpartDeepLink(source.id, target.id, "#ew"),
    });
  }

  return edges;
}

interface RfOverlap {
  sourceRole: string;
  targetRole: string;
  overlapStart: number;
  overlapEnd: number;
  overlapPct: number;
}

function findRfOverlaps(a: Drone, b: Drone): RfOverlap[] {
  const overlaps: RfOverlap[] = [];

  for (const linkA of a.rf) {
    if (linkIsFiber(linkA)) continue;
    if (!linkA.freqMHz) continue;

    for (const linkB of b.rf) {
      if (linkIsFiber(linkB)) continue;
      if (!linkB.freqMHz) continue;

      const intersection = intersectBands(linkA.freqMHz, linkB.freqMHz);
      if (!intersection) continue;

      const [start, end] = intersection;
      const spanA = linkA.freqMHz[1] - linkA.freqMHz[0];
      const spanB = linkB.freqMHz[1] - linkB.freqMHz[0];
      const overlapSpan = end - start;
      const overlapPct = overlapSpan / Math.min(spanA, spanB);

      overlaps.push({
        sourceRole: linkA.role,
        targetRole: linkB.role,
        overlapStart: start,
        overlapEnd: end,
        overlapPct,
      });
    }
  }

  return overlaps;
}

/** 3. EW interactions (jammer ↔ link, radar ↔ airframe) */
function computeEwEdges(source: Drone, drones: Drone[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const target of drones) {
    if (target.id === source.id) continue;

    // Source as target, target as attacker (jammer)
    const ew1 = ewMatrix(source, target);
    if (ew1.rows.length > 0) {
      const jammedRows = ew1.rows.filter((r) => r.verdict === "jammed");
      const contestedRows = ew1.rows.filter((r) => r.verdict === "contested");
      const fiberRows = ew1.rows.filter((r) => r.verdict === "fiber_immune");

      if (jammedRows.length > 0) {
        edges.push({
          type: "ew-interaction",
          targetId: target.id,
          targetLabel: target.name,
          strength: 0.9,
          evidence: jammedRows.map((r) => `${r.role} jammed by ${target.name} (${r.rationale})`),
          deepLink: makeCounterpartDeepLink(source.id, target.id, "#ew"),
        });
      }
      if (contestedRows.length > 0) {
        edges.push({
          type: "ew-interaction",
          targetId: target.id,
          targetLabel: target.name,
          strength: 0.7,
          evidence: contestedRows.map(
            (r) => `${r.role} contested by ${target.name} (${r.rationale})`,
          ),
          deepLink: makeCounterpartDeepLink(source.id, target.id, "#ew"),
        });
      }
      if (fiberRows.length > 0) {
        edges.push({
          type: "ew-interaction",
          targetId: target.id,
          targetLabel: target.name,
          strength: 0.8,
          evidence: fiberRows.map(
            (r) => `${r.role} uses fiber tether — immune to ${target.name} jamming`,
          ),
          deepLink: makeCounterpartDeepLink(source.id, target.id, "#ew"),
        });
      }
    }

    // Kinetic envelope (source as target, target as defender)
    const kinetic = kineticEnvelope(source, target);
    if (kinetic.length > 0) {
      const engageable = kinetic.filter((r) => r.verdict === "in_envelope");
      if (engageable.length > 0) {
        edges.push({
          type: "ew-interaction",
          targetId: target.id,
          targetLabel: target.name,
          strength: 0.85,
          evidence: engageable.map(
            (r) =>
              `${source.name} within ${target.name} kinetic envelope (${r.check}: ${r.rationale})`,
          ),
          deepLink: makeCounterpartDeepLink(source.id, target.id, "#ew"),
        });
      }
    }
  }

  return edges;
}

/** 4. Shared components (supply chain) */
function computeComponentEdges(source: Drone, drones: Drone[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  if (!source.components.length) return edges;

  const sourceParts = new Set(source.components.map((c) => c.part.toLowerCase()));
  const sourceManufacturers = new Set(source.components.map((c) => c.manufacturer.toLowerCase()));

  for (const target of drones) {
    if (target.id === source.id) continue;
    if (!target.components.length) continue;

    const sharedParts = target.components.filter((c) => sourceParts.has(c.part.toLowerCase()));
    const sharedManufacturers = target.components.filter((c) =>
      sourceManufacturers.has(c.manufacturer.toLowerCase()),
    );

    const evidence: string[] = [];
    if (sharedParts.length > 0) {
      evidence.push(`Shared parts: ${sharedParts.map((c) => c.part).join(", ")}`);
    }
    if (sharedManufacturers.length > 0) {
      evidence.push(
        `Shared manufacturers: ${sharedManufacturers.map((c) => c.manufacturer).join(", ")}`,
      );
    }

    if (evidence.length > 0) {
      // Strength based on number of shared items
      const strength = Math.min(
        0.7 + sharedParts.length * 0.05 + sharedManufacturers.length * 0.03,
        0.85,
      );

      edges.push({
        type: "shared-component",
        targetId: target.id,
        targetLabel: target.name,
        strength,
        evidence,
        deepLink: makeDossierDeepLink(target.id, "#supply"),
      });
    }
  }

  return edges;
}

/** 5. Shared operators */
function computeOperatorEdges(source: Drone, drones: Drone[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  if (!source.operators.length) return edges;

  const sourceOperators = new Set(source.operators);

  for (const target of drones) {
    if (target.id === source.id) continue;
    if (!target.operators.length) continue;

    const shared = target.operators.filter((o) => sourceOperators.has(o));
    if (shared.length === 0) continue;

    edges.push({
      type: "shared-operator",
      targetId: target.id,
      targetLabel: target.name,
      strength: Math.min(0.5 + shared.length * 0.1, 0.8),
      evidence: [`Shared operators: ${shared.join(", ")}`],
      deepLink: makeDossierDeepLink(target.id, "#specs"),
    });
  }

  return edges;
}

/** 6. Variant lineage (parent/variants) */
function computeLineageEdges(source: Drone, drones: Drone[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  // Parent
  if (source.variantOfId) {
    const parent = drones.find((d) => d.id === source.variantOfId);
    if (parent) {
      edges.push({
        type: "lineage",
        targetId: parent.id,
        targetLabel: parent.name,
        strength: 0.95,
        evidence: ["Parent system"],
        deepLink: makeDossierDeepLink(parent.id, "#variants"),
      });
    }
  }

  // Variants
  const variants = drones.filter(
    (d) => d.variantOfId === source.id || source.variantIds?.includes(d.id),
  );
  for (const variant of variants) {
    edges.push({
      type: "lineage",
      targetId: variant.id,
      targetLabel: variant.name,
      strength: 0.9,
      evidence: ["Variant"],
      deepLink: makeDossierDeepLink(variant.id, "#variants"),
    });
  }

  return edges;
}

/** 7. Spec disputes */
function computeSpecDisputeEdges(source: Drone): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const spec of source.specs) {
    // Check if this spec has disputed consensus
    // We need to import consensus here - but it's in entities/drone/consensus
    // For now, check if any claim has disputed flag
    const hasDispute = spec.claims.some((c) => c.disputed);
    if (!hasDispute) continue;

    edges.push({
      type: "spec-dispute",
      targetId: `spec:${source.id}:${spec.key}`,
      targetLabel: `${source.name} — ${spec.label}`,
      strength: 0.75,
      evidence: [`${spec.label} disputed across ${spec.claims.length} sources`],
      deepLink: makeSpecsDeepLink(source.id, spec.key),
    });
  }

  return edges;
}

/** 8. Shared reference (Wikipedia/Wikidata) */
function computeReferenceEdges(source: Drone, drones: Drone[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  if (!source.reference?.url) return edges;

  // Extract Wikidata ID if present
  const wikidataMatch = source.reference.url.match(/wikidata\.org\/wiki\/(Q\d+)/);
  const wikiTitleMatch = source.reference.url.match(/wikipedia\.org\/wiki\/([^#?]+)/);

  for (const target of drones) {
    if (target.id === source.id) continue;
    if (!target.reference?.url) continue;

    let shared = false;
    let evidence = "";

    if (wikidataMatch) {
      const targetWikidata = target.reference.url.match(/wikidata\.org\/wiki\/(Q\d+)/);
      if (targetWikidata && targetWikidata[1] === wikidataMatch[1]) {
        shared = true;
        evidence = `Same Wikidata item (${wikidataMatch[1]})`;
      }
    }

    if (!shared && wikiTitleMatch) {
      const targetWiki = target.reference.url.match(/wikipedia\.org\/wiki\/([^#?]+)/);
      if (targetWiki && targetWiki[1] === wikiTitleMatch[1]) {
        shared = true;
        evidence = `Same Wikipedia article`;
      }
    }

    if (shared) {
      edges.push({
        type: "reference-shared",
        targetId: target.id,
        targetLabel: target.name,
        strength: 0.5,
        evidence: [evidence],
        deepLink: makeDossierDeepLink(target.id, "#specs"),
      });
    }
  }

  return edges;
}

/** 9. Event correlation (same dispatch event) */
function computeEventCorrelationEdges(source: Dispatch, dispatches: Dispatch[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  if (!source.eventId) return edges;

  const sameEvent = dispatches.filter((d) => d.eventId === source.eventId && d.id !== source.id);

  for (const related of sameEvent) {
    edges.push({
      type: "event-correlation",
      targetId: related.id,
      targetLabel: `${related.sourceName} · ${new Date(related.publishedAt ?? related.createdAt).toLocaleDateString()}`,
      strength: 0.6,
      evidence: [`Same event (${sameEvent.length + 1} outlets)`],
      deepLink: makeDispatchDeepLink(related.id),
    });
  }

  return edges;
}

/** Rank edges by strength * type weight, deduplicate by targetId+type */
function rankAndDedupe(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Map<string, GraphEdge>();

  for (const edge of edges) {
    const key = `${edge.type}:${edge.targetId}`;
    const existing = seen.get(key);
    const weight = EDGE_TYPE_WEIGHTS[edge.type] ?? 0.5;
    const score = edge.strength * weight;

    if (!existing) {
      seen.set(key, edge);
    } else {
      const existingWeight = EDGE_TYPE_WEIGHTS[existing.type] ?? 0.5;
      const existingScore = existing.strength * existingWeight;
      if (score > existingScore) {
        seen.set(key, edge);
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => {
    const weightA = EDGE_TYPE_WEIGHTS[a.type] ?? 0.5;
    const weightB = EDGE_TYPE_WEIGHTS[b.type] ?? 0.5;
    const scoreA = a.strength * weightA;
    const scoreB = b.strength * weightB;
    return scoreB - scoreA;
  });
}

/** Deep link builders */
function makeCounterpartDeepLink(a: string, b: string, hash = ""): DeepLink {
  return {
    route: "/counterparts",
    search: { a, b },
    hash,
  };
}

function makeDossierDeepLink(id: string, hash = ""): DeepLink {
  return {
    route: `/systems/${id}`,
    hash,
  };
}

function makeSpecsDeepLink(droneId: string, specKey: string): DeepLink {
  return {
    route: "/specs",
    search: { drone: droneId, q: specKey },
    hash: `#spec-${specKey}`,
  };
}

function makeDispatchDeepLink(dispatchId: string): DeepLink {
  return {
    route: "/dispatches",
    search: { q: dispatchId },
  };
}

/** Filter edges by type for UI sections */
export function filterEdgesByType(edges: GraphEdge[], types: GraphEdgeType[]): GraphEdge[] {
  const typeSet = new Set(types);
  return edges.filter((e) => typeSet.has(e.type));
}

/** Group edges by type for grouped display */
export function groupEdgesByType(edges: GraphEdge[]): Map<GraphEdgeType, GraphEdge[]> {
  const groups = new Map<GraphEdgeType, GraphEdge[]>();
  for (const edge of edges) {
    const arr = groups.get(edge.type) ?? [];
    arr.push(edge);
    groups.set(edge.type, arr);
  }
  return groups;
}

/** Get top N edges for compact display */
export function getTopEdges(edges: GraphEdge[], n: number): GraphEdge[] {
  return edges.slice(0, n);
}
