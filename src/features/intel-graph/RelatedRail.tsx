import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  ExternalLink,
  ChevronRight,
  Zap,
  Radio,
  Shield,
  AlertTriangle,
  Wrench,
  Medal,
  Newspaper,
  GitBranch,
  BookOpen,
} from "lucide-react";
import { Tag } from "@/shared/ui/primitives";
import { CountryBadge } from "@/shared/ui/country-badge";
import type { GraphEdge, GraphEdgeType, DeepLink } from "./intel-graph.contracts";
import { EDGE_TYPE_LABELS, EDGE_TYPE_ICONS } from "./intel-graph.contracts";

interface RelatedRailProps {
  edges: GraphEdge[];
  title?: string;
  maxItems?: number;
  compact?: boolean;
  onEdgeClick?: (edge: GraphEdge) => void;
}

const ICON_MAP: Record<GraphEdgeType, typeof ExternalLink> = {
  counterpart: Zap,
  "rf-overlap": Radio,
  "ew-interaction": Shield,
  "spec-dispute": AlertTriangle,
  "shared-component": Wrench,
  "shared-operator": Medal,
  "event-correlation": Newspaper,
  lineage: GitBranch,
  "reference-shared": BookOpen,
};

const TONE_MAP: Record<GraphEdgeType, "primary" | "accent" | "danger" | "default"> = {
  counterpart: "primary",
  "rf-overlap": "accent",
  "ew-interaction": "danger",
  "spec-dispute": "danger",
  "shared-component": "default",
  "shared-operator": "accent",
  "event-correlation": "default",
  lineage: "primary",
  "reference-shared": "default",
};

export function RelatedRail({
  edges,
  title = "Related Intelligence",
  maxItems = 8,
  compact = false,
  onEdgeClick,
}: RelatedRailProps) {
  const navigate = useNavigate();

  const displayEdges = useMemo(() => edges.slice(0, maxItems), [edges, maxItems]);

  if (!displayEdges.length) {
    return (
      <div className="text-sm text-muted-foreground">
        {compact ? "No related intel" : `No ${title.toLowerCase()} found.`}
      </div>
    );
  }

  const handleDeepLink = (deepLink: DeepLink, edge: GraphEdge) => {
    if (onEdgeClick) {
      onEdgeClick(edge);
      return;
    }

    if (deepLink.route.startsWith("/systems/")) {
      navigate({ to: deepLink.route, ...(deepLink.search ? { search: deepLink.search } : {}), ...(deepLink.hash ? { hash: deepLink.hash } : {}) });
    } else {
      navigate({ to: deepLink.route, ...(deepLink.search ? { search: deepLink.search } : {}), ...(deepLink.hash ? { hash: deepLink.hash } : {}) });
    }
  };

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {displayEdges.map((edge) => (
          <RelatedRailItemCompact
            key={`${edge.type}:${edge.targetId}`}
            edge={edge}
            onClick={handleDeepLink}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {title} ({edges.length})
        </h4>
        {edges.length > maxItems && (
          <span className="font-mono text-[10px] text-muted-foreground">
            +{edges.length - maxItems} more
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {displayEdges.map((edge) => (
          <RelatedRailItem
            key={`${edge.type}:${edge.targetId}`}
            edge={edge}
            onClick={handleDeepLink}
          />
        ))}
      </ul>
    </div>
  );
}

function RelatedRailItem({
  edge,
  onClick,
}: {
  edge: GraphEdge;
  onClick: (deepLink: DeepLink, edge: GraphEdge) => void;
}) {
  const Icon = ICON_MAP[edge.type] ?? ExternalLink;
  const tone = TONE_MAP[edge.type] ?? "default";

  return (
    <li className="group relative">
      <button
        onClick={() => onClick(edge.deepLink, edge)}
        className="w-full flex items-start gap-2 p-2 text-left hover:bg-secondary rounded transition-colors"
      >
        <span className="flex-shrink-0 text-[13px] mt-0.5" aria-hidden="true">
          {EDGE_TYPE_ICONS[edge.type]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium truncate">{edge.targetLabel}</span>
            <Tag tone={tone} className="shrink-0 text-[10px]">
              {EDGE_TYPE_LABELS[edge.type]}
            </Tag>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {Math.round(edge.strength * 100)}%
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground line-clamp-1">
            {edge.evidence.join(" · ")}
          </p>
        </div>
        <ChevronRight className="flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    </li>
  );
}

function RelatedRailItemCompact({
  edge,
  onClick,
}: {
  edge: GraphEdge;
  onClick: (deepLink: DeepLink, edge: GraphEdge) => void;
}) {
  const tone = TONE_MAP[edge.type] ?? "default";

  return (
    <button
      onClick={() => onClick(edge.deepLink, edge)}
      className="inline-flex items-center gap-1 px-2 py-1 border border-border bg-background rounded hover:bg-secondary transition-colors"
      title={edge.evidence.join(" · ")}
    >
      <span className="text-[11px]" aria-hidden="true">
        {EDGE_TYPE_ICONS[edge.type]}
      </span>
      <span className="font-mono text-[10px] truncate max-w-[120px]">{edge.targetLabel}</span>
      <Tag tone={tone} className="text-[9px]">
        {Math.round(edge.strength * 100)}%
      </Tag>
    </button>
  );
}

/** Horizontal chip row for very compact spaces (catalog cards, briefing) */
export function RelatedChips({ edges, maxChips = 4 }: { edges: GraphEdge[]; maxChips?: number }) {
  if (!edges.length) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {edges.slice(0, maxChips).map((edge) => (
        <Link
          key={`${edge.type}:${edge.targetId}`}
          to={edge.deepLink.route}
          {...(edge.deepLink.search ? { search: edge.deepLink.search } : {})}
          {...(edge.deepLink.hash ? { hash: edge.deepLink.hash } : {})}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-border bg-background/50 rounded text-[10px] hover:bg-secondary transition-colors"
          title={edge.evidence.join(" · ")}
        >
          <span aria-hidden="true">{EDGE_TYPE_ICONS[edge.type]}</span>
          <span className="truncate max-w-[80px]">{edge.targetLabel}</span>
        </Link>
      ))}
      {edges.length > maxChips && (
        <span className="px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          +{edges.length - maxChips}
        </span>
      )}
    </div>
  );
}
