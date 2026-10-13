export type GraphEdgeType =
  | "counterpart" // Explicitly linked as variant/adversary
  | "rf-overlap" // Shared frequency band (computed)
  | "ew-interaction" // Jammer ↔ link, radar ↔ airframe (computed)
  | "spec-dispute" // Consensus flagged disputed
  | "shared-component" // Same manufacturer/part
  | "shared-operator" // Same battlefield operator
  | "event-correlation" // Same dispatch event
  | "lineage" // Parent/variant relationship
  | "reference-shared"; // Same Wikipedia/Wikidata source

export interface GraphEdge {
  type: GraphEdgeType;
  targetId: string; // Drone ID or SpecAttribute key
  targetLabel: string; // Human label for UI
  strength: number; // 0–1 (confidence/overlap %)
  evidence: string[]; // Provenance: "900 MHz band overlap", "3 sources dispute range"
  deepLink: DeepLink; // Where clicking goes
}

export interface DeepLink {
  route: string; // "/counterparts" | "/specs" | "/systems/$id" | "/dispatches"
  search?: Record<string, string>; // { a: "id1", b: "id2" } | { q: "range", drone: "id" }
  hash?: string; // "#specs" | "#rf" | "#ew" | "#timeline"
  scrollTo?: string; // Element ID or selector
}

export interface RelatedIntel {
  sourceId: string; // Current entity (drone ID, dispatch ID, spec key)
  edges: GraphEdge[];
  computedAt: number;
}

// Type weights for ranking edges
export const EDGE_TYPE_WEIGHTS: Record<GraphEdgeType, number> = {
  counterpart: 1.0,
  ew_interaction: 0.95,
  rf_overlap: 0.85,
  lineage: 0.9,
  spec_dispute: 0.75,
  shared_component: 0.7,
  shared_operator: 0.65,
  event_correlation: 0.6,
  reference_shared: 0.5,
};

// Human-readable labels for edge types
export const EDGE_TYPE_LABELS: Record<GraphEdgeType, string> = {
  counterpart: "Counterpart",
  rf_overlap: "RF Overlap",
  ew_interaction: "EW Interaction",
  spec_dispute: "Spec Dispute",
  shared_component: "Shared Component",
  shared_operator: "Shared Operator",
  event_correlation: "Same Event",
  lineage: "Variant Family",
  reference_shared: "Shared Reference",
};

// Icon mapping for edge types
export const EDGE_TYPE_ICONS: Record<GraphEdgeType, string> = {
  counterpart: "⚔️",
  rf_overlap: "📡",
  ew_interaction: "🛡️",
  spec_dispute: "⚠️",
  shared_component: "🔧",
  shared_operator: "🎖️",
  event_correlation: "📰",
  lineage: "🌿",
  reference_shared: "📖",
};
