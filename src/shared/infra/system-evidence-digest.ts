import { consensus } from "@/entities/drone/consensus";
import { isRelationActive } from "@/entities/drone/system-hierarchy";
import type { Drone } from "@/entities/drone/types";

export interface SystemEvidenceDigest {
  fingerprint: string;
  system: {
    id: string;
    name: string;
    aliases: string[];
    domain: string;
    origin: string;
    manufacturer?: string;
    operators: string[];
    propulsion: string;
    installation?: string;
    counterpartIds: string[];
    variantOfId?: string;
    variantIds?: string[];
  };
  organizations: Array<{
    name: string;
    role: string;
    country?: string;
    evidence?: string;
    source?: string;
  }>;
  specifications: Array<{
    key: string;
    label: string;
    semantic?: string;
    consensus: ReturnType<typeof consensus>;
    claims: Array<{
      value: string | number;
      source: string;
      evidence?: string;
      normalizationConfidence?: number;
      outlier?: boolean;
    }>;
  }>;
  components: Array<{
    part: string;
    manufacturer: string;
    origin: string;
    model?: string;
    category?: string;
    evidence?: string;
  }>;
  timeline: Array<{
    date: string;
    kind: string;
    description: string;
    source: string;
  }>;
  artifact: {
    summary?: string;
    summaryEnglish?: string;
  };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    // Mul by FNV prime 0x01000193.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export const buildSystemEvidenceDigest = (drone: Drone): SystemEvidenceDigest => {
  const int = consensus;
  const systems = {
    id: drone.id,
    name: drone.name,
    aliases: drone.aliases,
    domain: drone.domain,
    origin: drone.origin,
    ...(drone.manufacturer ? { manufacturer: drone.manufacturer } : {}),
    operators: drone.operators,
    propulsion: drone.propulsion,
    ...(drone.installation ? { installation: drone.installation } : {}),
    counterpartIds: drone.counterpartIds,
    ...(drone.variantOfId ? { variantOfId: drone.variantOfId } : {}),
    ...(drone.variantIds ? { variantIds: drone.variantIds } : {}),
    ...(drone.systemClass ? { systemClass: drone.systemClass } : {}),
    // The typed relations this entry states, active ones only: what the briefing may rely on.
    ...(drone.relations?.some(isRelationActive)
      ? {
          relations: drone.relations.filter(isRelationActive).map((r) => ({
            kind: r.kind,
            targetId: r.targetSystemId,
            ...(r.role ? { role: r.role } : {}),
          })),
        }
      : {}),
  };
  const specifications = drone.specs.map((spec) => {
    const report = int(spec);
    const outliers = report.outliers ?? [];
    return {
      key: spec.key,
      label: spec.label,
      ...(spec.semantic ? { semantic: spec.semantic } : {}),
      consensus: report,
      claims: spec.claims.map((claim, index) => ({
        value: claim.value,
        source: claim.source,
        ...(claim.evidence ? { evidence: claim.evidence } : {}),
        ...(claim.normalizationConfidence !== undefined
          ? { normalizationConfidence: claim.normalizationConfidence }
          : {}),
        ...(outliers.includes(index) ? { outlier: true } : {}),
      })),
    };
  });
  const digest = {
    system: systems,
    organizations: (drone.organizationLinks ?? []).map((link) => ({
      name: link.name,
      role: link.role,
      ...(link.country ? { country: link.country } : {}),
      ...(link.evidence ? { evidence: link.evidence } : {}),
      ...(link.source ? { source: link.source } : {}),
    })),
    specifications,
    // What reports say happened with the system, period by period: launches, deliveries, kills.
    // Only when there is some: an empty key would change every entry's fingerprint and send every
    // stored brief back to the model for nothing.
    ...(drone.activity?.length
      ? {
          activity: drone.activity.map((r) => ({
            metric: r.metric,
            quantity: r.quantity,
            ...(r.unit ? { unit: r.unit } : {}),
            ...(r.period ? { period: r.period.label } : {}),
            ...(r.per ? { per: r.per } : {}),
            source: r.source,
            ...(r.evidence ? { evidence: r.evidence } : {}),
          })),
        }
      : {}),
    components: drone.components.map((component) => ({
      part: component.part,
      manufacturer: component.manufacturer,
      origin: component.origin,
      ...(component.model ? { model: component.model } : {}),
      ...(component.category ? { category: component.category } : {}),
      ...(component.evidence ? { evidence: component.evidence } : {}),
    })),
    timeline: drone.evolution.slice(-16).map((event) => ({
      date: event.date,
      kind: event.kind,
      description: event.description,
      source: event.source,
    })),
    artifact: {
      ...(drone.summary ? { summary: drone.summary.slice(0, 1000) } : {}),
      ...(drone.summaryEnglish ? { summaryEnglish: drone.summaryEnglish.slice(0, 1000) } : {}),
    },
  };
  const fingerprint = fnv1a(JSON.stringify(digest));
  return { ...digest, fingerprint };
};
