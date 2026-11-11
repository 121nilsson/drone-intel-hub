import type { EntailmentAgreement } from "@/entities/drone/entailment";
import type { ControlStratum, ControlSummary } from "@/entities/drone/verifier-controls";
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
 * The four counts a run records before and after it, so a verifier change that lowers the
 * verified share on purpose is on the record as a step, not read later as a regression.
 */
export interface VerificationCoverageCounts {
  verified: number;
  uncertain: number;
  rejected: number;
  unverified: number;
}

/**
 * What one run records in the ledger: its own counts plus the catalogue's coverage before and
 * after it, so the coverage trend - and the drop a stricter verifier causes on purpose - is on
 * the record.
 */
export interface VerificationRunRecord extends VerificationSummary {
  verifierVersion: string;
  before: VerificationCoverageCounts;
  after: VerificationCoverageCounts;
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
  /** Who acted, specifically: "verifier:deterministic-3", a rule id, a model. */
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
export const AUTONOMY_EVENT_KINDS = [
  "verification_run",
  "rule_probation_started",
  "rule_replay_requested",
  "verifier_control_run",
  "source_reenabled",
] as const;
export type AutonomyEventKind = (typeof AUTONOMY_EVENT_KINDS)[number];

/**
 * Kinds that only say a loop ran. They are pruned; every other kind is a decision and kept
 * forever, because a later event's `reversed_by` may point at it.
 */
export const HEARTBEAT_EVENT_KINDS: readonly AutonomyEventKind[] = [
  "verification_run",
  "verifier_control_run",
];

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

/** The auditor's answer to "does the post state this value for this attribute of this system?" */
export type AuditAnswer = "yes" | "no" | "cannot_tell";

/** One claim as the auditor sees it: a snapshot taken when it was drawn. */
export interface AuditItem {
  id: string;
  batchId: string;
  position: number;
  droneId: string;
  droneName: string;
  specLabel: string;
  value: string;
  evidence?: string;
  source: string;
  sourceId?: string;
  /** The post as it was when drawn; absent when the claim has no archived post. */
  postText?: string;
  language: string;
  family: string;
  answer?: AuditAnswer;
  obviouslyWrong: boolean;
  readVia?: "original" | "translation";
}

/**
 * A hidden control the auditor answered "yes". `altered` controls carry a figure the post does
 * not contain and cannot be disputed; `misread` ones, from the first sessions, rest on the
 * identity check and can be (`disputed`), after which they void nothing.
 */
export interface AuditFailedControl {
  id: string;
  batchId: string;
  droneName: string;
  specLabel: string;
  value: string;
  evidence?: string;
  source: string;
  sourceId?: string;
  kind: "altered" | "misread";
  disputed: boolean;
}

/**
 * A claim the person answered and the second reader contradicted: "yes" against its "unsupported",
 * or "no" against its "supported". Shown so the person can look again and say who was right; the
 * first answer is never replaced.
 */
export interface AuditDisagreement {
  id: string;
  droneId: string;
  droneName: string;
  specLabel: string;
  value: string;
  evidence?: string;
  source: string;
  /** The post as it was when drawn. */
  postText?: string;
  answer: "yes" | "no";
  reader: "supported" | "unsupported";
  /** The passage the reader gave as its reason, when it was found in the post. */
  readerSpan?: string;
  /** Why the reader's verdict was downgraded or could not be given. */
  readerNote?: string;
  secondLook?: AuditSecondLook;
}

/** stands: the first answer was right. reader_right: the reader caught what it missed. */
export type AuditSecondLook = "stands" | "reader_right";

/** Answers counted for one slice of the audit (overall, a language, a family). */
export interface AuditTally {
  /** Answered yes or no; "cannot tell" is excluded. */
  answered: number;
  /** Answered "no": the post does not state it. */
  errors: number;
  cannotTell: number;
  /** One-sided 95% upper bound on the error rate. */
  upperBound: number;
}

export interface AuditStatus {
  /** False when the server has no database; the audit needs one. */
  available: boolean;
  /** pass / fail / continue / not_proven, against the 5% low-risk budget (plan §4.5). */
  decision: "pass" | "fail" | "continue" | "not_proven";
  /** The batch boundary (100, 150, 200 answers) the decision was taken at. */
  decidedAt?: number;
  budget: number;
  overall: AuditTally;
  byLanguage: Array<AuditTally & { language: string }>;
  byFamily: Array<AuditTally & { family: string; alarm: boolean }>;
  /** Answered via machine translation: weaker independence, reported apart. */
  viaTranslation: number;
  obviouslyWrong: number;
  /** Hidden controls answered "yes", disputed or not; each voids the answers around it. */
  failedControls: AuditFailedControl[];
  /** Answers not counted because a standing failed control sits next to them. */
  voidedAnswers: number;
  /** The next claim waiting for an answer, with its post. */
  next?: AuditItem;
  /** How many claims are waiting. */
  openCount: number;
  seed: { size: number; answered: number; frozen: boolean };
  /**
   * The second reader measured against the person: on every answered claim it has also read,
   * how its verdicts line up. Absent until the two overlap.
   */
  reader?: {
    agreement: EntailmentAgreement;
    /** Claims both answered (yes/no) and read by the reader. */
    measured: number;
    /**
     * Of those, claims that name no extractor model, so the reader may have graded its own
     * reading. Shown, so the measurement says how independent it was.
     */
    independenceUnknown: number;
    /** Upper 95% bound on how often the reader's "supported" is a claim the post does not state. */
    supportedErrorBound: number;
  };
  /** Verified claims with a post never drawn; counted only when asked for (a catalogue scan). */
  undrawn?: number;
}

/**
 * Runs deterministic verification over the catalogue, wherever the storage in use says it must
 * run: on the server against the whole archive (PostgreSQL), or in the browser over its own store.
 * A page asks for the run; services.tsx chooses where it happens.
 */
export interface VerificationRunner {
  run(): Promise<VerificationRunReport>;
  /**
   * Run the second reader now rather than at the next hourly run. Needs the server database;
   * throws without one.
   */
  runSecondReader(): Promise<SecondReaderRun>;
  /** Today's spend against the daily ceiling; null where the reader cannot run. */
  tokenUsageToday(): Promise<TokenUsageToday | null>;
}

/** What one run of the second reader did (shared/infra/verification/entailment.server.ts). */
export interface SecondReaderRun {
  ran: boolean;
  reason: string;
  posts: number;
  claims: number;
  supported: number;
  unsupported: number;
  uncertain: number;
  /** Posts left for a later run: the per-run cap, the ceiling, or no independent reader. */
  deferred: number;
  tokens: { input: number; output: number };
}

/** What one run of the verifier controls did (shared/infra/verification/controls.server.ts). */
export interface VerifierControlRun {
  ran: boolean;
  reason: string;
  asked: number;
  supported: number;
  unsupported: number;
  uncertain: number;
  tokens: { input: number; output: number };
}

/** The verifier controls' record for the current entailment version, overall and per stratum. */
export interface VerifierControlsStatus {
  summary: ControlSummary;
  strata: ControlStratum[];
}

/** Tokens the verifier and its judges used today, against the daily ceiling (plan §14). */
export interface TokenUsageToday {
  input: number;
  output: number;
  ceiling: { input: number; output: number };
}
