import type { VerificationCoverage } from "@/entities/drone/verification";
import type { VerificationKind, VerificationState } from "@/entities/drone/types";

/**
 * What a verification run reports back to the Autonomy page.
 *
 * The page never reads the verifier's internals: it asks for a run and receives counts, coverage
 * and the claims worth a look. Every score is reported next to the coverage it was measured over,
 * because 100 % precision on four checked claims says nothing about the catalogue.
 */
export interface VerificationSummary {
  at: string;
  /** Claims the run examined (not already at the current verifier version). */
  checked: number;
  /** Entries whose stored copy was re-written. */
  changed: number;
  /** Claims with a source post that is no longer in the archive, so evidence could not be located. */
  missingText: number;
}

/**
 * What one run records in the ledger: its own counts plus the catalogue's coverage after it, so
 * the coverage trend - and the drop a stricter verifier causes on purpose - is on the record.
 */
export interface VerificationRunRecord extends VerificationSummary {
  verifierVersion: string;
  verified: number;
  uncertain: number;
  rejected: number;
  unverified: number;
}

export interface VerificationRunReport extends VerificationSummary {
  ran: boolean;
  reason?: string;
  /** Counts over the whole catalogue, not just the claims this run touched. */
  coverage: VerificationCoverage;
  /** Share of machine-checked claims that reached a definite verdict (verified or rejected). */
  decided: number;
  /** Rejected claims: the source or the arithmetic contradicts them. */
  rejected: number;
  /** Uncertain claims: stored and shown, but not counted as machine-checked fact. */
  uncertain: number;
  /** Distinct outlets per verified claim, median. 0 when nothing is verified. */
  medianIndependentSources: number;
  /** Claims a reader should look at first: rejected, then uncertain. Bounded by `truncated`. */
  exceptions: VerificationExceptionRow[];
  exceptionCount: number;
  truncated: boolean;
}

/** One claim off the happy path, flattened for the wire. */
export interface VerificationExceptionRow {
  droneId: string;
  droneName: string;
  specKey: string;
  specLabel: string;
  value: string;
  source: string;
  date: string;
  state: VerificationState;
  /** The failed check, or the uncertain check that matters most. */
  checkKind?: VerificationKind;
  detail?: string;
  evidence?: string;
  sourceId?: string;
  independentSources: number;
  verifierVersion: string;
}

/** A JSON value as the ledger stores it in a jsonb column. */
export type LedgerJson =
  string | number | boolean | null | LedgerJson[] | { [key: string]: LedgerJson };

/**
 * One line in the autonomy ledger (migrations/018). Each decision an autonomous step took - or
 * deliberately withheld - is recorded once, with what it changed and whether it was reversed, so
 * the loop can be measured and rolled back without reading the whole catalogue.
 */
export interface AutonomyEvent {
  id: string;
  at: string;
  action: AutonomyEventKind;
  /** Who acted, specifically: "verifier:deterministic-2", a rule id, a model. */
  actor: string;
  actorKind: AutonomyActorKind;
  /** What the event is about: a collection and a document id (or "catalogue" for a whole run). */
  targetCollection: string;
  targetId: string;
  category?: string;
  verdict?: string;
  before?: LedgerJson;
  after?: LedgerJson;
  reason?: string;
  confidence?: number;
  reversible: boolean;
  /** The event that undid this one. */
  reversedBy?: string;
  /** Groups the events one run or one promotion produced. */
  correlationId?: string;
}

/**
 * The kinds something actually writes. A kind is added in the same change as its writer: a kind
 * nothing emits makes "nothing was rejected" indistinguishable from "no one wrote the event".
 */
export const AUTONOMY_EVENT_KINDS = ["verification_run"] as const;
export type AutonomyEventKind = (typeof AUTONOMY_EVENT_KINDS)[number];

/**
 * Kinds that only say a loop ran. They are pruned; every other kind is a decision and kept
 * forever, because a later event's `reversed_by` may point at it.
 */
export const HEARTBEAT_EVENT_KINDS: readonly AutonomyEventKind[] = ["verification_run"];

/** Mirrors the actor_kind check constraint in migrations/018. */
export const AUTONOMY_ACTOR_KINDS = [
  "heuristic",
  "ai",
  "verifier",
  "rule",
  "audit",
  "analyst",
  "system",
] as const;
export type AutonomyActorKind = (typeof AUTONOMY_ACTOR_KINDS)[number];
