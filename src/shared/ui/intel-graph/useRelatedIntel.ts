import { useMemo } from "react";
import { useDrones, useDispatches } from "@/shared/infra/services";
import { computeRelatedIntel } from "./intel-graph.service";
import type { RelatedIntel, GraphEdge, GraphEdgeType } from "./intel-graph.contracts";

interface UseRelatedIntelOptions {
  /** Filter to specific edge types */
  types?: GraphEdgeType[];
  /** Maximum number of edges to return */
  limit?: number;
  /** Whether to enable the computation (default: true) */
  enabled?: boolean;
}

/**
 * Hook to compute related intelligence for a source entity.
 * Uses memoization to avoid recomputation on unrelated renders.
 */
export function useRelatedIntel(
  sourceId: string | undefined,
  options: UseRelatedIntelOptions = {},
): RelatedIntel | null {
  const { types, limit, enabled = true } = options;

  const drones = useDrones();
  const dispatches = useDispatches();

  const intel = useMemo(() => {
    if (!enabled || !sourceId) return null;

    const result = computeRelatedIntel(sourceId, drones, dispatches, []);

    // Apply type filter
    let edges = result.edges;
    if (types && types.length > 0) {
      const typeSet = new Set(types);
      edges = edges.filter((e) => typeSet.has(e.type));
    }

    // Apply limit
    if (limit && limit > 0) {
      edges = edges.slice(0, limit);
    }

    return {
      ...result,
      edges,
    };
  }, [sourceId, drones, dispatches, types, limit, enabled]);

  return intel;
}

/**
 * Hook for getting related intel grouped by type for sectioned display
 */
export function useRelatedIntelGrouped(
  sourceId: string | undefined,
  options: UseRelatedIntelOptions = {},
): Map<GraphEdgeType, GraphEdge[]> | null {
  const intel = useRelatedIntel(sourceId, options);

  const groups = useMemo(() => {
    if (!intel) return null;
    const groups = new Map<GraphEdgeType, GraphEdge[]>();
    for (const edge of intel.edges) {
      const arr = groups.get(edge.type) ?? [];
      arr.push(edge);
      groups.set(edge.type, arr);
    }
    return groups;
  }, [intel]);

  return groups;
}

/**
 * Hook for getting top N related intel for compact display (e.g., tooltips, badges)
 */
export function useTopRelatedIntel(
  sourceId: string | undefined,
  n: number = 3,
  types?: GraphEdgeType[],
): GraphEdge[] {
  const options = types ? { types, limit: n } : { limit: n };
  const intel = useRelatedIntel(sourceId, options);
  return intel?.edges ?? [];
}
