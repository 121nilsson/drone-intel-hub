import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  X,
  ChevronRight,
  ExternalLink,
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
import type { GraphEdge, GraphEdgeType, DeepLink } from "./intel-graph.contracts";
import { EDGE_TYPE_LABELS, EDGE_TYPE_ICONS } from "./intel-graph.contracts";

interface RelatedToastProps {
  edges: GraphEdge[];
  sourceLabel: string; // e.g., "Shahed-136" or dispatch source
  maxItems?: number;
  onDismiss?: () => void;
}

const ICON_MAP: Record<GraphEdgeType, typeof ExternalLink> = {
  counterpart: Zap,
  rf_overlap: Radio,
  ew_interaction: Shield,
  spec_dispute: AlertTriangle,
  shared_component: Wrench,
  shared_operator: Medal,
  event_correlation: Newspaper,
  lineage: GitBranch,
  reference_shared: BookOpen,
};

const TONE_MAP: Record<GraphEdgeType, "primary" | "accent" | "danger" | "default"> = {
  counterpart: "primary",
  rf_overlap: "accent",
  ew_interaction: "danger",
  spec_dispute: "danger",
  shared_component: "default",
  shared_operator: "accent",
  event_correlation: "default",
  lineage: "primary",
  reference_shared: "default",
};

export function RelatedToast({ edges, sourceLabel, maxItems = 5, onDismiss }: RelatedToastProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  if (!edges.length) return null;

  const displayEdges = expanded ? edges : edges.slice(0, maxItems);
  const hasMore = edges.length > maxItems;

  const handleDeepLink = (deepLink: DeepLink) => {
    if (deepLink.route.startsWith("/systems/")) {
      navigate({ to: deepLink.route, search: deepLink.search, hash: deepLink.hash });
    } else {
      navigate({ to: deepLink.route, search: deepLink.search, hash: deepLink.hash });
    }
  };

  return (
    <div className="border-l-2 border-primary/40 bg-primary/5 rounded-lg p-3 animate-slide-in">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">
            Related to {sourceLabel}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {edges.length} connection{edges.length === 1 ? "" : "s"} found
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              {expanded ? "Show less" : `Show ${edges.length - maxItems} more`}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="p-1 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <ul className="mt-2 space-y-1.5">
        {displayEdges.map((edge) => (
          <RelatedToastItem
            key={`${edge.type}:${edge.targetId}`}
            edge={edge}
            onClick={handleDeepLink}
          />
        ))}
      </ul>
    </div>
  );
}

function RelatedToastItem({
  edge,
  onClick,
}: {
  edge: GraphEdge;
  onClick: (deepLink: DeepLink) => void;
}) {
  const tone = TONE_MAP[edge.type] ?? "default";

  return (
    <li>
      <Link
        to={edge.deepLink.route}
        search={edge.deepLink.search}
        hash={edge.deepLink.hash}
        className="flex items-start gap-2 p-2 border border-border/50 bg-background/50 rounded hover:bg-secondary transition-colors"
        onClick={(e) => {
          // Prevent default link behavior, use navigate instead
          e.preventDefault();
          onClick(edge.deepLink);
        }}
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
        <ChevronRight className="flex-shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/** Inline variant for feed items - renders as a single expandable row */
export function RelatedInlineToast({
  edges,
  sourceLabel,
  maxVisible = 2,
}: {
  edges: GraphEdge[];
  sourceLabel: string;
  maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  if (!edges.length) return null;

  const visibleEdges = expanded ? edges : edges.slice(0, maxVisible);
  const hasMore = edges.length > maxVisible;

  const handleDeepLink = (deepLink: DeepLink) => {
    if (deepLink.route.startsWith("/systems/")) {
      navigate({ to: deepLink.route, search: deepLink.search, hash: deepLink.hash });
    } else {
      navigate({ to: deepLink.route, search: deepLink.search, hash: deepLink.hash });
    }
  };

  return (
    <details className="group border border-border/50 bg-background/50 rounded p-2">
      <summary className="flex items-center gap-2 cursor-pointer list-none">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Related intel
        </span>
        <span className="font-mono text-xs text-primary">{sourceLabel}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {edges.length} connection{edges.length === 1 ? "" : "s"}
        </span>
        <ChevronRight
          className={`text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </summary>

      <ul className="mt-2 space-y-1.5 animate-slide-down">
        {visibleEdges.map((edge) => (
          <li key={`${edge.type}:${edge.targetId}`}>
            <Link
              to={edge.deepLink.route}
              search={edge.deepLink.search}
              hash={edge.deepLink.hash}
              className="flex items-center gap-2 px-2 py-1.5 text-sm hover:text-primary transition-colors"
              onClick={(e) => {
                e.preventDefault();
                handleDeepLink(edge.deepLink);
              }}
            >
              <span className="text-[12px]" aria-hidden="true">
                {EDGE_TYPE_ICONS[edge.type]}
              </span>
              <span className="font-medium truncate flex-1">{edge.targetLabel}</span>
              <Tag tone={TONE_MAP[edge.type] ?? "default"} className="text-[9px]">
                {EDGE_TYPE_LABELS[edge.type]}
              </Tag>
              <span className="font-mono text-[10px] text-muted-foreground">
                {Math.round(edge.strength * 100)}%
              </span>
            </Link>
          </li>
        ))}
        {hasMore && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full text-left px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
          >
            Show {edges.length - maxVisible} more
          </button>
        )}
      </ul>
    </details>
  );
}
