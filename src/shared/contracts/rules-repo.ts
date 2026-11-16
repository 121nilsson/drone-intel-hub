import type { Candidate } from "@/entities/drone/types";
import type { DynamicRuleRow } from "@/shared/contracts/rules";

/**
 * Port for the dynamic-rule persistence of the rule sandbox (rules, their decisions, the version
 * counter and the candidate pool a sandbox replays). The domain (shared/infra/evaluation/
 * rule-sandbox-*.server.ts, heuristics/rule-registry.server.ts) decides what to do with a rule;
 * this port is where the rows live. The PostgreSQL adapter is the only code that writes SQL for
 * it. The port is split into role interfaces so a caller depends on the operations it uses.
 */

export type DecisionKind = "shadowed" | "activated" | "auto_activated" | "rejected" | "quarantined";
export type DecisionActor = "analyst" | "autonomous" | "circuit_breaker" | "sandbox";

/** Advisory-lock key that serializes activations across processes (web, tasks). */
export const ACTIVATION_LOCK = 7_301_002;

/** A stored rule with the two columns the sandbox's own decisions depend on. */
export interface StoredRule extends DynamicRuleRow {
  status: string;
  origin: string;
}

/** What replay needs of a rule: the aim and payload, never its status. */
export interface RuleTarget {
  id: string;
  kind: string;
  payload: unknown;
  targetKey: string | null;
}

/** A rule in shadow with its stored metrics (`shadowMetrics` is the ShadowMetrics JSON). */
export interface ShadowRuleRow extends DynamicRuleRow {
  origin: string;
  targetKey: string | null;
  shadowMetrics: unknown;
}

/** A quarantined rule a sandbox generated: the candidates for probation. */
export interface QuarantinedRuleRow {
  id: string;
  kind: string;
  targetKey: string | null;
  status: string;
  origin: string;
}

/** An active rule, and whether it went live in the last 24 hours. */
export interface ActiveRuleRow extends DynamicRuleRow {
  recent: boolean;
}

/** One rule for the Rules panel, with its latest evaluation (timestamps as stored). */
export interface RuleListRow {
  id: string;
  kind: string;
  language: string;
  payload: unknown;
  status: string;
  origin: string;
  targetKey: string | null;
  rationale: string | null;
  evidence: unknown;
  createdAt: unknown;
  promotedAt: unknown;
  shadowMetrics: unknown;
  evalReport: unknown;
  evalAt: unknown;
  evalVersion: number | null;
}

export interface RuleReader {
  findRule(id: string): Promise<StoredRule | null>;
  /** The active rules, without `exceptId` when given. */
  activeRules(exceptId?: string): Promise<DynamicRuleRow[]>;
  /** The newest rule-set version (0 before the first). */
  rulesVersion(): Promise<number>;
  ruleIds(): Promise<string[]>;
  ruleTarget(id: string): Promise<RuleTarget | null>;
  /** Shadow rules, oldest first. */
  shadowRules(): Promise<ShadowRuleRow[]>;
  /** Quarantined rules whose origin is the autonomous sandbox. */
  quarantinedGenerated(): Promise<QuarantinedRuleRow[]>;
  /** Active rules, newest promotion first. */
  activeRulesWithRecency(): Promise<ActiveRuleRow[]>;
  ruleListRows(limit: number): Promise<RuleListRow[]>;
}

export interface RuleDecisionRow {
  category: string;
  origin: string;
  decision: string;
  actor: string;
}

export interface RecentDecisionRow {
  ruleId: string;
  decision: string;
  actor: string;
  note: string | null;
  decidedAt: unknown;
}

export interface DecisionHistoryRow {
  ruleId: string;
  decision: string;
  actor: string;
  decidedAt: unknown;
}

export interface RuleDecisionLog {
  /** Writes the decision with the rule's category and origin as they are now. */
  recordDecision(
    id: string,
    decision: DecisionKind,
    actor: DecisionActor,
    note?: string | null,
  ): Promise<void>;
  /** Appends the next rule-set version. Refreshing the live snapshot is the caller's job. */
  appendVersion(note: string): Promise<void>;
  decisions(): Promise<RuleDecisionRow[]>;
  autoActivatedLast24h(): Promise<number>;
  /** The 20 newest decisions. */
  recentDecisions(): Promise<RecentDecisionRow[]>;
  decisionHistory(ruleIds: readonly string[]): Promise<DecisionHistoryRow[]>;
}

