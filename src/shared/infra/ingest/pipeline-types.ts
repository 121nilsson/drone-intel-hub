import type {
  Candidate,
  CandidateQuality,
  Drone,
  Extraction,
  ExtractedSpec,
  SystemExtraction,
} from "@/entities/drone/types";
import { ProviderOutageError, type IntelExtractor } from "@/shared/contracts/ai";
import type {
  CandidateRepository,
  DroneRepository,
  ProcurementRepository,
} from "@/shared/contracts/repository";
import type { TaxonomyCandidateRepository } from "@/shared/contracts/taxonomy";

export interface PipelineDeps {
  tier1: IntelExtractor;
  tier2: IntelExtractor;
  /** Local heuristic engine used when an AI tier throws (provider outage), so ingestion never hard-fails. */
  fallback?: IntelExtractor;
  /** Mandatory deterministic first pass in production. */
  heuristic?: IntelExtractor;
  heuristicFirst?: boolean;
  /**
   * Analyst override: spend tier-2 budget even when automatic gates are satisfied.
   */
  forceDeepAnalysis?: boolean;
  /**
   * Rethrow a ProviderOutageError instead of degrading to the heuristic result. Set by queue
   * processors: a degraded result there is recorded as final and never re-analysed, so during an
   * outage the post must stay pending for a later run instead. An interactive paste leaves it
   * unset and gets the degraded result with a note.
   */
  deferOnOutage?: boolean;
  drones: DroneRepository;
  candidates: CandidateRepository;
  /** When set, unknown propulsion terms are queued for an analyst. Absent in tests and older callers. */
  taxonomyCandidates?: TaxonomyCandidateRepository;
  /** Receives contract/deal figures routed out of drone specs. Absent in tests and older callers. */
  procurements?: ProcurementRepository;
  escalationThreshold: number;
  autoMergeThreshold: number;
  /** Unset disables auto-promotion; every new system then waits for review. */
  autoPromoteThreshold?: number;
  /** Unset disables auto-discard. */
  autoDiscardThreshold?: number;
}

export interface AnalysisContext {
  dispatchId?: string;
  url?: string;
  publishedAt?: string;
}

export type PipelinePrimaryResult =
  | { kind: "auto-merged"; droneId: string; candidate: Candidate; trace?: PipelineTrace }
  | { kind: "auto-promoted"; droneId: string; candidate: Candidate; trace?: PipelineTrace }
  | { kind: "auto-discarded"; candidate: Candidate; trace?: PipelineTrace }
  | { kind: "queued"; candidate: Candidate; trace?: PipelineTrace };

/**
 * What the run actually did, per item.
 *
 * Reporting rather than deciding: nothing branches on these fields, and they exist so the queue
 * can print "used the heuristic engine, escalated to tier 2, found 3 systems" instead of an
 * aggregate that hides which post behaved how.
 */
export interface PipelineTrace {
  /** The deterministic first pass ran. */
  heuristic: boolean;
  /** Which engines answered, e.g. "heuristic+t1+t2", "heuristic+t2", or "t1(heuristic)". */
  engines: string[];
  /** A tier that was called and failed, degrading to a deterministic result. */
  degraded: string[];
  /** Why the escalation gates fired (see extraction-gates). */
  reasons: string[];
  /** Specs the extraction produced, and systems it identified. */
  specs: number;
  systems: number;
  /** New specs written onto an existing catalog entry. Merge path only. */
  specsMerged?: number;
  /** Extraction rejected as not a system name before the promote gate. */
  rejected?: boolean;
}

export type PipelineResult = PipelinePrimaryResult & {
  relatedCandidates?: Candidate[];
  droneIds?: string[];
};