export interface NewRule {
  id: string;
  kind: string;
  language: string;
  payload: unknown;
  origin: string;
  targetKey: string | null;
  rationale: string | null;
  evidence: unknown;
}

export interface RuleEvaluationRecord {
  ruleId: string;
  passed: boolean;
  corpusSize: number;
  /** Ids of the fixtures the rule broke; their count is the regression count. */
  brokenFixtures: string[];
  f1Delta: number;
  mode: string;
  rulesVersion: number;
  /** The whole sandbox result, stored as JSON. */
  report: unknown;
}

/**
 * Status changes. Each takes the status it may leave, so a rule an analyst or another process
 * already moved is left alone; the boolean says whether this call moved it.
 */
export interface RuleTransitions {
  /** Inserts a candidate; a rule that already exists (any status) is left untouched. */
  insertCandidate(rule: NewRule): Promise<void>;
  /** candidate | evaluating | candidate_passed -> `next`; `shadowMetrics` only for shadow. */
  settleCandidate(
    id: string,
    next: "rejected" | "shadow" | "candidate_passed",
    shadowMetrics: unknown | null,
  ): Promise<boolean>;
  /** candidate_passed -> shadow. */
  startShadow(id: string, shadowMetrics: unknown): Promise<boolean>;
  /** shadow -> rejected. */
  rejectShadow(id: string): Promise<boolean>;
  /** Makes the rule active (no status guard: the caller has just sandboxed it). */
  activate(id: string, decidedBy: "analyst" | "autonomous_sandbox"): Promise<void>;
  /** active -> quarantined, any other open status -> rejected; null when nothing was open. */
  rejectOrQuarantine(id: string): Promise<"rejected" | "quarantined" | null>;
  /** active -> quarantined by the circuit breaker. */
  quarantineActive(id: string): Promise<boolean>;
  /**
   * quarantined -> shadow together with its decision row, in one transaction (probation).
   * False when the rule was no longer quarantined.
   */
  returnToShadow(id: string, shadowMetrics: unknown): Promise<boolean>;
  saveShadowMetrics(id: string, shadowMetrics: unknown): Promise<void>;
  recordEvaluation(evaluation: RuleEvaluationRecord): Promise<void>;
}

/** An evaluation-corpus fixture as stored (`fixture` is the EvalFixture JSON). */
export interface StoredFixture {
  id: string;
  status: string;
  fixture: unknown;
}

/** The candidate pool a sandbox replays, bounded by terms, watermarks or the analyst's verdicts. */
export interface RuleCandidatePool {
  /** Newest eligible candidates whose text contains any of the terms (case-insensitive). */
  candidatesMentioning(terms: readonly string[], limit: number): Promise<Candidate[]>;
  /** Deterministic pseudo-random sample: the same rows while the table is unchanged. */
  candidateSample(n: number): Promise<Candidate[]>;
  /** Eligible candidates created after a watermark, oldest first. */
  candidatesSince(since: string, limit: number): Promise<Candidate[]>;
  /** Candidates by their source line, newest first; `limit` caps the result when given. */
  candidatesBySource(sources: readonly string[], limit?: number): Promise<Candidate[]>;
  /** Eligible candidates an analyst promoted or merged from the Queue, newest first. */
  analystResolvedCandidates(limit: number): Promise<Candidate[]>;
  /** The latest stored version of every evaluation-corpus fixture. */
  corpusFixtures(): Promise<StoredFixture[]>;
}

export type ActivationLockBusy = { ok: false; reason: string };

export interface RuleLock {
  /**
   * Runs `fn` while holding the cross-process activation lock, so each activation is sandboxed
   * against every one before it. Returns `{ ok: false }` when the lock cannot be taken.
   */
  withActivationLock<T>(fn: () => Promise<T>): Promise<T | ActivationLockBusy>;
}

export interface RulesRepo
  extends RuleReader, RuleDecisionLog, RuleTransitions, RuleCandidatePool, RuleLock {}
